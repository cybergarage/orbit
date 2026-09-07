---
status: accepted
proposed-date: 2026-09-07
decision-date: 2026-09-07
implementation-status: partial
implementation-completed-date: null
implementation-commits:
  - 61723f07e2f6318a352dcaacd16e9b88b7ad94fa
  - 7f26357d3afd9f14e7316352f7cc5483a387a2c3
  - 8ffef065251a0b04c0810f67a5318502c6be4df6
superseded-by: []
---

# Managed Run Lifecycle

## Purpose

Make a run mean the same thing when started from the CLI, GUI, or library.
A caller must be able to request a stop, discover whether owned work actually
settled, and distinguish a successful answer from a failure to save its result.
Today a rejected batch or an accepted cancellation can leave work outstanding.

## Decision

**Accepted on 2026-09-07; implementation partial, with confirmation remaining.** Introduce a
provider-neutral run supervisor in core.
It owns admission, the active run ID, a shared budget, started work, one terminal
result, and resource cleanup. Agent retains the model/tool loop; ThreadManager
and Application Service delegate execution ownership to the supervisor. All
supported Agent invocation paths use it, including direct library calls.
A future Processor can receive the same context without choosing a Graph design
in this ADR.

### Admission and public behavior

Names below specify accepted target contracts, not existing exports or fixed filenames.

- `startRun` validates the request envelope and checks for an existing request ID
  first. For a new run it validates input, finite limits, and policy/recording
  configuration before admitting work. It returns a handle with run ID, session ID, snapshot
  access, `requestStop`, and a `finished` promise returning `RunResult`.
- One Agent and one session admit at most one active run per supervisor. Busy
  submissions return a typed rejection; this decision adds no task queue.
  Admission freezes cwd, model selection, declared tool/MCP sources, policy,
  and budget. The remote tool catalog is not yet known. The caller supplies the
  resolved settings for a resumed session; redesigning setting precedence is
  separate work, and mixing configuration generations during a run is prohibited.
- For persistent mode, admission is acknowledged only after the journal stores
  the request ID, input digest, configuration identity, and run ID. A per-session
  request ID is mandatory at retryable transport boundaries. Identical retries
  return the existing handle/snapshot; the same ID with different input returns
  a conflict. Recovery never restarts the old operation automatically. Resolve an existing
  request ID before configuration loading, MCP startup, or other execution work.
  Compare normalized submitted input/options, not newly resolved ambient
  settings, to its stored keyed request digest; the original resolved generation
  is separate evidence and is not recomputed to admit a duplicate.
- Core exposes `getRun` and a versioned snapshot. Snapshots include run ID,
  session ID, phase, pending approval IDs, budget use, stop request, and terminal
  result when present. REST responses project these values; SSE events include
  run ID and monotonically increasing per-run sequence. Sequence gaps trigger a
  snapshot fetch, not speculative completion. Terminal snapshots remain
  queryable for the retained journal's lifetime; ephemeral mode is process-only.
- Local slash commands return a distinct command result and do not fabricate a
  run ID. UI appearance and slash-command vocabulary remain surface-specific.

### Initialization before model execution

Admission returns a handle in `initializing` after `run-admitted` is acknowledged.
That record identifies configured sources, not a fabricated remote catalog.
Under that run ID, core prepares and authorizes MCP startup operations using the
frozen startup configuration. It then connects, discovers and validates tools,
freezes the resolved catalog, and acknowledges `run-ready` with its identity.
Only then may the first model invocation start. Built-in/custom-only runs also
record `run-ready`; they need no remote discovery.

Initialization consumes the same elapsed budget and supports stop, query, and
approval replies. A pending approval reports its parent phase as `initializing`
or `running`. In the initial profile, all enabled configured MCP sources are
required: denied/unavailable startup or an invalid catalog ends initialization
without a model call and closes partial clients. Applications can disable a
source before a new run; core does not silently continue with a smaller catalog.
The resolved catalog stays fixed after ready. A policy revocation closes further
admission for the live run and invalidates permits; it does not mutate that run's
frozen configuration into a new generation.

### State and terminal semantics

| State or field       | Target meaning                                                                                                                                                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `initializing`       | The run is admitted; configured sources may be authorized/initialized, but no model invocation is permitted before `run-ready`.                                                                                                              |
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

A failed target-project test is not automatically a runtime failure or an unknown
operation: if its executor reports settled work and known completion, the model
may receive the failed test result and continue within policy and budget. Unknown
means completion/effects cannot be established, such as a remote request with a
lost response; it does not require knowing every byte a normally finished program
changed. Unknown operation completion closes new admission and produces
`incomplete`, rather than inviting the model to retry that operation.

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

