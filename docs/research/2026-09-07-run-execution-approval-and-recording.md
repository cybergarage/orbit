---
status: current
investigation-date: 2026-09-07
orbit-commit: 8ee97144c20b006225db52efc482004200527e4c
related-adrs:
  - docs/adr/2026-09-07-managed-run-lifecycle.md
  - docs/adr/2026-09-07-prepared-operation-authorization.md
  - docs/adr/2026-09-07-required-execution-journal.md
superseded-by: []
---

# Run Execution, Approval, and Required Recording

## Purpose

Orbit needs one execution contract that a coding application can use from a
terminal, the existing GUI, or a library call. The central finding is that an
abort request, an approval response, and a queued record each describe an
intermediate action: none alone establishes that work stopped, the approved
operation executed, or its result was saved. Separate runtime supervision,
operation authorization, and required recording are complementary proposals.
They are not implemented or approved by this investigation.

## Research Questions

The investigation uses Orbit commit
`8ee97144c20b006225db52efc482004200527e4c`. It asks:

1. Where can execution continue after cancellation, and who owns that work?
2. Which normalized operation must a permission decision authorize, including
   MCP process startup, and what invalidates a waiting approval?
3. Which records must be acknowledged before execution or successful completion,
   and how should partial effects and persistence failures be reported?
4. Which contracts must be shared across Agent, ThreadManager, Application
   Service, CLI, GUI, and future Processor callers?
5. Which changes require independent decisions rather than local fixes?

## Orbit Baseline

The local tree was clean at investigation start. `git ls-remote --symref origin
HEAD refs/heads/main` returned `main` and the baseline above on 2026-09-07.
This is a source citation, not a chapter-specific implementation gate.

### Reused evidence and additional investigation

The companion book's completed A03, A04, A07, A08, A09, A10, A13, and A11
analyses provide the issue inventory and prior deterministic reproductions.
Their reproduction results are reused, not claimed as newly executed here.
The following source paths were inspected again at the baseline, and the current
repository validation was executed separately below.

Existing ADRs supply accepted intent, not proof that every edge case matches it.
The tool ADR explicitly chose initial full access; introducing permission checks
is a new decision, not correcting that accepted boundary. The logging ADRs
separate transcripts and optional operational data. The GUI ADR already chooses
an application service, REST, SSE, and a local single-user boundary.

The 2026-09-04 OpenClaw research supplies previously identified Codex and Pi
revisions and the broader observation that Orbit lacks a control plane. Its
Codex/Pi comparison concerned Skills. This investigation downloads those exact
source archives and newly reads execution, approval, shutdown, and persistence
code. It does not extrapolate Skill findings into execution guarantees or repeat
the broader OpenClaw survey. Earlier tool and logging ADR comparisons remain
historical evidence at their own revisions.

### Current facts

| Evidence          | Source-inspected behavior                                                                                                                                                                    | Consequence for this investigation                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| O1: Agent loop    | `Agent.run` checks signals around awaited work; `ToolRuntime.executeAll` uses `Promise.all` for parallel batches. A rejected wrapper can end the batch while another handler remains active. | Settled orchestration is not proof of settled effects. Keep an independent registry of started work.                    |
| O2: termination   | Agent records a completed turn before `session.flush`; the catch path can record another terminal phase. `ThreadManager.cancelRun` aborts a controller and returns a boolean.                | Stop acceptance, execution outcome, and recording outcome must be represented separately.                               |
| O3: ownership     | `Agent.close` closes MCP and its owned log store; it does not supervise an active invocation. Thread close removes the thread before awaiting its active run, then closes Agent and Session. | Closing and admission must share an owner and preserve unresolved resource ownership.                                   |
| O4: authorization | ToolRuntime resolves and parses inside the optional execution closure. There is no core approval service. Built-in paths resolve against cwd without containment enforcement.                | A UI callback over raw call arguments is insufficient for binding approval to executable input.                         |
| O5: MCP           | `getTools` initializes stdio clients; cached failures and close/init races are possible. `wrapMcpTool.invoke` forwards arguments but no signal.                                              | Startup is itself an operation requiring policy, a deadline, and ownership before tool discovery.                       |
| O6: records       | SessionRecorder queues append promises. FileSessionLogStore can drop records at capacity; its flush propagates recorded failures, while close clears writers after awaiting caught failures. | Optional logs cannot serve as the required operation record. Queued, written, and synchronized need different meanings. |
| O7: surfaces      | CLI/interactive call Agent directly; Application Service returns IDs and catches completion rejection. Thread snapshots have idle/running but no active run ID.                              | A reconnecting client needs a queryable run snapshot, not an inference from diagnostic replay.                          |

