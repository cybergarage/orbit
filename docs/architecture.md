# Current Architecture

This document maps the Orbit implementation at the current repository state.
It describes existing components in the present tense. Directional concepts
that are not implemented belong under [Concepts](concepts/README.md), and the
rationale for significant choices belongs in
[Architecture Decision Records](adr/README.md).

## Plugin composition

`src/core/plugins/` inspects explicit local Agent Plugins packages and binds
Skill roots and stdio server descriptors. `src/apps/plugins.ts` supplies common
CLI/GUI activation. Agent validates loaded configuration before a Run, composes
plugin servers with native settings and keeps the existing Skill selection and
tool execution paths. Startup failure isolation does not bypass the Run's
unknown-operation barrier. See [Agent Plugins](plugins.md) for the public contract.

## System overview

Orbit is a TypeScript agent framework with an oclif-based CLI and a loopback-only
local GUI as application surfaces. All application surfaces use components from
the reusable runtime under `src/core/`. The runtime connects workspace configuration and context, a
provider-neutral model interface, tool registries, persisted sessions,
structured logs, and thread lifecycle events.

`src/core/projects/` provides an explicitly opened Project catalog. Its shared
transaction engine backs an in-memory test adapter and a worker-owned SQLite
adapter. It stores Project metadata, membership revisions, pending creation
reservations, curated memory rows and idempotent operation results separately
from transcripts. `ProjectService` coordinates registered session writers with
those transactions; `OrbitApplicationService.createProjectThread` resolves a
separate workspace runtime before publishing a committed thread. GUI routes and
sidebar controls use that service. The GUI sidebar component owns navigation
menus and dialogs; its list model maintains independent Project/Recent pages
and rejects stale responses without changing the selected conversation.
`ProjectMemoryService` validates registered sources and captures bounded context.
Managed Agent/Graph runs acknowledge a journal-v3 `project-context` record before
effects and add its fixed user-role prefix to prepared requests, separately from
canonical history and compaction. GUI memory controls expose edits, selection,
preview and historical snapshots. See [Projects](projects.md).

```text
CLI exec / interactive       Local GUI
          |                      |
          |            OrbitApplicationService
          |                      |
          |                ThreadManager
          |                      |
          +---------> Agent <----+
                   /   |    \
              Model  Tools  Session
                |      |       |
           provider  built-in, records and
           adapters  custom,   persistence
                     and MCP
```

## Application surfaces

- `src/apps/cli/` contains oclif commands and command-specific input and output.
- `src/apps/gui/` contains the loopback HTTP server and React client. Its
  server delegates runtime behavior to `OrbitApplicationService`.
- `src/core/application.ts` provides the application service used by the GUI.
  It resolves settings and context, owns thread, session, log, and diagnostic
  services, and exposes runtime snapshots.
- `src/core/thread.ts` manages in-memory thread lifecycles, active runs,
  cancellation, event translation, and session ownership.