The time bound assumes the JavaScript event loop can run. A synchronous custom
handler, parser, policy function, or observer that blocks the event loop also
blocks timers and stop replies. Such code is outside the bounded in-process
contract; hard preemption requires an independently supervised worker/process
and is not provided by this decision. Optional observers are exception-isolated
and never awaited as required recording; their callbacks must remain nonblocking.

Quarantine is released only after started work and cleanup settle, required
recording is reconciled, and the resource owner has evidence that conflicting
work is no longer active. A timeout, promise rejection, or user acknowledgement
alone is insufficient. Scope-unknown commands/custom operations reserve the
whole managed workspace; MCP calls additionally reserve their server identity.
An unresolved remote effect requires application-owner reconciliation evidence
or use of resources verified to be disjoint, not an approval retry. Recovery may
clear the restriction without changing the historical incomplete result.

### Shared budget and retries

The clock for a new admission attempt starts before its first asynchronous
configuration/storage/initialization step, so waiting for admission persistence
cannot escape the time limit. A duplicate lookup has the caller's bounded request
wait and never resets the already-admitted run's budget.

Core requires finite positive time limits and nonnegative integer counters;
products provide the accepted initial profile below. Applications may supply
other finite limits, and tests inject the clock. These initial values are
accepted starting values, not measured optimal defaults. They are one named product
profile, not hard-coded core limits. Six model calls and five rounds preserve the
current default loop allowance; the other values are starting points for the
coding example and have no measured optimality claim. The author can request
profile changes independently of the supervisor contract. The author accepted
this initial profile on 2026-09-07, including the MCP
startup limits below. During implementation, validate its values
against long-running target tests, slow MCP startup, human approval latency,
and record-sync overhead.

| Limit                  | Initial product profile | Accounting                                                                                                                                                                               |
| ---------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Total elapsed deadline | 10 minutes              | Monotonic time from admission, including startup, model calls, approvals, retries, and finalization.                                                                                     |
| Model invocations      | 6                       | Reserve immediately before each adapter invocation; refusals and failed invocations count.                                                                                               |
| Tool requests          | 32                      | Count each requested call, including invalid, denied, and cancelled-before-start calls, to bound repeated requests. An oversized batch admits no calls and reports the exhausted budget. |
| Tool rounds            | 5                       | Retain the current nonnegative integer loop meaning in the compatibility adapter.                                                                                                        |
| Approval wait          | 5 minutes maximum       | Minimum of this limit and the remaining run deadline. No pause of the total clock.                                                                                                       |
| Cleanup grace          | 5 seconds               | Separate bounded allowance after admission closes; not extra time for new work.                                                                                                          |

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
All shutdown work shares one absolute cleanup deadline set when admission first
closes; individual close stages do not each receive another grace period. Waits
on client close, transcript sync, journal acknowledgements, and store close are
registered work, too. A timed-out wait remains owned, even if its promise later
settles. Do not close its dependent store or release its writer lease meanwhile.
Independent cleanup is still attempted within the same remaining allowance.

Repeated close calls share one report. If the deadline expires, that report is
incomplete and lists still-owned resources; later cleanup updates a separate
queryable resource snapshot without rewriting the report. Late writes can only
finish already-enqueued records or record settlement, never start a tool. Retain
the owner registry and leases until those writes settle or the owning process
ends, after which durable recovery applies. Deleting an active or quarantined
session is rejected until reconciliation.

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

### Acceptance and relationship to earlier decisions

The author explicitly accepted the reviewed recommendation on 2026-09-07,
including bounded incomplete results, retained ownership, compatibility changes,
and the initial product profile. This records a target design, not delivered API
or runtime guarantees. The 2026-09-07 review corrections are part of the decision.

[GUI Application Architecture](2026-08-22-gui-application.md) remains accepted:
the local service and REST/SSE boundary is retained while run ownership, stop,
and close acquire this shared core contract. The provider-neutral message/tool
boundary in [Model Response and Tool Integration](2026-08-23-model-response-tool-integration.md)
is retained. Authorization and required recording are companion accepted
contracts; none alone establishes the complete confirmed-editing workflow.

## Consequences

- Positive: stop, completion, and reconnect describe the same run across all
  supported entry points; failed batch waits cannot hide registered work.
- Negative: a public result contract, ownership tracking, finite defaults, and
  quarantine make lifecycle handling more complex and may reject formerly
  accepted concurrent or indefinitely waiting calls.
- Neutral: output quality and target-project test success remain application
  judgments. The decision supplies no distributed scheduler or OS sandbox.

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
custom tool is stoppable. Neither inspection establishes Orbit's accepted target shared
budget or a universal no-effects-after-timeout guarantee.

## Considered Options