The sources are `src/core/agent.ts`, `src/core/thread.ts`,
`src/core/tools/registry.ts`, `src/core/mcp.ts`,
`src/core/session/recorder.ts`, `src/core/logs/file-store.ts`,
`src/core/application.ts`, and `src/core/interactive.tsx`.
Relevant tests include `test/core/thread.test.ts`,
`test/core/application.test.ts`, and `test/core/session.test.ts`; these confirm
existing behavior, not the proposed contracts.

## External Systems Investigated

Both comparisons were source-inspected on 2026-09-07. The revisions are selected
for reproducibility and continuity with existing research, not asserted to be
the latest releases. Neither external system was built or executed in this task.

| System          | Pinned source                                               | Newly inspected files                                                                                                                                                                                |
| --------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex           | `rust-v0.152.1`, `5adb68a49933ae446bf11935662c83dba55a0804` | `codex-rs/core/src/tools/orchestrator.rs`, `tools/approvals.rs`, `tasks/mod.rs`; `codex-rs/rollout/src/recorder.rs`; `codex-rs/codex-mcp/src/connection_manager.rs`, `connection_manager/startup.rs` |
| Pi Coding Agent | `v0.84.4`, `b79e4cc834970cca69daebffab7df1da7d1e52c4`       | `packages/agent/src/agent-loop.ts`, `agent.ts`; `packages/coding-agent/src/core/session-manager.ts`, `tools/bash.ts`                                                                                 |

## Findings

### Preparation and approval

Codex's ToolOrchestrator evaluates an execution approval requirement before its
first sandbox attempt. ApprovalAction carries operation-specific content such
as command, cwd, permissions, patch changes, or original MCP server/tool and
arguments. ApprovalContext carries a call ID and cancellation token. This is
positive evidence for a shared typed preparation and policy step, rather than
interpreting a chat message as authorization. Its guardian routing, cached
approvals, network policy, and sandbox escalation are much broader than Orbit's
book application needs. Do not copy them as one undifferentiated feature.

Pi's `prepareToolCall` validates tool arguments, awaits `beforeToolCall`, checks
cancellation after that hook, and can return an immediate blocked result.
`executePreparedToolCall` receives the validated arguments. This is evidence for
a small reusable preparation boundary. The inspected code passes objects to
hooks; it does not establish immutable approval snapshots or an OS security
boundary. In parallel mode preparation occurs before the executable closures
are started together. That ordering motivates revalidation immediately before
dispatch, particularly after user interaction.

### Cancellation and ownership

Pi exposes `abort()` separately from `waitForIdle()`, whose promise includes
awaited `agent_end` listeners. Its shell operations register abort handling,
kill the process tree, await child termination, and remove listeners and timers
in `finally`. These are useful ownership practices, not evidence that an
arbitrary JavaScript extension can be forcibly stopped.

Codex's `handle_task_abort` cancels a token, waits for task completion or a grace
timeout, aborts the task handle, and calls task-specific cleanup. Its MCP manager
also has startup cancellation and configured startup timeouts. This supports
separating deadline, cancellation, and cleanup. Rust task abortion is not an
operation available for a running JavaScript promise, and aborting a local task
alone does not prove a remote service reversed its effects. Orbit must report
unconfirmed effects rather than importing that assumption.

### Recording and failure

Codex's rollout recorder exposes acknowledged flush and shutdown commands. Its
writer retains the unwritten suffix after I/O errors and can retry a barrier.
However, task completion and interruption code warn on some rollout flush
failures and continue lifecycle notification. This is contrary evidence against
claiming that Codex demonstrates mandatory successful storage before every
terminal notification. The inspected file flush calls also do not establish a
universal power-loss durability guarantee.

Pi's SessionManager keeps a session tree and uses synchronous file writes.
`_persist` can defer creating the file until an assistant message exists.
Synchronous append does not by itself mean fsync durability or a write-ahead
permission ledger. Orbit should retain the simplicity of a separate transcript,
but not use the existence of a chat entry as proof of operation admission.

## Analysis

### Proposed responsibility split (non-binding)

Core should own admission, stable run/operation IDs, deadline and counters,
operation preparation, enforcement of supplied policy, approval reply
validation, required record acknowledgements, cancellation propagation, and
resource settlement. Applications should select policy and budgets, identify the
local approval responder, display the prepared content and uncertainty, choose
target-project test commands, and interpret task success.

