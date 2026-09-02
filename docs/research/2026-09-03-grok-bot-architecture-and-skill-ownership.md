---
status: current
investigation-date: 2026-09-03
orbit-commit: 22477981174942e57590e2440c959534a82fcedf
related-adrs: []
superseded-by: []
---

# Grok Bot Architecture and Skill Ownership

## Purpose

This note investigates the public architecture of xAI's Grok Bot and the
boundary between reusable skills, persistent agents, inter-agent handoffs, and
scheduled or event-triggered execution. It evaluates the hypothesis that Grok
Bot is primarily a collection of skills activated by external events, other
skills, or schedules, and records non-binding implications for Orbit.

The result is narrower than a reverse-engineered implementation description.
Grok Bot is a hosted product whose server implementation is not published. Its
official product documentation establishes visible objects, ownership, state
scope, and behavior, but not backend schemas, queues, storage engines, or model
prompts.

This note is research, not a decision. It does not approve a skill architecture,
a scheduler, multi-agent orchestration, or an implementation change in Orbit.

## Research Questions

1. Is a Grok Bot best modeled as a skill, a collection of skills, or a
   persistent agent that can use skills?
2. Which state belongs to one Bot, one user, one team, or the Grok Bot service?
3. How are manual requests, schedules, external events, and Bot-to-Bot handoffs
   represented?
4. Which responsibilities belong in a reusable agent runtime such as Orbit,
   and which belong in an application built on the runtime?
5. What skill-management capabilities are missing from the current Orbit
   implementation?

## Orbit Baseline

The Orbit baseline is `22477981174942e57590e2440c959534a82fcedf`.

At this revision, `src/core/skills/skill.ts` provides a public `Skill` value
object. It can load content directly or synchronously from one file, extract
`name` and `description` from a limited line-oriented frontmatter parser, retain
the original content, and expose the remaining body as instructions. Its unit
tests verify these operations and missing-file errors.

No other runtime source currently consumes `Skill`. Orbit does not yet provide:

- skill-directory discovery or multiple search scopes;
- a catalog, name-collision policy, enablement state, or version identity;
- Agent Skills specification validation;
- metadata-only prompt rendering and full-body activation;
- explicit or model-selected invocation;
- referenced resource loading, dependency checks, or packaged scripts;
- per-agent skill assignment;
- skill invocation telemetry; or
- installation, update, trust, signature, or marketplace behavior.

Orbit's current `Agent` owns a bounded model/tool loop. `ThreadManager` and the
public thread API provide application-facing lifecycle events and cancellation,
but Orbit does not implement a persistent multi-agent roster, asynchronous
agent-to-agent mailboxes, group conversations, routines, cron scheduling, or
external event subscriptions.

## Sources and Verification Scope

The investigation was performed on 2026-09-03.