| Option                                                           | Advantages                                               | Costs and disposition                                                                   |
| ---------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Keep independent Agent/UI lifecycles                             | Smallest change and current API compatibility.           | Cannot make cancellation, recording, and reconnect agree. Not recommended.              |
| Require every operation to settle without a deadline             | Simple meaning of fully stopped.                         | Noncooperative work can hang close forever. Not recommended.                            |
| Core supervisor with bounded settlement and explicit uncertainty | Reusable, finite caller waiting, honest partial results. | Requires quarantine and richer results. Selected.                                       |
| Run everything in disposable workers/containers                  | Can strengthen local termination and isolation.          | Large deployment change; still no rollback of remote effects. Separate future decision. |

## Implementation and Confirmation

### Implementation evidence — 2026-09-07

Implementation status is **partial**, not completed. The code and maintained
guides are committed; the remaining confirmation below prevents a completion
date. Acceptance and its rationale are unchanged.

- `61723f07e2f6318a352dcaacd16e9b88b7ad94fa`: shared execution, permission,
  journal/recovery/deletion, CLI/GUI/library integration, public exports,
  maintained architecture/concepts/feature guides and contract tests.
- `7f26357d3afd9f14e7316352f7cc5483a387a2c3`: explicit legacy migration and
  locally validated MCP argument admission tests.

`RunSupervisor` now owns admission, immutable results, finite counters/time,
started promises, one cleanup deadline and quarantined resources. Agent's
message-returning methods delegate to it. ThreadManager, Application Service,
CLI and GUI expose the same facts; slash commands are separate. Versioned
run snapshots and the `run-snapshot` SSE channel remain available when diagnostic
capture is off. Reconciliation preserves the original result and updates current
resource ownership. OpenAI/Anthropic default SDK clients make one request on 429.

Validation on macOS arm64, Node v26.5.0: `npm run headers:check`,
`npm run build` and `npm test` passed; the final suite has **351 passing tests**.
Lint reported 10 complexity/parameter/style warnings and no errors. Reviewed
formatter output and `git diff --check` passed. `npm run prepack` regenerated
command documentation; its tool-update notice is not a build failure.

Evidence lives in `test/core/execution/{run,contracts,agent,storage,restart,retries}.test.ts`
and `test/apps/gui/execution.test.ts`, together with the updated existing tests.
Subprocess fixtures exit at admission, intent, external-effect, result and
terminal checkpoints and prove zero redispatch after restart. The real stdio
fixture verifies child termination. Browser testing verified a bound write
preview, reload/reopen while awaiting approval, one approval, and a completed /
acknowledged result. The TTY confirmation fixture returned true on `y` and false
on Ctrl+C. No provider credentials or external production MCP service were used.

A five-run utilization sample repeated against the committed implementation
at 12:02 UTC on 2026-09-07 used a deterministic model
and actual read/write/Bash operations under the unchanged default limits. Each
run used 4 model calls, 3 tool requests and 3 rounds and completed. Wall times
were 455.6–1119.4 ms (median 1112.5 ms). The 70 strong-sync journal acknowledgements
were 5.6–107.7 ms (median 62.8 ms) on the host temporary filesystem (statfs type 26).
These small warm-host samples are not optimality estimates, percentiles for a
production population, or measurements of live model latency.

### Follow-up verification — 2026-09-07

Commit `8ffef065251a0b04c0810f67a5318502c6be4df6` adds targeted MCP and process tests,
real Ink/GUI fixtures, local schema/UI corrections, and the separate failing
stale-lock probe. Acceptance, decision date and initial product limits are
unchanged. Implementation remains **partial**, with no completion date.

`headers:check`, `build` and `npm test` passed on macOS arm64 / Node v26.5.0
and an isolated Linux arm64 / Node v24.16.0 container. Both suites reported
**372 passing tests**; lint had zero errors and 10 existing warnings. The Linux
copy used `npm ci --ignore-scripts` from the unchanged lockfile. The separate
`node test/core/execution/fixtures/stale-lock-race.mjs` probe **failed exclusion
on both platforms** (exit 1, both children reported `owned`). The passing suite
does not include or cancel this negative evidence.

| Confirmation | Source and execution evidence | Limit |
| --- | --- | --- |
| Stop, budgets, parallel outcomes and bounded close | `run.test.ts`, `contracts.test.ts`, `restart.test.ts` under `test/core/execution/` passed again, including pending writers, late mutations, finalization and synchronous code. | These are the enumerated fixtures, not arbitrary executor preemption. |
| Cold MCP admission, readiness and timeout | `agent.test.ts` checks startup ordering; `mcp-contract.test.ts` exercises an actual delayed stdio call, possible effect, one model request, child exit and explicit reconciliation. | A 1-second cleanup trial returned before child exit; the accepted 5-second cleanup profile confirmed exit. Neither proves all services stop in 5 seconds. |
| Duplicate requests and stale/reconnected UI | Existing two-client API tests plus `run-presentation.test.ts` and `test/apps/gui/fixtures/transport-faults.mjs`. | Browser verification used an isolated local server and injected models. |
| Complete Ink interaction | `test/apps/cli/fixtures/managed-interactive.mjs`: approve produced one file and completed/acknowledged; deny produced no file; Ctrl+C during approval produced cancelled/acknowledged and quiescence. | Explicit file-sync, actual PTY, fake model; no human usability sample. |
| Target-test versus run failure | Existing nonzero target-test fixture passed. The delayed utilization trial below completed without changing defaults. | Representative production workloads remain unmeasured. |
| Resource ownership after restart | Live-owner contention and sequential stale recovery passed; simultaneous stale recovery admitted two writers. | This is a blocking defect in inherited SessionRecorder locking; see the journal ADR's new finding. |

