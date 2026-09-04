---
status: current
investigation-date: 2026-09-04
orbit-commit: 1458a73951c0580ca1f797156bca12ddd91b787f
related-adrs: []
superseded-by: []
---

# OpenClaw 2.0 Agent Architecture, Work Serialization, and Orbit Gaps

## Purpose

This note investigates the feature set and agent architecture of OpenClaw 2.0,
with particular attention to the mechanisms that support unattended work, the
role of Skills, and the formats used to serialize instructions, conversations,
memory, tasks, and automations. It then compares those mechanisms with the
current Orbit implementation and identifies non-binding implications for using
Orbit as the runtime foundation of an OpenClaw- or Grok Bot-like application.

The requested name was initially written as “OpenCraw 2.0.” The user confirmed
that the intended system is OpenClaw 2.0. A separate project named OpenCraw is
therefore outside this investigation.

“OpenClaw 2.0” is the product name used for release `v2026.8.1`; it is not a
semantic-version major tag. This note pins implementation claims to the full
source commit behind that release rather than to the moving OpenClaw
documentation site.

This note is research, not a decision. It does not approve a target
architecture or authorize implementation.

## Research Questions

1. Which user-visible capabilities are included in OpenClaw 2.0?
2. Which runtime and control-plane components support autonomous work?
3. What does a Skill represent, and how is it discovered, selected, activated,
   constrained, and persisted?
4. How are ongoing work, conversations, memory, goals, delegated tasks, and
   automations serialized?
5. Which required capabilities already exist in Orbit, which are partial, and
   which are absent?
6. Which capabilities belong in a reusable Orbit core, and which belong in an
   application or control plane built on Orbit?

## Orbit Baseline

The Orbit baseline is `1458a73951c0580ca1f797156bca12ddd91b787f`.

At this revision, Orbit already provides a useful lower-level agent runtime:

- provider-neutral model abstractions for OpenAI, Anthropic, and Ollama;
- a bounded sequential model/tool loop;
- built-in, custom, turn-scoped, and MCP tool registration;
- schema validation and parallel scheduling for eligible tool calls;
- provider-neutral messages, tool calls, results, and response metadata;
- append-only JSONL session persistence and resume;
- per-turn immutable tool snapshots;
- thread and run identifiers, lifecycle events, cancellation, and structured
  session logs; and
- CLI and loopback-only local GUI entry points.

Orbit also exposes `src/core/skills/skill.ts`, but it is only a minimal value
object. It reads a string or file, extracts `name` and `description` with a
limited line-oriented frontmatter parser, and exposes the remaining
instructions. No runtime path consumes it. Orbit therefore does not currently
have an operational Skill system.

The current `ThreadManager` serializes one active invocation per in-memory
thread and can resume persisted conversation content, but thread scheduling and
ownership do not survive process restart. Orbit has no durable task queue,
agent roster, background scheduler, memory subsystem, compaction engine,
approval service, sandbox, or remote execution control plane.

## External Systems Investigated

The investigation was performed on 2026-09-04.

