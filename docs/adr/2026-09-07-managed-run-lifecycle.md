---
status: proposed
proposed-date: 2026-09-07
decision-date: null
implementation-status: not-started
implementation-completed-date: null
implementation-commits: []
superseded-by: []
---

# Managed Run Lifecycle

## Purpose

Make a run mean the same thing when started from the CLI, GUI, or library.
A caller must be able to request a stop, discover whether owned work actually
settled, and distinguish a successful answer from a failure to save its result.
Today a rejected batch or an accepted cancellation can leave work outstanding.

## Decision

**Proposed, not accepted.** Introduce a provider-neutral run supervisor in core.
It owns admission, the active run ID, a shared budget, started work, one terminal
result, and resource cleanup. Agent retains the model/tool loop; ThreadManager
and Application Service delegate execution ownership to the supervisor. All
supported Agent invocation paths use it, including direct library calls.
A future Processor can receive the same context without choosing a Graph design
in this ADR.

### Admission and public behavior

Names below specify proposed contracts, not existing exports or fixed filenames.

- `startRun` validates input, finite limits, and policy/recording configuration
  before admitting work. It returns a handle with run ID, session ID, snapshot
  access, `requestStop`, and a `finished` promise returning `RunResult`.
- One Agent and one session admit at most one active run per supervisor. Busy
  submissions return a typed rejection; this proposal adds no task queue.
  Admission keeps a single immutable configuration generation containing cwd,
  model selection, tool catalog, policy, and budget. The caller supplies the
  resolved settings for a resumed session; redesigning setting precedence is
  separate work, and mixing two generations during a run is prohibited.
- For persistent mode, admission is acknowledged only after the journal stores
  the request ID, input digest, configuration identity, and run ID. A per-session
  request ID is mandatory at retryable transport boundaries. Identical retries
  return the existing handle/snapshot; the same ID with different input returns
  a conflict. Recovery never restarts the old operation automatically.
- Core exposes `getRun` and a versioned snapshot. Snapshots include run ID,
  session ID, phase, pending approval IDs, budget use, stop request, and terminal
  result when present. REST responses project these values; SSE events include
  run ID and monotonically increasing per-run sequence. Sequence gaps trigger a
  snapshot fetch, not speculative completion. Terminal snapshots remain
  queryable for the retained journal's lifetime; ephemeral mode is process-only.
- Local slash commands return a distinct command result and do not fabricate a
  run ID. UI appearance and slash-command vocabulary remain surface-specific.

### State and terminal semantics

| State or field       | Proposed meaning                                                                                                                                                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `running`            | Work is admitted and may start permitted operations.                                                                                                                                                                                         |
| `awaiting-approval`  | A decision is pending; this can coexist with already-started permitted reads, listed in the snapshot.                                                                                                                                        |
| `stopping`           | Admission of new model/tool/startup operations is closed; cancellation and settlement are in progress.                                                                                                                                       |
| `finalizing`         | No new work starts; collected outcomes and required records are being finalized.                                                                                                                                                             |
| Terminal `RunResult` | One immutable live result with `outcome`, `reason`, `stopRequest`, `operations`, `quiescence`, `recording`, and `cleanupErrors`. Recovery can attach separately labeled recording evidence without claiming the original caller received it. |

`outcome` is `completed`, `cancelled`, `budget-exceeded`, `failed`, or
`incomplete`. `completed` requires required records acknowledged and no
unresolved owned work. It means the agent turn finished, not that edited code
passes tests. Empty/refused/truncated provider responses retain a distinct
response disposition; application-level success criteria remain outside core.

`incomplete` takes precedence when an operation's effects or owned cleanup remain
unconfirmed at the settlement deadline. Otherwise a required recording failure
or runtime failure produces `failed`; a prior budget stop produces
`budget-exceeded`; a user stop produces `cancelled`. Preserve all observed causes
and per-operation results even when a higher-priority outcome applies. A
cancelled run may have successfully edited a file before stopping. A saved
operation success does not erase a subsequent save failure.

A terminal journal entry contains execution and prior barrier facts, while the
live result also reports whether its final acknowledgement arrived. The journal
ADR defines reconciliation after a lost acknowledgement; this does not authorize
a second terminal execution or a retry of an effect.

A stop request linearizes against operation dispatch: after core accepts it,
no new operation can consume a start permit. A request racing a committed terminal
result returns `already-terminal` and does not change that result. Concurrent
user/deadline stops retain the first accepted stop reason and subsequent causes.
An acknowledged stop response means `requested`, never `terminated`.

Started parallel operations remain registered independently of aggregate
promises. Core waits for every started operation, collects settled results, and
records a not-started outcome for calls it did not dispatch. A noncooperative
promise cannot be forcibly stopped in JavaScript. At the cleanup deadline,
return `incomplete`, list unresolved operations/resources, and quarantine their
session and declared conflicting workspace resources within this supervisor.
No later event rewrites the terminal result; late settlement is a separate
observation and may release the quarantine after recording it. A fresh process
must reconcile unresolved journal entries before reusing that session. This is
not global exclusion of arbitrary processes using the same directory.