CLI `tools` / `mcp list` and interactive `/tools` / `/mcp` share metadata
inspection in `src/core/tools/inventory.ts`. Local inspection reads configured
catalogs without an Agent. Optional MCP discovery reuses `RunSupervisor` and
managed MCP startup in a transient, memory-journaled Run. It does not invoke a
model or append to a conversation. See [Tool inventory](tools.md#inspecting-tools-and-mcp-servers).

## Agent turn lifecycle

`Agent` in `src/core/agent.ts` is the current orchestration boundary. One
invocation performs the following sequence:

1. `RunSupervisor` deduplicates submitted input and acknowledges admission in
   the required execution journal before starting execution resources.
2. Agent records turn context, start and input messages. It resolves selected
   Skills and synchronizes their complete snapshot, authorizes MCP startup,
   discovers tools and acknowledges journal readiness before any model call.
3. Agent builds session context with the one-Run Skill prefix, invokes the model
   and records its response. Budgeted preparation excludes that prefix from the
   dedicated summary call and restores it for ordinary answering iterations.
4. Parse each tool call, prepare its immutable operation, decide policy, obtain
   any single-operation approval, and acknowledge intent before dispatch.
5. Record known tool outcomes and repeat under shared optional execution ceilings (unlimited by default), until completion, cancellation or failure.
6. Settle owned work and cleanup, synchronize the transcript, and acknowledge
   one terminal journal summary. Return an immutable `RunResult`; uncertainty
   produces `incomplete` and retains affected resources for reconciliation.

`execution/limits.ts` defines validated defaults and structured exhaustion decoding.
Workspace, Agent and submission overrides feed the same Run limits. Agent records
error results for batches stopped before dispatch. `session/budget-continuation.ts`
checks explicit continuation and can append verified legacy nondispatch notices
under the new Run's writer ownership. GUI/application surfaces expose limits,
restore saved status and submit a new request with the previous Run ID; they do not
replay operations or rewrite terminal results.

`src/core/execution/` owns lifecycle, authorization, required storage and
recovery. ThreadManager and application surfaces project its snapshots. Model
iterations are sequential. Managed read/list/grep/glob calls may be batched;
mutations, custom tools and MCP calls are serial barriers. See
[Managed Execution](execution.md) for public APIs, ownership and migration.

This is a fixed, bounded model/tool loop. The runtime does not currently
interpret a general execution graph or change its topology between turns.

## Model boundary

`src/core/models/model.ts` defines a provider-neutral `Model` interface that is
also an `Operator`. Provider adapters under `src/core/models/adapters/` own
request and response serialization for OpenAI, Anthropic, and Ollama.
`ModelRegistry` selects registered providers without placing provider switches
inside the agent loop.

The normalized output-part type represents text, reasoning, refusal, media,
citations, and tool calls. OpenAI and Ollama construct supported parts; the
Anthropic adapter currently extracts text and tool calls without constructing
parts. These projections do not preserve every provider block or original
ordering. Provider-only metadata is kept in a JSON-serializable field.

Display text falls back to the OpenAI refusal or audio transcript when the
primary content is empty. Normalized response parts remain separate from that
display text. Tool failure projection recognizes both the message-level and
nested tool-result error flags; Anthropic emits `is_error` for either, while
OpenAI and Ollama send the corresponding textual error marker. This does not
make every provider-specific response block replayable across providers.

## Tool boundary

`src/core/tools/` separates model-facing tool specifications from executable
handlers. `ToolRegistry` validates names and rejects collisions, then creates a
snapshot used by `ToolRuntime`. The runtime validates tool input, applies
scheduling rules, and converts failures to tool results.

Built-in coding tools, custom tools, turn-scoped tools, and tools discovered
through MCP share this execution boundary. MCP is an integration source for
tools; it is not the runtime's general composition mechanism.

Managed MCP discovery checks a bounded schema vocabulary before model exposure.
The existing SDK validator handles the recognized Draft 7 declaration and URI
format; invalid arguments do not reach operation approval or remote dispatch.
See [the maintained schema profile](tools.md#managed-mcp-schema-support).

## Operator and Processor boundary

`src/core/processor/` provides the current composition primitives:

- `Operator` defines a named asynchronous `invoke` contract.
- `Agent`, `Model`, and `Tool` implement `Operator`.
- `OperatorSequence` passes each operator's output to the next operator in a
  non-empty linear sequence.
- `Processor` extends `Operator` with required `name` and `type` identity.
- `ProcessorRegistry` registers processors by their type and name.

The current `Processor` types reuse `OperatorType`, whose supported values are
agent, model, sequence, and tool. The bounded Graph compiler/executor is a separate explicit API in the same package. It validates immutable JSON descriptors and trusted versioned adapters, then reuses Agent's managed setup and shared loop. Serial nodes and routers share one Run, protected Session turn, catalog and Skill snapshot. `graph-journal.ts` validates required v2 visits/transitions and `graph-inspection.ts` observes them without execution. `ThreadManager` and `OrbitApplicationService` provide typed Graph submission and observation. See [Managed Processor Graphs](processor-graphs.md) for limits and migration.

## State and persistence

`State` currently owns a `Session`. The session package records messages, turn
context, turn terminal events, and session metadata. `SessionContextBuilder`
derives model input from those durable records. With an enabled `ContextPolicy`,
`session/context-policy.ts` prepares the complete frozen provider request, charges
a tool-free summary call to the same Run, synchronizes a v2 checkpoint and then
selects the retained suffix. `session/compaction.ts` validates source digests,
predecessors and tool groups. `session/migration.ts` upgrades closed v1 files
under stable Session exclusion; ordinary recovery refuses pending migration.
The [compaction guide](context-compaction.md) owns profiles and migration details.

`SessionRepository` creates, opens and lists append-only session files.
`SessionDeletionService` removes managed artifacts under the stable Session-ID
owner, preserving a minimal deletion marker. `session/coordination.ts` validates
v2 reciprocal storage bindings and their pair identity at ownership boundaries.
`session/storage-registration.ts` controls offline initialization, read-only
inspection and explicit resume, using persistent guards in both roots and
mandatory file/directory synchronization. Pending registration refuses writable
scopes; final guard removal and API acknowledgement are distinct.
The coordination module serializes owner transitions with exclusive
guards; abandoned guards require offline recovery. `SessionRecorder` retains
ownership through queued writes and delegated journal I/O. `writer-lease.ts`
validates single-consumer journal capabilities before persistent open.
Session records reconstruct history, optional logs support diagnostics, and
journals preserve admission and operation evidence. All persistent entry points
use the same registered roots; see [storage migration](session-storage.md).

`session/storage-reset.ts` implements explicit offline test reset separately
from Session deletion. `apps/storage-reset.ts` selects and previews the CLI/GUI
storage targets and obtains destructive confirmation. Reset invalidates bindings
and clears selected session, journal, log and Project database storage under
operator-maintained exclusion; it never runs as an online GUI endpoint. See
[offline reset](session-storage.md#clear-test-storage-offline).

## Configuration and context

Workspace settings are merged from discovered `.orbit/settings.json` files and
explicit options. System context is loaded from `ORBIT.md` and `AGENTS.md` in
qualifying ancestor workspaces. Provider credentials and connection settings
remain configuration inputs rather than persisted session content.

## Observability and control

Agent, model, tool, turn, and thread boundaries emit structured events.
Session-scoped logs retain correlation identifiers for application, session,
thread, run, turn, and iteration where applicable. Abort signals propagate
through the shared supervisor, model calls and tool execution. A bounded result
does not imply that noncooperative work stopped. Required recording failure is
reported independently from the known execution outcome; observers are optional.

The GUI boundary is loopback-only and requires a startup capability token for
assets, APIs, and event streams. Origin checks, request limits, and schema
validation remain part of that boundary.

## Current extension seams

Orbit can currently be extended through registered model providers, custom and
MCP tools, workspace settings and context, injected dependencies at external
boundaries, and the public thread event API. These are implemented seams, not a
plugin system for replacing every runtime component.

General parallel Graph composition and adaptive execution remain directional.
They must pass through research and ADR review before they change the runtime.

## Related documentation

- [Concept Overview](concepts/overview.md)
- [Agent Runtime](concepts/agent-runtime.md)
- [Processor Model](concepts/processor-model.md)
- [Coding Tools](tools.md)
- [Sessions](session.md)
- [Session Logs](logging.md)
- [GUI Integration](gui-integration.md)
- [Architecture Decisions](adr/README.md)

## Selected instructions

`src/core/skills/` owns explicit-root discovery, the strict YAML parser, bounded
asynchronous loading, source identity and the revisioned snapshot validator.
The legacy single-file Skill remains separate. Applications select catalog
roots and ordered ID/digest pairs; core searches no implicit locations.
Agent tracks loading/saving in its Run and adds frozen instructions to ordinary
requests. Session v2 records retain exact sources without projecting old bodies
as new instructions. Journal admission/readiness records contain metadata only.
ThreadManager compares selections before replay; CLI, Ink and GUI share that
contract. Product root discovery lives in `src/apps/skill-catalog.ts`.
Skill catalogs retain descriptive metadata, portable string-map metadata and
informational allowed-tools. Versioned projections preserve old validation and
use v3 for portable fields, empty bodies and plugin path provenance. Plugin
resource reads remain separate from persisted SKILL.md snapshots.
See [Explicit Skill selection](skills.md) for APIs, limits and reader migration.

## Read-only workflow evaluation

`src/core/evaluation/` provides bounded JSON parsing, closed revision-1 schemas,
trusted-plan validation, evidence inspection and report comparison. Public APIs
are exported through both package entry points. `json.ts` checks input bounds
before materializing the tree; `plan.ts` validates schedules and seals immutable
reports; `evidence.ts` reuses journal, transcript/Skill and Graph validators;
`metrics.ts` preserves units, provenance and coverage; `comparison.ts` enforces
one trial per slot, revision history and per-variant denominators.

The module consumes supplied text only. It does not call the filesystem journal
inspector, Agent, models, tools, graders or application services. Applications
continue to use the existing managed Run/Graph entry points for execution and own
isolation, independent grading and exported reports. No execution resource,
authorization path, mandatory record version or deletion scope is added. See
[Workflow evaluation](workflow-evaluation.md) for the public format and trust limits.

## Human-selected workflow coordination

`src/core/selection/validation.ts` reuses evaluation for immutable finite candidate eligibility. `store.ts` defines the strict control-state reader, transactional-host contract and volatile memory store. `service.ts` serializes human choice and request capture through that port, retains full input/evidence history and grants one live dispatch. `recovery.ts` performs bounded read-only HMAC journal correspondence checks without writer acquisition.

Application Service binds selected Threads and routes through the existing ThreadManager and Agent Graph path. `binding.ts` and Agent's shared submission projection bind expectations to Run replay; existing owned preparation checks the declaration and actual catalog/Skill snapshot before ready. This adds no runner or mandatory journal version. Standard surfaces do not supply a selection deployment; unknown GUI selection protocol rejects. See [Workflow selection](workflow-selection.md) for host authority, persistent qualification, limits and migration.

## Verified interrupted context

`session/interrupted-context.ts` validates narrow nondispatch correspondence and deterministic derivation. `verified-context.ts` runs owned asynchronous preflight and rechecks in the common Agent/Graph preparation path. The recorder verifies current storage ownership and bounded source bytes; `session/evidence-io.ts` compares detectable path identities through acknowledgement and retains failed closes for managed cleanup; the journal synchronizes and rereads the retained key and complete records. Transcript v3 stores provenance; compaction keeps raw-source hashes and separate projected-group validation. The synchronous builder refuses dependent histories. A separate v2-to-v3 migration retains data bytes, high-water positions and backups. Session coordination reuses journal ordering/schema validation and read-only Graph inspection before maintenance, requiring settled original outcomes and matching transcript positions across per-Run v1/v2/v3 records. See [verified interrupted context](interrupted-context.md) for public policy, limits and recovery conditions.

## Model context capacity

`models/context-capacity.ts` reconciles provider model information with runtime
configuration and accounting ceilings. Adapters own Ollama and Anthropic discovery
and the exact-ID OpenAI specification catalog. Budgeted session preparation uses
these limits before building requests and pins Ollama context on the wire.
Unknown capacity remains explicit; disabled budgeting does not perform discovery.
See [Model context capacity](model-context-capacity.md) for the public contract.

Budgeted context preparation can compact completed rounds within an active Run.
Projection-version-3 checkpoints retain exact current-Run user references and
validate tool-group boundaries on save/reopen. Provider termination is checked
before assistant history append or tool dispatch. A classified context or
truncation failure permits one regeneration only after a strictly smaller
checkpoint is committed. Summary and retry consume the same Run budgets.
See [Input budgets](context-compaction.md).