| System          | Revision or snapshot                                                                                                                         | Evidence boundary                                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Grok Bot        | Official pages last updated 2026-08-11 through 2026-08-31                                                                                    | Product-visible behavior and documented limits only; no server source or stable documentation revision was published     |
| Grok Build      | [`72a61251fcffb464bcc687aeb5a998e5a98ec0c9`](https://github.com/xai-org/grok-build/tree/72a61251fcffb464bcc687aeb5a998e5a98ec0c9)            | Adjacent open-source xAI coding-agent implementation; not evidence that Grok Bot uses the same skill loader or scheduler |
| Agent Skills    | [`69ef37e9424c0a7ea9dd2293b559e43ec8176379`](https://github.com/agentskills/agentskills/tree/69ef37e9424c0a7ea9dd2293b559e43ec8176379)       | Open skill-package format and progressive-disclosure model                                                               |
| Codex           | `rust-v0.152.1`, [`5adb68a49933ae446bf11935662c83dba55a0804`](https://github.com/openai/codex/tree/5adb68a49933ae446bf11935662c83dba55a0804) | Production skill catalog, discovery, metadata budgeting, activation, and telemetry comparison                            |
| Pi Coding Agent | `v0.84.4`, [`b79e4cc834970cca69daebffab7df1da7d1e52c4`](https://github.com/earendil-works/pi/tree/b79e4cc834970cca69daebffab7df1da7d1e52c4)  | Minimal skill discovery, validation, collision handling, prompt exposure, and explicit invocation comparison             |

The Grok Bot documentation can change in place. Dates above identify the
official page versions visible during the investigation, but they are weaker
pins than source commits. Grok Build is inspected because it is the closest
published xAI implementation with skills and scheduling. No official source
states that Grok Bot embeds Grok Build, so this note keeps the two products
separate.

## Summary of Findings

The initial hypothesis is directionally correct about reuse and activation, but
not about the identity of a Bot.

1. A **Bot is not a Skill**. It is a durable, named agent with a role,
   description, separate conversation, learned memory, working context, enabled
   skills, and owned routines.
2. A **Skill is reusable procedural knowledge**. Grok Bot describes it as steps,
   decision rules, inputs and access, validation, output, and approval
   boundaries. Skills are available across a user's Bots but can be enabled per
   Bot.
3. A **Routine is the automation binding**. It assigns a workflow to exactly one
   owning Bot and starts it on a schedule or, where supported, an external
   event. A Routine is not part of Skill identity.
4. **Bot-to-Bot collaboration is message-driven**, not Skill-to-Skill calling.
   One Bot sends an asynchronous message that wakes another Bot. Group chats
   provide a shared transcript for visible handoffs.
5. **Execution capabilities are separate from skills**. Connectors/plugins,
   MCP tools, browser computer use, terminal access, files, and optional access
   to the user's local computer provide the means to act.
6. The hosted product is best understood as a persistent multi-agent
   application over a user-scoped execution environment, not as a skill library
   with a scheduler attached.

The smallest useful public model is:

```text
manual message ---------+
scheduled time ---------+--> Routine or direct request --> owning Bot
external event ---------+                              |     |
Bot handoff message -----------------------------------+     +--> select Skill
                                                               |
                                                               +--> tools / browser / files
                                                               |
                                                               +--> approval / result / handoff
```

## Grok Bot Product Architecture

### Bot: durable role and conversation boundary

The official Bot guide defines a Bot as a durable AI teammate with a name, job,
conversation, and working context that develops over time. A Bot description
holds standing responsibilities and safety boundaries, while an individual
message holds task-specific instructions.

Bots keep separate roles, conversations, and learned memory. Duplicating a Bot
copies its profile, settings, enabled skills, routines, and avatar, but not its
conversation history, learned memory, or chat attachments. Deleting a Bot
removes its active profile, conversation, and owned routines. These behaviors
show that Bot identity is a stateful aggregate rather than an alias for a skill.

### Skill: reusable procedure shared across Bots

Grok Bot defines a Skill as reusable instructions for how to perform a task. A
useful Skill records:

- when to use it;
- required inputs and access;
- work sequence;
- result validation;
- returned output; and
- mandatory approval points.

Users can create a Skill from written instructions or a completed task. The
Teach a task feature records up to ten minutes of visible browser interaction
and creates a draft Skill. The documentation warns that one demonstration does
not necessarily capture decision rules, failure handling, or approval
boundaries, so the draft must be reviewed and tested.

Skills are available across a user's Bots. Installed private Skills can be
enabled for an individual Bot, and packaged Skills can arrive through Plugins.
The composer uses `/` to reference a Skill, while `@` references Bots, groups,
Routines, and connectors. This UI distinction follows the underlying semantic
separation: a Skill changes how an agent performs work; it is not an addressable
agent or event source.

The Grok Bot documentation does not publish its on-disk Skill representation,
frontmatter schema, selection prompt, or activation algorithm. It must not be
claimed that Grok Bot stores the public Agent Skills `SKILL.md` format merely
because Grok Build does.

### Routine: trigger and ownership binding

A Routine tells one Bot when to run a workflow. Its documented configuration
includes the owning Bot, schedule and time zone, input source, expected result,
approval boundary, and missing-source behavior. Background Routines keep running
while the user's laptop is closed.

Cursor account integrations can start a Routine from supported external events,
such as a Slack message or GitHub notification. These event integrations are
documented as separate from ordinary Slack or GitHub Plugins and can require a
separate connection flow. This is direct evidence that event admission and tool
access are different concerns.

A Bot can own up to 50 Routines. Grok Bot retains the 20 most recent run records
for each Routine. Routines can be tested, paused, enabled, edited, inspected, and
deleted. Deleting the owner Bot deletes its Routines. The documentation also
recommends idempotent retries, stale-data policy, explicit partial-completion
reporting, and re-testing after source changes.

### Collaboration: asynchronous messages and visible groups

A Bot can send an asynchronous message to another Bot. The receiving Bot wakes,
handles the request, and may reply later. The handoff is visible in the
conversation. This is an application-level addressing and lifecycle mechanism:
it identifies a receiving agent, transfers task context, wakes a run, and
records the exchange.

Groups contain two to six Bots. Messages can address one or more named Bots, or
leave response selection to the participants. Bots can post into the group and
pass work among themselves. The documentation recommends one owner per stage
because broad parallel handoffs can duplicate work and generate noisy updates.
Bot-to-group handoff messages are currently text-only; images should be sent
directly to the Bot that must inspect them.

Skills can instruct a Bot to perform a handoff, but a Skill is not itself the
sender, receiver, mailbox, or run lifecycle. Calling this "Skill-to-Skill
coordination" would hide the persistent agent state and delivery semantics that
make the collaboration work.

### Execution environment: one computer per user, multiple Bot screens

The most specific and newest official documentation states that each user or
team member gets one managed Linux virtual machine. All of that user's Bots
share its files, browser sessions, sign-ins, command-line credentials, and
permissions. Each Bot gets a separate screen and several Bots can work in
parallel, but screens are work surfaces rather than security boundaries. One
Bot can run only one computer-use task on its screen at a time.

The shared `/workspace` supports file-based handoffs. Durable project files,
browser state, and supported sign-ins survive normal updates and recovery, while
temporary directories, manually installed packages, and uncommitted
application state should be treated as replaceable.

An overview sentence says each Bot runs on a persistent cloud VM, but the same
page and the newer team, security, FAQ, and computer pages consistently specify
one user-scoped computer shared by all Bots. This note uses the repeated,
specific user-scoped statement and records the overview wording as a
documentation inconsistency.

### Tools and trust boundaries

Bots act through structured connectors exposed as Plugins, MCP servers, browser
computer use, terminal and filesystem access, and optionally commands on the
user's local computer. Connectors are account-wide rather than isolated to one
Bot. Hosted MCP sign-in tokens remain in Cursor's backend, which executes those
tool calls on behalf of the computer; the tokens are not stored on the VM.

Consequential actions can require explicit approval. Auto Review evaluates tool
calls and computer actions against require-approval and always-allow rules, with
require-approval winning on a conflict. Sensitive interactive steps such as
passwords, passkeys, two-factor codes, CAPTCHAs, and payments use human takeover
or a masked secret request rather than ordinary conversation text.

Separate Bots are explicitly not a security boundary because they share the
computer. This constrains any Orbit analogy: per-agent skill enablement is a
capability-selection boundary, but it is not sufficient authorization or
credential isolation.

## State and Ownership Model

The documented scopes can be summarized as follows.

| Scope                   | Owned state or behavior                                                                                                      | Consequence                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Bot                     | name, role, description, conversation, learned memory, working context, enabled Skills, owned Routines, screen               | Stable role and lifecycle boundary                           |
| Group or direct handoff | shared messages, addressing, visible delegation and replies                                                                  | Coordination and context transfer boundary                   |
| User                    | one cloud computer, `/workspace`, browser sessions, command-line credentials, installed connectors, broadly available Skills | Convenience for handoffs, but no isolation among Bots        |
| Desktop installation    | personal Auto Review rules before synchronization, local-computer execution policy                                           | Local control can differ across desktop installations        |
| Team or organization    | Cursor SSO, privacy mode, team rules, MCP allow/deny policy, Plugin availability, Cloud Agents control                       | Administrative policy ceiling                                |
| Service                 | Routine scheduling and event admission, conversation synchronization, model routing and failover, retained run history       | Hosted control plane; implementation details are unpublished |

This model is stronger than "Grok Bot is a collection of Skills." A more
accurate statement is:

> Grok Bot is a hosted multi-agent application whose durable Bots use shared
> procedural Skills and execution capabilities; Routines and messages create
> new agent runs.

## Adjacent Grok Build Evidence

Grok Build is an open-source coding-agent product from xAI. At the inspected
commit it implements Agent Skills-like folders and discovers them from project,
user, Plugin, configured extra, Claude-compatible, and `~/.agents/skills/`
locations. Its frontmatter extends the portable core with `when-to-use`, `paths`,
`argument-hint`, `user-invocable`, and `disable-model-invocation`. Its
documentation explicitly says `allowed-tools` does not grant or restrict tools,
which avoids treating descriptive Skill metadata as runtime authorization.

Grok Build also implements recurring `/loop` scheduling and background
workflows inside its coding-agent host. A scheduled fire may run in a detached
background subagent or in the current session, depending on configuration. This
is contrary evidence against the broad claim that scheduling must always live
outside an agent product.

It does not change the narrower Orbit boundary. Grok Build is both a reusable
agent harness and a concrete CLI application, so it can legitimately include
application-owned scheduling. Orbit can keep trigger configuration out of its
core `Skill` model while allowing an Orbit application to provide scheduling.
The Grok Build source is not evidence for Grok Bot's unpublished backend.

## Comparison with Agent Skills, Codex, and Pi

The portable Agent Skills specification defines a Skill as a directory with
required `SKILL.md`, `name`, and `description`, plus optional scripts,
references, and assets. Its progressive-disclosure model loads metadata at
discovery, the complete instructions at activation, and supporting resources on
demand. It defines package representation and loading behavior, not schedules,
event subscriptions, agent mailboxes, conversations, or approval semantics.

Codex and Pi reinforce this separation:

| Concern                        | Codex 0.152.1                                                                             | Pi 0.84.4                                                                                  | Current Orbit                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| Discovery                      | Ordered host, repository, user, system, admin, Plugin, and environment-backed roots       | User, project, extension, and explicit paths                                               | None                                           |
| Validation                     | Parsed metadata, scope, policy, dependencies, interface, and load errors                  | Agent Skills name and description checks with diagnostics                                  | Limited extraction of `name` and `description` |
| Catalog conflicts              | Catalog and scope-aware ordering                                                          | First name wins; collision diagnostic identifies winner and loser                          | Not applicable; no catalog                     |
| Progressive disclosure         | Model-visible metadata catalog with bounded budget; explicit and implicit Skill injection | Metadata list in system prompt; model reads the Skill file, or explicit command expands it | Not implemented                                |
| Visibility and policy          | Enablement, implicit-invocation policy, product filtering, Plugin attribution             | `disable-model-invocation`; read tool required for automatic access                        | Not implemented                                |
| Observability                  | Explicit and implicit invocation telemetry and Plugin usage attribution                   | Load diagnostics and normal session transcript                                             | Not implemented                                |
| Scheduling and external events | Outside the Skill package                                                                 | Outside the Skill package                                                                  | Not implemented                                |

Codex additionally budgets Skill metadata against the model context window,
truncates descriptions fairly when necessary, and can omit entries with a
warning when even minimum catalog lines do not fit. This is concrete evidence
that metadata-only disclosure still needs scaling and diagnostics; merely
avoiding full Skill bodies does not make a large catalog free.

Pi is a useful smaller reference. It recursively discovers `SKILL.md`, validates
the open-format name and description constraints, follows symlinks while
deduplicating canonical paths, reports collisions, and exposes only Skill
metadata in the system prompt. The model then uses the read tool to load a
matching Skill. This is a practical minimum beyond Orbit's current `Skill`
value object.

## Analysis of the Proposed Responsibility Boundary

### What belongs to the book

The book should explain the semantic model and the implementation trade-offs:

- Skill versus Tool, MCP integration, Plugin distribution, Bot/agent identity,
  workflow, and trigger;
- the open Agent Skills package format and progressive disclosure;
- discovery scopes, precedence, collision handling, activation, and context
  budgeting;
- Skill portability versus vendor-specific metadata;
- dependencies and capability requirements versus actual authorization;
- trust, provenance, enablement, approval, observability, and evaluation; and
- why agent-to-agent messaging and schedules are not Skill composition.

The current book statement that the `SKILL.md` format is only an Anthropic
ecosystem convention is stale at this investigation date. The format now has a
separate open specification at agentskills.io and is implemented by Grok Build,
Codex, Pi, and other clients. The book should still distinguish the portable
core from vendor extensions and uneven field semantics.

### What belongs to Orbit core

If Orbit intends to support Skills as a reusable runtime capability, a
non-binding minimum scope is:

1. a specification-aware Skill package and metadata model;
2. configurable discovery roots with explicit scope and deterministic
   precedence;
3. validation, diagnostics, canonical-path deduplication, and collision policy;
4. an immutable catalog snapshot for each run or turn;
5. metadata-only model exposure with a context budget;
6. explicit and model-selected activation that loads the full instructions;
7. safe resolution of referenced files and declared capability dependencies;
8. enablement and policy inputs without confusing metadata with authorization;
9. invocation events and provenance for diagnostics; and
10. provider-neutral APIs so CLI, GUI, and third-party applications can present
    and manage the same catalog.

These responsibilities determine what instructions the agent can discover and
how they enter model context. They are part of runtime context assembly and are
reusable across applications.

### What belongs to an Orbit application or external control plane

The following concerns should not be fields on the portable `Skill` object:

- cron expressions, time zones, next-run calculation, and recurrence limits;
- webhook endpoints, event-source authentication, filtering, deduplication, and
  retry queues;
- the binding from one trigger to one agent, thread, input, and result channel;
- a persistent Bot roster, group membership, mailboxes, and ownership transfer;
- desktop or mobile notifications;
- installation UI, marketplace browsing, and account administration;
- organization billing, usage caps, and hosted model routing; and
- browser or desktop takeover UI.

An Orbit application may implement all of these. The reusable core should still
accept enough invocation metadata to preserve causality, cancellation,
idempotency keys, approval state, and audit correlation once an application
starts a run. Keeping scheduling out of core does not mean the runtime may
discard trigger identity or execution policy.

### A useful separation of records

A future design can avoid conflating the concepts by keeping four records
separate:

```text
SkillDefinition
  id, version, metadata, instructions, resources, provenance

AgentProfile
  id, role, durable context policy, enabled_skill_ids, capability policy

AutomationBinding
  id, owner_agent_id, trigger, input mapping, output target, approval policy

AgentMessage
  sender_agent_id, recipient/group_id, task payload, correlation, delivery state
```

The application can convert a manual message, AutomationBinding fire, or
AgentMessage delivery into one provider-neutral Orbit invocation. The Orbit
runtime can then resolve the AgentProfile's enabled Skill catalog and execute a
normal bounded turn.

## Non-binding Implications for Orbit

1. Continue treating Skill as procedural context, not as an executable agent,
   scheduler job, Tool, or security principal.
2. Expand Orbit's Skill work first toward the open Agent Skills core:
   validation, package discovery, scope resolution, catalog snapshots,
   progressive disclosure, and invocation diagnostics.
3. Keep vendor extensions in namespaced metadata or adapters. Grok Build's
   `when-to-use` and `paths` are useful experiments, but they are not portable
   core fields.
4. Make Skill requirements visible to selection and UI, but enforce access in
   Tool, connector, filesystem, sandbox, and approval policy. A metadata field
   alone must not grant authority.
5. Let applications bind triggers to agents or threads through a separate
   automation API. A simple callback into `ThreadManager` is insufficient unless
   it also handles durable delivery, idempotency, cancellation, ownership, and
   run correlation.
6. Model inter-agent collaboration as messages or delegated runs with explicit
   identities and state, not as Skill calls.
7. Add evaluation hooks before self-authored or demonstration-derived Skills
   become enabled for unattended execution. Grok Bot's "draft, review, test,
   then schedule" sequence is a useful lifecycle even though its internal
   representation is unknown.
8. Do not use per-agent Skill enablement as a security boundary when agents
   share tools, credentials, or a filesystem.

## Risks and Limitations

- Grok Bot's backend source, schemas, delivery guarantees, isolation mechanism,
  model prompts, memory implementation, and Skill storage format are not public.
- Official documentation is mutable and does not expose a commit or immutable
  version. Page update dates are the best available first-party snapshot.
- The documentation describes product semantics, not proof of failure handling
  under outages, duplicate events, partial execution, or concurrent handoffs.
- The overview contains conflicting wording about per-Bot versus per-user
  computers. Newer and more specific pages support the per-user interpretation.
- Grok Bot's event integrations are described only by examples. Supported event
  types, delivery guarantees, filtering grammar, ordering, replay, and retry
  contracts are not documented.
- Routine history is limited to 20 recent runs, and the team documentation says
  a broader audit view is still forthcoming. The available observability should
  not be assumed sufficient for regulated or high-consequence workflows.
- Grok Build, Codex, and Pi are coding agents. Their open Skill implementations
  are useful architectural comparisons but do not establish Grok Bot internals
  or general business-workflow reliability.

## Open Questions

1. Does Grok Bot persist Skills in the open Agent Skills format, another
   structured representation, or a service-owned database?
2. Does a Routine reference a versioned Skill, copy instructions at creation,
   or resolve the current Skill on each run?
3. What happens to active and historical Routines when a Skill is edited,
   disabled, deleted, or replaced by a Plugin update?
4. How are duplicate external events, delayed delivery, retry backoff,
   idempotency, and exactly-once-looking user experiences handled?
5. Does a Bot-to-Bot message create a new thread turn, resume an existing run,
   or enqueue a separate durable job?
6. Which Bot state is included in an asynchronous handoff, and how is context
   minimized or access-controlled?
7. Are Skills versioned, signed, scanned, or associated with provenance and
   evaluation results before account-wide enablement?
8. Can team policy constrain individual Skills independently from the Plugin or
   MCP server that distributes their tools?
9. What stable application-facing contract should Orbit expose for catalog
   snapshots, activation, and invocation provenance before adding any scheduler?

## Related Decisions

No Orbit ADR currently adopts a Grok Bot-like persistent agent roster, Skill
catalog, Routine model, or Bot-to-Bot messaging system. Any such adoption should
use this note as evidence and remain a separate decision.

## References

### Grok Bot official documentation

- [Grok Bot overview](https://docs.x.ai/grok-bot/overview), last updated
  2026-08-11.
- [Create and manage Bots](https://docs.x.ai/grok-bot/bots), last updated
  2026-08-22.
- [Message and collaborate](https://docs.x.ai/grok-bot/chat-and-collaboration),
  last updated 2026-08-11.
- [Use the computer and apps](https://docs.x.ai/grok-bot/computer-and-apps),
  last updated 2026-08-11.
- [Skills and routines](https://docs.x.ai/grok-bot/skills-routines-and-automations),
  last updated 2026-08-11.
- [Approvals, security, and privacy](https://docs.x.ai/grok-bot/approvals-security-and-privacy),
  last updated 2026-08-22.
- [Grok Bot for teams and enterprises](https://docs.x.ai/grok-bot/teams-and-enterprises),
  last updated 2026-08-31.
- [Frequently asked questions](https://docs.x.ai/grok-bot/faq), last updated
  2026-08-22.

### Skill format and implementation comparisons

- [Agent Skills specification at the inspected revision](https://github.com/agentskills/agentskills/blob/69ef37e9424c0a7ea9dd2293b559e43ec8176379/docs/specification.mdx).
- [Grok Build skills guide at the inspected revision](https://github.com/xai-org/grok-build/blob/72a61251fcffb464bcc687aeb5a998e5a98ec0c9/crates/codegen/xai-grok-pager/docs/user-guide/08-skills.md).
- [Grok Build Skill discovery at the inspected revision](https://github.com/xai-org/grok-build/blob/72a61251fcffb464bcc687aeb5a998e5a98ec0c9/crates/codegen/xai-grok-tools/src/implementations/skills/discovery.rs).
- [Grok Build scheduler slash-command contract at the inspected revision](https://github.com/xai-org/grok-build/blob/72a61251fcffb464bcc687aeb5a998e5a98ec0c9/crates/codegen/xai-grok-tools-api/src/slash_commands.rs).
- [Codex Skill metadata at the inspected release](https://github.com/openai/codex/blob/5adb68a49933ae446bf11935662c83dba55a0804/codex-rs/skills/src/model.rs).
- [Codex Skill catalog rendering and context budget at the inspected release](https://github.com/openai/codex/blob/5adb68a49933ae446bf11935662c83dba55a0804/codex-rs/ext/skills/src/render.rs).
- [Codex Skill invocation handling at the inspected release](https://github.com/openai/codex/blob/5adb68a49933ae446bf11935662c83dba55a0804/codex-rs/core/src/skills.rs).
- [Pi Skill loading and prompt rendering at the inspected release](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/src/core/skills.ts).
- [Pi system-prompt assembly at the inspected release](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/src/core/system-prompt.ts).