| System          | Pinned revision                                                                                                                               | Evidence boundary                                                                  |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| OpenClaw 2.0    | `v2026.8.1`, [`ea806575e6450e4d1efdfc72c19f04be982a1b9b`](https://github.com/openclaw/openclaw/tree/ea806575e6450e4d1efdfc72c19f04be982a1b9b) | Primary implementation, tag documentation, schema, and release notes               |
| Agent Skills    | [`69ef37e9424c0a7ea9dd2293b559e43ec8176379`](https://github.com/agentskills/agentskills/tree/69ef37e9424c0a7ea9dd2293b559e43ec8176379)        | Portable Skill package and progressive-disclosure contract                         |
| Codex           | `rust-v0.152.1`, [`5adb68a49933ae446bf11935662c83dba55a0804`](https://github.com/openai/codex/tree/5adb68a49933ae446bf11935662c83dba55a0804)  | Production Skill discovery, prompt budgeting, activation, and telemetry comparison |
| Pi Coding Agent | `v0.84.4`, [`b79e4cc834970cca69daebffab7df1da7d1e52c4`](https://github.com/earendil-works/pi/tree/b79e4cc834970cca69daebffab7df1da7d1e52c4)   | Smaller Skill discovery, validation, collision, and prompt-exposure comparison     |

OpenClaw's current web documentation was used only for navigation and
cross-checking. Claims about 2.0 behavior below come from the tagged source,
tagged documentation, source schemas, official release entry, or official 2.0
announcement. The Codex and Pi comparison is deliberately limited to the Skill
runtime concerns relevant here; a broader comparison would duplicate the
related Grok Bot research.

## Findings

### Executive result

OpenClaw 2.0 is not merely an agent loop with a large Skill library. It is an
always-on agent application and control plane around a reusable runtime:

```text
channels / apps / nodes / CLI / web
                |
        long-lived Gateway
  identity, routing, queues, schedules,
  permissions, delivery, durable state
                |
       session and agent runtime
  context + memory + Skill catalog +
  model loop + tools + compaction
                |
  local host / sandbox / remote worker
```

Its autonomous execution path is approximately:

```text
message / cron / heartbeat / event / task completion
                         |
        durable admission, ownership, idempotency
                         |
              agent profile and session
                         |
        context + memory + eligible Skill catalog
                         |
         model selects and reads a full Skill
                         |
       policy / approval / sandboxed tool action
                         |
       transcript, task, and progress persistence
                         |
          delivery, handoff, retry, or wake
```

A Skill contributes reusable knowledge about **how** to do work. It does not by
itself define **when** work begins, **who** owns it, **which authority** it has,
**where** it executes, **how** partial progress survives failure, or **where**
the result is delivered. Those properties belong to other durable records and
services.

### OpenClaw 2.0 product capabilities

The official 2.0 announcement and `v2026.8.1` release notes describe a broad
application update. The most architecture-relevant capability groups are:

| Area                        | Representative 2.0 capabilities                                                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Installation and models     | Guided onboarding; detection of subscriptions, API providers, and local models; provider Plugins; model discovery and per-agent allowlists; desktop and cloud-worker placement                         |
| Conversations and sessions  | Conversation search; branching; reset behavior that preserves conversations; shared-session membership and ownership; cross-device and cloud-worker session movement; headless runs                    |
| Context and memory          | Active Memory recall; provenance-aware background consolidation or “dreaming”; imports; pre-compaction memory handling; configurable context engines                                                   |
| Skills and learning         | Agent Skills-compatible packages; scoped discovery; eligibility checks; explicit and model-selected activation; Skill Workshop and history review; scanner-governed learned-Skill proposals            |
| Autonomous work             | Goals; exact and recurring automations; ambient heartbeat; event triggers; task ledger; subagents; experimental bounded parallel Swarm execution; Workboard integration                                |
| Tools and execution         | Built-in and Plugin tools; MCP; tool search; browser and desktop control; node-hosted tools; local, sandbox, device, and cloud-worker execution                                                        |
| Collaboration and delivery  | Named agents; A2A channel; shared conversations; structured questions; editable prompt queues; durable progress cards; notifications and channel delivery                                              |
| Security and administration | Session permission modes; one-time or recurring operation approvals; credential masking and constrained secret substitution; team roles; Plugin trust and provenance; backup and configuration history |
| User interfaces             | Rebuilt browser application; live activity; dashboards and widgets; rich audio and video; native application surfaces                                                                                  |

This breadth matters for an Orbit comparison: much of the product is outside
the inner model/tool loop, but the inner runtime must expose durable and
policy-aware contracts that let the control plane use it safely.

### Runtime and control-plane architecture

At the inspected tag, a long-lived Gateway is the control plane. Channels,
clients, nodes, and applications connect to it. Its protocol uses typed JSON
WebSocket request, response, and event envelopes. Side-effecting requests use
idempotency keys, and clients refresh durable state when they detect an event
sequence gap because the event stream itself is not a complete replay log.

The agent runtime is separated into reusable and application-specific layers:

- `packages/agent-core` defines reusable loop, message, prompt, compaction,
  Skill, and session contracts;
- `src/agents/embedded-agent-runner` owns attempt execution, model interaction,
  compaction, transcript updates, and session integration;
- `src/agents/sessions` owns persistence, resources, prompt templates, and
  Skills;
- `src/agents/runtime` provides the application-facing facade and harness
  integration; and
- `src/llm` and harness adapters isolate providers and alternative execution
  backends.

An accepted `agent` RPC returns a run identifier before work completes. The
execution path then resolves the session, model, authentication, Skill
snapshot, and tool policy; serializes work through session and global lanes;
subscribes to tool and assistant events; streams progress; and produces a
terminal lifecycle result. A separate wait operation can await that terminal
state.

OpenClaw uses a durable writer claim for each active transcript writer.
Transcript appends and rewrites validate the claim transactionally. Durable
queues, per-session lanes, global concurrency limits, idempotency receipts, and
recovery records prevent a resumed or duplicate worker from silently becoming
a second writer. These mechanisms, rather than the language model alone, make
long-running work recoverable and observable.

The context engine is also a distinct interface. Its lifecycle includes ingest,
assembly, compaction, and post-turn processing, with optional maintenance,
idempotent turn commits, and subagent hooks. The default engine preserves the
legacy transcript-plus-compaction behavior, while alternative engines can
change context construction without replacing the agent loop.

### Skills: procedure, catalog, and activation

An OpenClaw Skill is a directory centered on an Agent Skills-compatible
`SKILL.md`: YAML frontmatter supplies metadata and Markdown supplies
instructions. Scripts, references, and assets can remain separate files in the
same package. OpenClaw extends the portable metadata with invocation controls,
direct tool dispatch, eligibility requirements, installers, environment
requirements, and OpenClaw-specific metadata.

OpenClaw discovers Skills from ordered scopes including workspace, project,
personal, managed/state, bundled, Plugin, configured extra, and eligible
node-hosted sources. It recursively discovers packages, validates portable name
and description constraints, canonicalizes paths, diagnoses collisions, and
applies deterministic precedence. Per-agent visibility and Skill allowlists are
supported.

Discovery does not place every full Skill body into the model prompt. OpenClaw
builds a compact XML catalog of eligible names, descriptions, and locations.
The catalog defaults to limits of 150 entries and 18,000 characters. A model
selects a relevant entry and reads its `SKILL.md` on demand. Explicit `$skill`
references and `/skill` commands can activate Skills directly, and a Skill may
disable model-initiated invocation while remaining explicitly invocable.

This is progressive disclosure in three stages:

1. load metadata during discovery;
2. expose a bounded catalog during context assembly; and
3. load full instructions and referenced resources only when activated.

Each session receives a Skill snapshot. A watcher and configuration fingerprint
can refresh the catalog on a later turn, but a running turn operates against a
stable snapshot. Runtime-only resolved objects are separated from the persisted
snapshot.

Skill eligibility and enablement are not authorization. A Skill can declare
required executables, environment variables, configuration, or operating
systems, but tool policy, shell permissions, sandboxing, approvals, credential
handling, and execution placement determine actual authority. This separation
is essential for unattended operation.

OpenClaw 2.0 also adds a review lifecycle around learned Skills. Proposals can
be scanned, reviewed, accepted, or rejected rather than allowing arbitrary
conversation history to become executable unattended procedure. That provides
a governance layer above the package loader; it does not change Skill identity.

### Goals, tasks, delegation, and automation

OpenClaw represents distinct kinds of work with distinct records:

- A **goal** is the durable objective and status of one session. It can be
  active, paused, blocked, budget-limited, usage-limited, or complete. It is
  injected into subsequent turns but is not a scheduler job.
- A **task** is a detached work-ledger entry. It can track subagent, automation,
  command-line, or other asynchronous execution independently of message
  delivery.
- A **subagent run** connects a parent or controller to a child session and
  preserves task, tool-policy, timeout, progress, result, and delivery
  relationships. Completion is push-driven rather than implemented as model
  polling.
- An **automation** binds a trigger and schedule to an owner, session target,
  payload, authority, pacing, and delivery policy. It is persistent and has
  separate run receipts and mutable runtime state.
- A **heartbeat** starts approximate, context-aware ambient turns that can batch
  checks and remain quiet when nothing is actionable. It differs from exact or
  isolated scheduled jobs.

Schedules include one-time, interval, cron-like, exit, and stream-event forms.
Automation payloads can represent a system event, agent turn, command, script,
or system-owned maintenance activity. Conditions, retries, timeouts, catch-up,
concurrency, dynamic next-check pacing, failure alerts, and explicit delivery
modes are control-plane concerns around that payload.

The key distinction is:

```text
Skill       = reusable procedure (“how”)
Goal        = current durable objective (“what outcome”)
Task        = detached execution ledger (“what is running”)
Automation  = trigger and delivery binding (“when and where”)
Agent       = identity, profile, context, and authority (“who”)
Tool        = executable capability (“with what action”)
```

### Memory and self-directed context maintenance

OpenClaw keeps inspectable memory sources as Markdown in the agent workspace,
including curated memory and dated episodic notes. An SQLite index supports
search and recall. Provenance fields distinguish user, agent, system, and
untrusted origins as well as interactive, cron, heartbeat, and subagent session
kinds.

Memory promotion is gated. Background cron, heartbeat, and subagent content is
not automatically promoted to durable personal memory, and recalled material
is not recursively re-extracted as new memory. Pre-compaction hooks can prompt
the agent to save durable facts before older context is summarized or removed.
Background consolidation retains provenance rather than treating model-created
summaries as user statements.

This design supports autonomy without making every past transcript permanently
authoritative. It also shows that memory is not equivalent to session history
or a Skill: memory supplies selected facts and context, while Skills supply
procedures.

### How OpenClaw 2.0 serializes work

OpenClaw deliberately does not serialize autonomous work into one universal
document. Different representations match different lifecycle and query needs.

| Concern                                      | Canonical or durable representation at `v2026.8.1`                                                                                                              | Important properties                                                                                |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Skill definition                             | `SKILL.md` YAML frontmatter plus Markdown, with adjacent scripts, references, and assets                                                                        | Human-readable, portable core, package-oriented, progressively disclosed                            |
| Skill catalog for a session                  | `SessionSkillSnapshot` inside session entry JSON; large rendered prompts may use a SHA-256 content-addressed blob reference                                     | Stable per-session/turn view; runtime-resolved paths and objects are not blindly persisted          |
| Agent and application configuration          | `openclaw.json`/JSON5 and workspace files                                                                                                                       | Human-editable configuration with application validation and migration                              |
| Conversation identity and session generation | SQLite `session_nodes`, `session_windows`, conversations, memberships, and delivery tables; canonical metadata in JSON columns plus promoted relational columns | Queryable lifecycle, branching, reset/rollover history, ownership, and delivery                     |
| Transcript                                   | Ordered SQLite `transcript_events` rows with `event_json`, sequence, identities, parents, and idempotency data                                                  | Transactional writer fencing and recovery; live storage is not JSONL                                |
| Transcript archive/export                    | Compressed, hashed archives and JSONL compatibility/export helpers                                                                                              | JSONL is an interchange or legacy artifact, not the 2.0 live canonical store                        |
| Current goal                                 | Goal fields in the session entry JSON plus idempotent goal-operation receipts                                                                                   | Objective and status survive turns without becoming an automation                                   |
| Detached work                                | Relational `task_runs`, `subagent_runs`, and `flow_runs`, with JSON detail, progress, state, and wait payloads                                                  | Queryable state machines, parent/child correlation, terminal recovery, delivery separation          |
| Automation definition                        | SQLite `cron_jobs`; stable configuration in `job_json`, mutable scheduler state in `state_json`, with indexed owner/type/schedule columns                       | Definition is separated from runtime state and query-critical fields                                |
| Automation authority and execution           | Separate authority records, run receipts, scratch state, delivery queue records, and failure metadata                                                           | Policy changes, duplicate claims, retries, and crash recovery remain auditable                      |
| Memory                                       | Authoritative human-readable Markdown plus SQLite search/index/provenance tables                                                                                | Inspectable source of truth with derived retrieval structures                                       |
| Live client protocol                         | Typed JSON WebSocket request/response/event envelopes with sequence and state-version information                                                               | Efficient live progress; clients refetch after gaps because events are not the durable replay store |

For Skill snapshots, OpenClaw can store sufficiently large rendered catalog
prompts under `skills-prompts/sha256/<prefix>/<hash>.txt`. The session entry then
contains a versioned reference with algorithm, hash, and byte count. On load,
the content is validated; invalid or missing blobs do not silently become a
different prompt. This avoids copying large, derived prompt text into every
session record while preserving reproducibility.

For automations, the row codec serializes the durable job envelope with
`JSON.stringify`, while top-level relational columns promote identifiers,
owner, enabled state, payload kind, schedule identity, sort order, and update
time. Mutable scheduler state is serialized separately. This hybrid design is
more useful than either a completely opaque JSON document or a fully flattened
schema.

The 2.0 session design is a significant contrast with current Orbit. Orbit's
append-only JSONL file is the live canonical conversation record. OpenClaw uses
SQLite rows and JSON payloads as the live source because it must coordinate
long-lived writers, queries, branches, deliveries, task relationships,
idempotency, and restart recovery. JSONL remains valuable for export and
interchange, but it is not sufficient by itself for the OpenClaw control plane.

## Analysis

### OpenClaw autonomy depends on a control loop around the model loop

Orbit and OpenClaw both have a model/tool loop, but only OpenClaw currently
wraps it in an always-on operational loop. The practical autonomy stack is:

1. admit an event or scheduled fire;
2. deduplicate it and acquire ownership;
3. load the correct agent, session, goal, memory, and Skill snapshot;
4. constrain execution through policy, approval, secrets, and placement;
5. execute and stream structured progress;
6. persist every state transition and external effect correlation;
7. deliver the result or delegate further work; and
8. retry, pause, recover, or wake based on durable state.

A more capable prompt or Skill format cannot replace these steps. Conversely,
the control plane does not eliminate the need for bounded context, clear Skill
activation, or a provider-neutral agent loop.

### Orbit capability matrix

The statuses below describe the inspected Orbit commit, not planned work.

| Capability needed for an OpenClaw-like application               | Orbit status        | Current evidence and gap                                                                                                |
| ---------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Provider-neutral model adapters                                  | Implemented         | Model registry and OpenAI, Anthropic, and Ollama adapters exist                                                         |
| Bounded model/tool execution loop                                | Implemented         | `Agent.invoke()` iterates model and tool execution with a configured maximum                                            |
| Built-in, custom, turn-scoped, and MCP tools                     | Implemented         | `ToolRegistry` and MCP discovery compose one turn's tool set                                                            |
| Tool schema validation and parallel execution                    | Implemented         | `ToolRuntime` validates calls and parallelizes tools that declare eligibility                                           |
| Provider-neutral serializable messages and tool results          | Implemented         | Session records preserve normalized model output and provider metadata                                                  |
| Basic session persistence and resume                             | Implemented, narrow | Append-only JSONL preserves conversation turns; no relational lifecycle, writer fencing, branching, or durable delivery |
| Run IDs, cancellation, events, and logs                          | Implemented, narrow | Useful local lifecycle API; events and active-thread ownership are process-local                                        |
| Local CLI and GUI host                                           | Implemented, narrow | Interactive local product surfaces, not a long-lived multichannel Gateway                                               |
| Skill value object                                               | Partial             | `Skill` parses only basic metadata and is unused by the runtime                                                         |
| Skill discovery, scopes, catalog, validation, and collisions     | Missing             | No package discovery or stable catalog snapshot                                                                         |
| Progressive disclosure and Skill activation                      | Missing             | No metadata prompt budget, explicit activation, resource loading, or invocation provenance                              |
| Skill enablement, provenance, review, and distribution           | Missing             | No per-agent visibility, learned-Skill review, Plugin attribution, install, or update lifecycle                         |
| Context engine, token budgeting, and compaction                  | Missing             | Session context is assembled directly; no pluggable lifecycle or compaction                                             |
| Durable memory and provenance-aware recall                       | Missing             | No curated/episodic memory or retrieval index                                                                           |
| Named agent profiles and persistent roster                       | Missing             | One runtime Agent instance is not a durable application identity                                                        |
| Goals and durable task ledger                                    | Missing             | No persisted objective state, detached task state machine, or result delivery lifecycle                                 |
| Delegation, subagents, and inter-agent messaging                 | Missing             | No parent/child session contract, mailbox, tool-policy inheritance, or push completion                                  |
| Scheduler, recurring work, heartbeat, and external triggers      | Missing             | No persistent timing/event admission, retry, catch-up, or delivery machinery                                            |
| Durable queues, ownership, idempotency, and restart recovery     | Missing             | No transactional claims or cross-process recovery protocol                                                              |
| Tool policy, approvals, sandbox, and secret mediation            | Missing             | Built-in coding tools have host access; no reusable authorization boundary for unattended work                          |
| Plugin package and capability governance                         | Missing             | Models, custom tools, and MCP are extensible, but there is no unified Plugin lifecycle or trust record                  |
| Gateway, channels, remote nodes, and cloud workers               | Missing             | No typed remote control protocol, device roster, channel adapters, or placement abstraction                             |
| Browser/desktop control and rich media                           | Missing             | Not part of the current built-in tool or client surface                                                                 |
| Multi-user/team roles and shared sessions                        | Missing             | Current local thread API has no user, membership, or organization policy model                                          |
| Durable progress cards, structured questions, and work dashboard | Partial at most     | Generic events and GUI exist; no persisted progress/question/widget/workboard model                                     |
| Executable workflow graph                                        | Missing             | Processor, Operator, and Sequence types are directional and are not an execution or persistence engine                  |

The implemented portion is valuable: Orbit has most of the provider-neutral
inner-loop primitives an application should reuse. The largest gaps are not
additional model providers. They are the durable, secure, multi-run facilities
that convert individual turns into an autonomous service.

### Comparison with Codex and Pi Skills

OpenClaw, Codex, and Pi all reinforce the same minimum Skill architecture:

| Concern         | OpenClaw 2.0                                                     | Codex 0.152.1                                                   | Pi 0.84.4                                       | Orbit today                |
| --------------- | ---------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------- | -------------------------- |
| Package         | Agent Skills-compatible directory                                | Agent Skills-compatible directory                               | Agent Skills-compatible directory               | One content string or file |
| Discovery       | Multiple ordered scopes, Plugins, nodes, per-agent filtering     | Multiple repository/user/system/product scopes                  | User/project/extension/explicit paths           | None                       |
| Validation      | Portable constraints plus OpenClaw eligibility metadata          | Metadata, dependencies, policy, interface, and load diagnostics | Name/description and collision diagnostics      | Limited field extraction   |
| Prompt exposure | Bounded XML metadata catalog                                     | Bounded metadata catalog with fair truncation                   | Metadata list                                   | None                       |
| Activation      | Model read, explicit reference/command, optional direct dispatch | Explicit and implicit invocation paths                          | Model reads file or explicit command expands it | None                       |
| Stable view     | Persisted session Skill snapshot                                 | Turn/runtime catalog behavior and telemetry                     | Loaded catalog for session                      | None                       |
| Authorization   | Separate tool/session/sandbox/approval policy                    | Separate runtime/tool policy                                    | Skill metadata does not grant tools             | No unattended policy layer |

Pi demonstrates a practical minimum implementation. Codex demonstrates that a
large catalog needs explicit context budgeting and telemetry. OpenClaw adds
durable per-session snapshots, multiple execution locations, learned-Skill
governance, and application-level automation. Orbit's current class is below
the minimum shared by all three references.

### Proposed responsibility boundary for Orbit

The comparison does not imply that all OpenClaw product features belong in
`src/core`. A reusable division would be:

| Orbit core or reusable runtime contract                                      | Application/control-plane responsibility                                           |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Provider-neutral bounded turn loop                                           | Always-on Gateway and network protocol                                             |
| Skill package model, discovery, catalog snapshot, activation, and provenance | Skill marketplace, organization distribution, and review UI                        |
| Context-engine and compaction lifecycle                                      | Product-specific bootstrap files and memory-management UI                          |
| Durable run/turn event and correlation contracts                             | Channel adapters, notifications, and delivery routing                              |
| Tool capability, policy, approval, secret, and sandbox interfaces            | User/team roles, approval surfaces, credential providers, and administrator policy |
| Task/delegation primitives and parent-child result contracts                 | Workboard, agent roster, groups, and notification experience                       |
| Execution-host abstraction                                                   | Device, cloud-worker, and browser/desktop fleet management                         |
| Persistence ports and idempotency/ownership invariants                       | Concrete database, deployment topology, backup, and retention policy               |

Scheduling is a useful boundary example. Cron expressions, time zones,
webhooks, retries, and notification routing belong to an application service.
Orbit core should still accept trigger identity, idempotency key, authority,
deadline, parent task, and delivery correlation so a scheduler can start a run
without losing causality or safety.

Similarly, core does not need to own a marketplace, but it does need a stable
Skill identity, version/provenance, activation event, and catalog snapshot if an
application is to install and update Skills reproducibly.

## Implications for Orbit

The following are non-binding proposals for later concept and ADR work.

### Priority 0: make the inner runtime safe and reproducible

1. Implement an Agent Skills-compatible package and catalog subsystem:
   discovery scopes, validation, deterministic precedence, canonical-path
   deduplication, immutable snapshots, prompt budgeting, progressive
   disclosure, explicit and model-selected activation, and diagnostics.
2. Introduce capability-policy contracts before unattended execution: tool and
   path allow/deny rules, approvals, sandbox selection, secret references, and
   audit events. Skill metadata must never grant authority.
3. Define stable run, turn, tool-effect, and lifecycle event envelopes with
   correlation and idempotency fields. Preserve the current simple local API
   while allowing durable application adapters.
4. Add a provider-neutral context-engine lifecycle and compaction checkpoints.
   Large Skill catalogs, long sessions, memory, and subagents otherwise compete
   for context without a controlled budget.

### Priority 1: add durable autonomy primitives

1. Add a task/delegation model with durable states, parent-child relationships,
   progress, result delivery, cancellation, retry classification, and restart
   recovery.
2. Define named agent profiles separately from Skills, including enabled Skill
   sets, context/memory policy, execution policy, and model policy.
3. Expose application-neutral trigger admission metadata so a separate
   scheduler, heartbeat service, webhook adapter, or agent message can create
   the same kind of Orbit run.
4. Add persistence interfaces that support transactional writer ownership,
   state-machine queries, and idempotent external effects. Keep JSONL as a
   useful transcript/export format, but do not require it to serve as the sole
   control-plane database.

### Priority 2: build the product layer

1. Implement an always-on Gateway, authenticated client protocol, and channel
   adapters in an Orbit application rather than coupling them to the model
   adapters.
2. Add scheduler, heartbeat, external-event admission, task dashboards,
   structured questions, and delivery/notification services.
3. Add memory sources, retrieval indexes, provenance, promotion rules, and
   learned-Skill review only after the policy and audit foundations exist.
4. Add execution placement for local hosts, sandboxes, browsers, remote nodes,
   and cloud workers behind the core execution-host abstraction.

### Suggested canonical records

A future design should keep at least these identities separate:

```text
SkillDefinition
  id, version, metadata, instructions, resources, provenance

AgentProfile
  id, role, model_policy, enabled_skill_ids, memory_policy, capability_policy

RunRequest
  id, agent_id, session_id, trigger, idempotency_key, authority, deadline

TaskRecord
  id, parent_id, run_id, state, progress, result, delivery_state

AutomationBinding
  id, owner_agent_id, trigger, schedule, payload, authority, delivery_policy

TranscriptEvent
  session_id, sequence, run_id, parent_id, type, payload, timestamp
```

This separation retains the central research result: Skills serialize
procedure, whereas autonomous work requires separate serializations for
identity, objective, trigger, authority, execution state, history, and
delivery.

## Risks and Limitations

- OpenClaw 2.0 is a large release. This note focuses on architecture-relevant
  capabilities and does not inventory every provider, channel, UI refinement,
  or bug fix in the changelog.
- Some official web documentation changes in place. Source-backed claims are
  pinned to `v2026.8.1`; later documentation may describe behavior added after
  that tag.
- Source schemas demonstrate intended persistence and invariants, but this
  investigation did not perform failure-injection or scale testing of a running
  multi-node OpenClaw deployment.
- Features marked experimental, including Swarm orchestration, should not be
  treated as proof of production reliability.
- SQLite is evidence for OpenClaw's requirements and design, not evidence that
  Orbit must adopt the same database. The reusable requirements are durable
  ownership, queryable state, idempotency, and recovery.
- OpenClaw, Codex, and Pi are primarily local or developer-oriented agent
  systems. Their security designs do not by themselves establish fitness for
  regulated, hostile multi-tenant, or high-consequence deployments.
- The Orbit gap matrix describes current source. Directional Processor and
  workflow concepts are not counted as implemented behavior.

## Open Questions

1. Which smallest Skill catalog API should Orbit stabilize before choosing a
   scheduler or application protocol?
2. Should Orbit provide a reference SQLite persistence adapter, or only ports
   and invariants that applications can implement with another database?
3. Which event envelope can serve local CLI/GUI runs and durable remote runs
   without exposing provider-specific stream details?
4. Should task/delegation be part of `Agent`, a sibling core service, or a
   separate optional package?
5. Which approval decisions must be replayable after restart, and which must be
   re-requested because the operation or policy changed?
6. How should Skill identity and versioning behave when workspace files change
   during a persisted session?
7. Which memory sources are authoritative, and how should Orbit preserve origin
   and prevent recalled or subagent-generated text from self-reinforcing?
8. What is the minimum execution-host interface that supports local, sandbox,
   browser, device, and cloud-worker placement without weakening tool policy?
9. Which OpenClaw-like capabilities should be a first-party Orbit application
   rather than reusable library surface?

## Related Decisions

No Orbit ADR currently adopts an OpenClaw-like Gateway, Skill catalog, durable
task system, scheduler, memory engine, sandbox policy, or remote execution
plane. Each architectural adoption should be evaluated separately. This note
and the related Grok Bot investigation provide evidence but do not constitute a
decision.

## References

### OpenClaw 2.0 release and architecture

- [OpenClaw 2.0 announcement](https://openclaw.ai/blog/openclaw-2-accidentally).
- [OpenClaw `v2026.8.1` release](https://github.com/openclaw/openclaw/releases/tag/v2026.8.1).
- [OpenClaw source at the inspected commit](https://github.com/openclaw/openclaw/tree/ea806575e6450e4d1efdfc72c19f04be982a1b9b).
- [Agent runtime architecture at the inspected commit](https://github.com/openclaw/openclaw/blob/ea806575e6450e4d1efdfc72c19f04be982a1b9b/docs/agent-runtime-architecture.md).
- [Agent loop at the inspected commit](https://github.com/openclaw/openclaw/blob/ea806575e6450e4d1efdfc72c19f04be982a1b9b/docs/concepts/agent-loop.md).
- [Context engine at the inspected commit](https://github.com/openclaw/openclaw/blob/ea806575e6450e4d1efdfc72c19f04be982a1b9b/docs/concepts/context-engine.md).
- [Gateway architecture at the inspected commit](https://github.com/openclaw/openclaw/blob/ea806575e6450e4d1efdfc72c19f04be982a1b9b/docs/concepts/architecture.md).

### OpenClaw Skills, memory, and autonomous work

- [Skills guide at the inspected commit](https://github.com/openclaw/openclaw/blob/ea806575e6450e4d1efdfc72c19f04be982a1b9b/docs/tools/skills.md).
- [Skill types](https://github.com/openclaw/openclaw/blob/ea806575e6450e4d1efdfc72c19f04be982a1b9b/src/skills/types.ts).
- [Skill discovery and prompt rendering](https://github.com/openclaw/openclaw/blob/ea806575e6450e4d1efdfc72c19f04be982a1b9b/src/skills/loading/session.ts).
- [Skill prompt limits](https://github.com/openclaw/openclaw/blob/ea806575e6450e4d1efdfc72c19f04be982a1b9b/src/skills/loading/skill-prompt-limits.ts).
- [Runtime Skill snapshots](https://github.com/openclaw/openclaw/blob/ea806575e6450e4d1efdfc72c19f04be982a1b9b/src/skills/runtime/session-snapshot.ts).
- [Persisted Skill snapshot types](https://github.com/openclaw/openclaw/blob/ea806575e6450e4d1efdfc72c19f04be982a1b9b/src/config/sessions/session-prompt-types.ts).
- [Content-addressed Skill prompt blobs](https://github.com/openclaw/openclaw/blob/ea806575e6450e4d1efdfc72c19f04be982a1b9b/src/config/sessions/skill-prompt-blobs.ts).
- [Memory architecture at the inspected commit](https://github.com/openclaw/openclaw/blob/ea806575e6450e4d1efdfc72c19f04be982a1b9b/docs/concepts/memory-architecture.md).
- [Goals at the inspected commit](https://github.com/openclaw/openclaw/blob/ea806575e6450e4d1efdfc72c19f04be982a1b9b/docs/tools/goal.md).
- [Task ledger at the inspected commit](https://github.com/openclaw/openclaw/blob/ea806575e6450e4d1efdfc72c19f04be982a1b9b/docs/automation/tasks.md).
- [Subagents at the inspected commit](https://github.com/openclaw/openclaw/blob/ea806575e6450e4d1efdfc72c19f04be982a1b9b/docs/tools/subagents.md).
- [Cron and automation jobs at the inspected commit](https://github.com/openclaw/openclaw/blob/ea806575e6450e4d1efdfc72c19f04be982a1b9b/docs/automation/cron-jobs.md).
- [Heartbeat behavior at the inspected commit](https://github.com/openclaw/openclaw/blob/ea806575e6450e4d1efdfc72c19f04be982a1b9b/docs/gateway/heartbeat.md).
- [Automation type definitions](https://github.com/openclaw/openclaw/blob/ea806575e6450e4d1efdfc72c19f04be982a1b9b/src/cron/types.ts).
- [Automation row serialization](https://github.com/openclaw/openclaw/blob/ea806575e6450e4d1efdfc72c19f04be982a1b9b/src/cron/store/row-codec.ts).
- [Session and memory SQLite schema](https://github.com/openclaw/openclaw/blob/ea806575e6450e4d1efdfc72c19f04be982a1b9b/src/state/openclaw-agent-schema.sql).
- [Automation, task, and flow SQLite schema](https://github.com/openclaw/openclaw/blob/ea806575e6450e4d1efdfc72c19f04be982a1b9b/src/state/openclaw-state-schema.sql).

### Skill format and comparison implementations

- [Agent Skills specification at the inspected revision](https://github.com/agentskills/agentskills/blob/69ef37e9424c0a7ea9dd2293b559e43ec8176379/docs/specification.mdx).
- [Codex Skill metadata at the inspected release](https://github.com/openai/codex/blob/5adb68a49933ae446bf11935662c83dba55a0804/codex-rs/skills/src/model.rs).
- [Codex Skill catalog rendering and context budget](https://github.com/openai/codex/blob/5adb68a49933ae446bf11935662c83dba55a0804/codex-rs/ext/skills/src/render.rs).
- [Codex Skill invocation handling](https://github.com/openai/codex/blob/5adb68a49933ae446bf11935662c83dba55a0804/codex-rs/core/src/skills.rs).
- [Pi Skill loading and prompt rendering](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/src/core/skills.ts).
- [Pi system-prompt assembly](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/src/core/system-prompt.ts).

### Orbit implementation inspected

- [`src/core/agent.ts`](../../src/core/agent.ts)
- [`src/core/thread.ts`](../../src/core/thread.ts)
- [`src/core/application.ts`](../../src/core/application.ts)
- [`src/core/skills/skill.ts`](../../src/core/skills/skill.ts)
- [`src/core/session/`](../../src/core/session/)
- [`src/core/tools/`](../../src/core/tools/)
- [`docs/architecture.md`](../architecture.md)
- [`docs/session.md`](../session.md)
- [`docs/tools.md`](../tools.md)
- [Grok Bot Architecture and Skill Ownership](2026-09-03-grok-bot-architecture-and-skill-ownership.md)