A separate three-run utilization trial at 14:31 UTC used actual read/write,
a stdio MCP response delayed by 2 seconds, a Bash target check delayed by
15 seconds, and an injected 3-second wait before each approval. Each run used
5 model calls, 4 tool requests and 4 rounds. All completed in 29.284–29.400 s
(median 29.330 s). The 66 strong-sync acknowledgements on the host temporary
filesystem (statfs type 26) took 2.7–41.7 ms (median 8.3 ms). These are controlled
small samples, not live-model latency or representative human decision timing;
they do not establish optimality of the 10-minute/5-minute defaults.

### Confirmation remaining before completed

- Resolve the inherited concurrent stale-lock ownership defect through a separately
  reviewed recovery decision; repeat the failing probe and integration checks.
- Windows child/process-tree cleanup, Bash/executable resolution, filesystem
  acknowledgement capability and the remaining supported Node versions need
  suitable environments. This host has no configured Windows runner/VM; no
  Windows job was dispatched or inferred from Linux success.
- Representative long target suites, production MCP services and actual human
  approval/usability trials remain. Controlled waits and a terminal operator
  exercise are not product-distribution measurements.

The implementation reference is [Managed Execution](../execution.md), with
[current architecture](../architecture.md), [Agent Runtime](../concepts/agent-runtime.md)
and [coding tool migration](../tools.md). The following original checklist is
retained as acceptance history; it must be reconciled case by case, not marked
satisfied merely because the aggregate suite passes.

### Original acceptance checklist

At acceptance, implementation had not started. The baseline passed headers, build, and 293
existing tests as recorded in the research; those tests do not validate this ADR.
Implement core ownership/results first, then wire Agent, threads,
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

Additional confirmation required by cross-contract review:

- From a cold MCP start, prove `run-admitted` precedes startup authorization and
  that `run-ready` follows discovery but precedes the first model invocation.
- While an intent acknowledgement waits, expire approval or revoke policy; no
  handler starts. Include an already accepted duplicate request after ambient
  settings change, with zero new initialization work.
- Use a yielding never-settling writer/client double: the single cleanup deadline
  returns an incomplete report, retains leases, and allows independent cleanup.
  A blocking synchronous handler needs a separately controlled process test;
  in-process timers cannot establish a preemption guarantee.
- Distinguish a normally completed nonzero test exit from unknown remote
  completion; only the latter blocks continuation pending reconciliation.

## Follow-up Work

The author accepted bounded incomplete results, resource quarantine, the initial
product limits, and public result/close compatibility changes on 2026-09-07.
Implementation must prove
platform-specific child cleanup with fixtures; Windows and real MCP shutdown
remain unverified. Input/compaction, Skill identity, Graph structure, evaluation,
and candidate selection are later proposals using this lifecycle.

## References

- [Research and source ledger](../research/2026-09-07-run-execution-approval-and-recording.md).
- [Prepared Operation Authorization](2026-09-07-prepared-operation-authorization.md).
- [Required Execution Journal](2026-09-07-required-execution-journal.md).
- [Accepted GUI architecture](2026-08-22-gui-application.md): retained; this decision extends its shared runtime contract without replacing its local service and REST/SSE architecture.
- [Accepted model/tool integration](2026-08-23-model-response-tool-integration.md): retain provider-neutral tool messages.
- [Current Agent](../../src/core/agent.ts), [ThreadManager](../../src/core/thread.ts), [Application Service](../../src/core/application.ts).
- [Pinned Codex `codex-rs/core/src/tasks/mod.rs`](https://github.com/openai/codex/blob/5adb68a49933ae446bf11935662c83dba55a0804/codex-rs/core/src/tasks/mod.rs).
- [Pinned Codex `codex-rs/codex-mcp/src/connection_manager.rs`](https://github.com/openai/codex/blob/5adb68a49933ae446bf11935662c83dba55a0804/codex-rs/codex-mcp/src/connection_manager.rs).
- [Pinned Pi `packages/agent/src/agent.ts`](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/agent/src/agent.ts).
- [Pinned Pi `packages/coding-agent/src/core/tools/bash.ts`](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/src/core/tools/bash.ts).