The runtime should return transport-independent snapshots and final results.
REST/SSE, terminal events, and library promises can then project the same facts.
SSE is an update channel, not the authoritative execution or approval ledger.
Arbitrary JavaScript handlers and arbitrary test commands remain trusted code
unless an external isolation mechanism is supplied. Policy checking is not an
OS sandbox. Autonomous workflow generation and unattended adoption remain
application responsibilities and are outside this investigation.

### Decision partition

| Candidate                        | Why cohesive                                                                                                                               | Relationship                                                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Managed run lifecycle            | Admission, budgets, child work, stop acknowledgement, terminal results, reconnect queries, and close ownership share one supervisor.       | Defines the execution owner used by policy and recording.                                                                                 |
| Prepared operation authorization | Normalized content, one-use approval, source identity, startup permission, and pre-dispatch revalidation must agree on what is authorized. | Uses the supervisor and requires acknowledged admission evidence.                                                                         |
| Required execution journal       | Record schema, acknowledgements, failures, privacy, recovery, and retention form a durable data contract.                                  | Can be evaluated independently of the particular approval policy; must be integrated before persistent authorized execution is delivered. |

The proposals can be reviewed separately, but the book's confirmed editing flow
requires their contracts together. This is a technical dependency, not a
per-chapter commit, tag, or implementation gate.

### Local corrections that need no new ADR

| Candidate and analysis          | Bounded correction                                                                                                | Why no new architectural decision is needed                                                         |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| MCP settings wiring, A01/A07    | Pass the existing MCP settings member to the existing factory and add a default-path regression.                  | Aligns the caller with its documented callee input; adds no policy or lifecycle contract.           |
| Literal edit replacement, A04   | Use literal replacement content even when it contains dollar replacement patterns.                                | Restores the accepted exact-string edit behavior.                                                   |
| Iteration limits, A03/A08       | Reject non-finite, negative, or fractional iteration counts before writing a turn.                                | Matches the existing nonnegative integer persisted contract; adding new shared budgets is separate. |
| Snapshot payloads, A04          | Copy serializable payloads to meet the existing immutable-snapshot intent, retaining executable handler identity. | Avoids unintended caller mutation; changing handler capabilities or codecs is separate.             |
| GUI stale responses/events, A10 | Discard outdated selection responses and events belonging to another run.                                         | Corrects presentation within existing IDs; adding run lookup and replay guarantees is separate.     |
| Test resource cleanup, A09      | Close owned Agent/Session resources or inject memory stores before deleting fixtures.                             | Prevents pending writes after fixture teardown; does not redefine production close semantics.       |

These are candidates only; none is implemented here. Full JSON-schema semantics,
MCP name migration, content-part support, session recovery formats, cursor/gap
semantics, and disclosure policy changes need separate scope review. Do not
hide them inside a settings or presentation fix.

## Implications for Orbit

Non-binding recommendation: propose the three decisions above. Require a
structured result that distinguishes work outcome, cancellation request,
quiescence, and recording status. Require a one-use approval of prepared input,
then acknowledge an operation intent before dispatch. A failure after dispatch
must preserve possible effects; it must not trigger automatic mutation retry.
Use explicit defaults and compatibility guidance rather than silently claiming
that current full-access callers already enforce policy.

## Risks and Limitations

- A descriptor hash binds data, not the eventual behavior of arbitrary code.
  Path checks and preimage checks reduce mistakes but do not eliminate external
  filesystem races or constrain shell/network behavior.
- A local record cannot atomically commit with a remote effect. Missing results
  after an acknowledged intent mean uncertainty, not permission to replay.
- Bounded close cannot promise both immediate return and physical termination of
  noncooperative in-process work. Resource quarantine must remain visible.
- More acknowledgements increase latency and can stop work when storage fails.
  Memory-only execution must declare its weaker restart guarantees explicitly.
- Approval persistence does not imply that an approval remains valid after
  process restart, settings changes, or changes to the target.

### Validation performed

At the baseline, `npm run headers:check` and `npm run build` succeeded.
The first `npm test` attempt failed only because the restricted environment
prevented the GUI test from listening on `127.0.0.1` (`EPERM`). Repeating the
complete `npm test` with local listening permitted passed **293 tests**. Its
format and lint presteps produced no tracked source changes. No log ENOENT was
observed in that successful run; this does not resolve the earlier fixture
lifetime issue reported in A09.

External behavior is source-inspected only. Live models, live MCP servers,
Windows process termination, browser interaction, hostile-code isolation,
physical disk failure, and power-loss recovery were not tested. Confirmation
cases in the future ADRs are requirements, not successful test results.

## Open Questions