### Shared budget and retries

Core requires finite positive time limits and nonnegative integer counters;
products provide the proposed initial profile below. Applications may supply
other finite limits, and tests inject the clock. These initial values are
operational proposals, not measured optimal defaults.

| Limit                  | Initial product proposal | Accounting                                                                                                                                                                               |
| ---------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Total elapsed deadline | 10 minutes               | Monotonic time from admission, including startup, model calls, approvals, retries, and finalization.                                                                                     |
| Model invocations      | 6                        | Reserve immediately before each adapter invocation; refusals and failed invocations count.                                                                                               |
| Tool requests          | 32                       | Count each requested call, including invalid, denied, and cancelled-before-start calls, to bound repeated requests. An oversized batch admits no calls and reports the exhausted budget. |
| Tool rounds            | 5                        | Retain the current nonnegative integer loop meaning in the compatibility adapter.                                                                                                        |
| Approval wait          | 5 minutes maximum        | Minimum of this limit and the remaining run deadline. No pause of the total clock.                                                                                                       |
| Cleanup grace          | 5 seconds                | Separate bounded allowance after admission closes; not extra time for new work.                                                                                                          |

MCP startup uses the run's remaining deadline and a finite startup allowance
(default 30 seconds per server, at most 16 configured servers in this profile).
Each started connection is registered before connect/discovery. Creation failure
closes partial resources; close prevents reinitialization. Run-scoped MCP clients
are the initial managed-mode ownership choice, avoiding cross-run permission
leases. Borrowed clients require explicit owner and settlement capabilities;
unknown remote termination remains visible.

Built-in adapters disable hidden SDK automatic retries for this initial profile;
core starts with zero automatic retries. A model selecting another tool call is
a new budgeted request, not a retry. If retry is added later, attempts and waits
must consume the same budget. Arbitrary custom adapters must declare any hidden
attempt accounting limits; the supervisor bounds their invocation count and
elapsed waiting, not unobservable remote requests. Token estimation/compaction
and monetary budgets remain separate decisions.

### Resource ownership and close

A scope records resources as owned or borrowed at creation. The owner closes
resources exactly once; borrowing never transfers ownership implicitly. The
supervisor owns its run timers, approval waits, and clients it creates. Sessions
and stores created by a service belong to that service; injected resources belong
to the caller unless explicit transfer is requested. Resource leases prevent a
service from closing a store while its started work still needs recording.

`close` first closes admission, requests stops, awaits bounded settlement, then
closes owned clients, flushes/finalizes required records, and closes owned stores.
All failures are collected without skipping later cleanup. Repeated close calls
share one completion and report the same outcome. Unresolved resources remain
registered/quarantined; a bounded return never claims they are closed.
Deleting an active or quarantined session is rejected until reconciliation.

### Surface migration

Keep the accepted local GUI service and REST/SSE architecture. CLI Ctrl+C calls
`requestStop` and awaits the result; GUI Stop displays stopping until it receives
an authoritative result. Losing an SSE connection does not itself stop a run.
Process shutdown calls the common close path. Reconnection can query pending
approvals while that process remains alive.

Preserve `Agent.invoke`/`run` convenience return types where feasible: delegate
to the supervisor, return the message on `completed`, and throw a typed error
carrying `RunResult` otherwise. Expose the handle API for callers needing full
control. Do not silently change CLI transcript persistence: select durable or
explicit ephemeral recording based on the entry point's existing save mode.
The authorization ADR specifies the separate full-access compatibility change.

## Consequences

- Positive: stop, completion, and reconnect describe the same run across all
  supported entry points; failed batch waits cannot hide registered work.
- Negative: a public result contract, ownership tracking, finite defaults, and
  quarantine make lifecycle handling more complex and may reject formerly
  accepted concurrent or indefinitely waiting calls.
- Neutral: output quality and target-project test success remain application
  judgments. The proposal supplies no distributed scheduler or OS sandbox.

## Context and Problem Statement

At Orbit `8ee97144c20b006225db52efc482004200527e4c`, ToolRuntime aggregates
parallel execution with `Promise.all`, ThreadManager has idle/running state and
boolean cancellation, Agent closes MCP without supervising an active invoke,
and Application Service discards completion rejection after returning IDs.
A03/A08/A09/A10/A11 document reproducible gaps between those operations and the
book's stop/save/reconnect requirements. Existing tests confirm cooperative
cancellation and rejection of concurrent ThreadManager runs, but do not establish
noncooperative settlement or a shared library lifecycle.

## Decision Drivers