The author should judge the proposed compatibility change for full-access
callers, bounded termination with visible unresolved effects, and the additional
storage cost of required records. Initial numerical budgets need usability
validation; they are not experimentally established optimal limits. An OS
sandbox, global cross-process workspace exclusion, remote exactly-once effects,
MCP naming migration, and resumable approvals are separate future decisions.

## Related Decisions

The following records are proposed and not started; none is accepted.

- [Managed Run Lifecycle](../adr/2026-09-07-managed-run-lifecycle.md).
- [Prepared Operation Authorization](../adr/2026-09-07-prepared-operation-authorization.md).
- [Required Execution Journal](../adr/2026-09-07-required-execution-journal.md).

- [Vibe Coding Tool Architecture](../adr/2026-08-23-vibe-coding-tools.md): accepted full-access starting point.
- [GUI Application Architecture](../adr/2026-08-22-gui-application.md): retain local application service, REST, and SSE.
- [Session Persistence](../adr/2026-08-22-session-persistence.md): preserve existing transcript reads.
- [Session-scoped Logging](../adr/2026-08-25-session-scoped-logging.md): preserve optional operational store ownership.
- [Session Records versus Runtime Logs](../adr/2026-08-25-session-versus-runtime-log-content.md): do not turn diagnostic logs into authorization evidence.

## References

- [Existing OpenClaw investigation](2026-09-04-openclaw-2-agent-architecture-and-orbit-gaps.md): reused scope and revision discovery only.
- [Codex tool orchestration](https://github.com/openai/codex/blob/5adb68a49933ae446bf11935662c83dba55a0804/codex-rs/core/src/tools/orchestrator.rs).
- [Codex approval actions](https://github.com/openai/codex/blob/5adb68a49933ae446bf11935662c83dba55a0804/codex-rs/core/src/tools/approvals.rs).
- [Codex task lifecycle](https://github.com/openai/codex/blob/5adb68a49933ae446bf11935662c83dba55a0804/codex-rs/core/src/tasks/mod.rs).
- [Codex rollout recorder](https://github.com/openai/codex/blob/5adb68a49933ae446bf11935662c83dba55a0804/codex-rs/rollout/src/recorder.rs).
- [Codex MCP connections](https://github.com/openai/codex/blob/5adb68a49933ae446bf11935662c83dba55a0804/codex-rs/codex-mcp/src/connection_manager.rs).
- [Pi agent loop](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/agent/src/agent-loop.ts).
- [Pi Agent](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/agent/src/agent.ts).
- [Pi session persistence](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/src/core/session-manager.ts).
- [Pi shell operations](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/src/core/tools/bash.ts).
- [Orbit `src/core/agent.ts`](https://github.com/cybergarage/orbit/blob/8ee97144c20b006225db52efc482004200527e4c/src/core/agent.ts).
- [Orbit `src/core/thread.ts`](https://github.com/cybergarage/orbit/blob/8ee97144c20b006225db52efc482004200527e4c/src/core/thread.ts).
- [Orbit `src/core/tools/registry.ts`](https://github.com/cybergarage/orbit/blob/8ee97144c20b006225db52efc482004200527e4c/src/core/tools/registry.ts).
- [Orbit `src/core/mcp.ts`](https://github.com/cybergarage/orbit/blob/8ee97144c20b006225db52efc482004200527e4c/src/core/mcp.ts).
- [Orbit `src/core/session/recorder.ts`](https://github.com/cybergarage/orbit/blob/8ee97144c20b006225db52efc482004200527e4c/src/core/session/recorder.ts).
- [Orbit `src/core/logs/file-store.ts`](https://github.com/cybergarage/orbit/blob/8ee97144c20b006225db52efc482004200527e4c/src/core/logs/file-store.ts).
- [Orbit `src/core/application.ts`](https://github.com/cybergarage/orbit/blob/8ee97144c20b006225db52efc482004200527e4c/src/core/application.ts).
- [Orbit `src/core/interactive.tsx`](https://github.com/cybergarage/orbit/blob/8ee97144c20b006225db52efc482004200527e4c/src/core/interactive.tsx).
- [Orbit `test/core/thread.test.ts`](https://github.com/cybergarage/orbit/blob/8ee97144c20b006225db52efc482004200527e4c/test/core/thread.test.ts).
- [Orbit `test/core/application.test.ts`](https://github.com/cybergarage/orbit/blob/8ee97144c20b006225db52efc482004200527e4c/test/core/application.test.ts).
- [Orbit `test/core/session.test.ts`](https://github.com/cybergarage/orbit/blob/8ee97144c20b006225db52efc482004200527e4c/test/core/session.test.ts).