- Preserve results of already-started effects while stopping future work.
- Make finite resource use and ownership independent of UI choice.
- Keep the Agent model loop reusable without deciding the future Graph shape.
- Preserve transcript reads and avoid accidental duplicate effects on retry.

## External Implementation Research

Source inspection on 2026-09-07 used Codex
`5adb68a49933ae446bf11935662c83dba55a0804` (`rust-v0.152.1`) and Pi
`b79e4cc834970cca69daebffab7df1da7d1e52c4` (`v0.84.4`).
Codex `core/src/tasks/mod.rs` requests cancellation, waits for a grace period,
aborts the task handle, then runs task cleanup; its MCP connection manager
cancels startup separately. Adopt the separation of request, wait, and ownership,
not Rust task abortion as a JavaScript guarantee.
Pi `packages/agent/src/agent.ts` separates `abort` and `waitForIdle`;
`agent-loop.ts` prepares/executes calls and waits for asynchronous event handling.
Adopt a completion handle, but keep optional observers outside required lifecycle
completion. Pi shell cleanup is a useful adapter example, not proof that every
custom tool is stoppable. Neither inspection establishes Orbit's proposed shared
budget or a universal no-effects-after-timeout guarantee.

## Considered Options

| Option                                                           | Advantages                                               | Costs and disposition                                                                   |
| ---------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Keep independent Agent/UI lifecycles                             | Smallest change and current API compatibility.           | Cannot make cancellation, recording, and reconnect agree. Not recommended.              |
| Require every operation to settle without a deadline             | Simple meaning of fully stopped.                         | Noncooperative work can hang close forever. Not recommended.                            |
| Core supervisor with bounded settlement and explicit uncertainty | Reusable, finite caller waiting, honest partial results. | Requires quarantine and richer results. Recommended.                                    |
| Run everything in disposable workers/containers                  | Can strengthen local termination and isolation.          | Large deployment change; still no rollback of remote effects. Separate future decision. |

## Implementation and Confirmation

Implementation has not started. The baseline passed headers, build, and 293
existing tests as recorded in the research; those tests do not validate this ADR.
If accepted, implement core ownership/results first, then wire Agent, threads,
services, and surfaces; integrate required journal and authorization before
claiming the full confirmed-editing workflow is delivered. Update architecture,
concepts, public exports, CLI/GUI guides, and close/resume documentation.

Required new confirmation cases:

1. Cooperative and noncooperative model/tool doubles; stop before dispatch,
   during an approval, during a parallel batch, and during finalization.
2. One early rejection plus one late mutation; preserve both outcomes, quarantine
   conflicts, emit exactly one terminal result, and report late settlement.
3. Fake-clock deadlines, invalid limits, excess batch calls, MCP startup timeout,
   and hidden retry configuration checks; no operation starts after stop.
4. Repeated and concurrent close; borrowed stores remain open; all owned cleanup
   attempts occur even if one throws; unresolved work is not marked closed.
5. Identical/different duplicate request IDs, lost HTTP reply, SSE gap, stale UI
   event, and reconnect during approval; same facts through CLI, GUI, and library.
6. Target-project tests may fail while the run completes; application tests must
   distinguish that outcome from core failure and from unsaved results.

## Follow-up Work

Before acceptance, the author should explicitly judge bounded incomplete results,
initial limits, and public result/close compatibility. Implementation must prove
platform-specific child cleanup with fixtures; Windows and real MCP shutdown
remain unverified. Input/compaction, Skill identity, Graph structure, evaluation,
and candidate selection are later proposals using this lifecycle.

## References

- [Research and source ledger](../research/2026-09-07-run-execution-approval-and-recording.md).
- [Prepared Operation Authorization](2026-09-07-prepared-operation-authorization.md).
- [Required Execution Journal](2026-09-07-required-execution-journal.md).
- [Accepted GUI architecture](2026-08-22-gui-application.md): retained; this proposal extends its shared runtime contract.
- [Accepted model/tool integration](2026-08-23-model-response-tool-integration.md): retain provider-neutral tool messages.
- [Current Agent](../../src/core/agent.ts), [ThreadManager](../../src/core/thread.ts), [Application Service](../../src/core/application.ts).
- [Pinned Codex `codex-rs/core/src/tasks/mod.rs`](https://github.com/openai/codex/blob/5adb68a49933ae446bf11935662c83dba55a0804/codex-rs/core/src/tasks/mod.rs).
- [Pinned Codex `codex-rs/codex-mcp/src/connection_manager.rs`](https://github.com/openai/codex/blob/5adb68a49933ae446bf11935662c83dba55a0804/codex-rs/codex-mcp/src/connection_manager.rs).
- [Pinned Pi `packages/agent/src/agent.ts`](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/agent/src/agent.ts).
- [Pinned Pi `packages/coding-agent/src/core/tools/bash.ts`](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/src/core/tools/bash.ts).
