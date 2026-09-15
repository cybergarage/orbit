# Managed Execution

All supported Agent invocation paths share a run supervisor, operation
permission checks and a required execution journal. `completed` means the Agent
turn finished and its required records were acknowledged. It does not mean
that a target project's tests passed or that an application accepted the patch.

## Public library API

```ts
import {Agent, Message, MessageType, ToolProfile} from '@cybergarage/orbit'

const agent = new Agent({cwd: workspacePath, toolProfile: ToolProfile.Coding,
  execution: {
    responderScope: 'application-owner',
    async onApproval(request) {
      // Authenticate the actual user and display request.preview in your UI.
      const approve = await askOwner(request.preview)
      await agent.replyApproval(request.runId, {
        requestId: request.id, digest: request.digest,
        responderScope: 'application-owner', approve,
      })
    },
  },
})
try {
  const handle = await agent.startRun([
    new Message(MessageType.User, {content: 'Inspect the failing test.'}),
  ], {requestId: crypto.randomUUID()})
  const snapshot = handle.getSnapshot()
  // handle.requestStop() requests cancellation; it does not prove termination.
  const result = await handle.finished
  if (result.outcome === 'completed') consumeMessage(handle.value())
  else showRunResult(result)
} finally {
  await agent.close() // May reject with an incomplete/failed close report.
}
```

`Agent.invoke()` and `run(session, messages)` remain message-returning
conveniences. They return only for completed runs; other outcomes throw
`RunExecutionError` or the cancellation error with the run result attached.
`startRun()` rejects invalid, conflicting or busy admission; a successfully
admitted handle's `finished` resolves to the immutable `RunResult`.
`Agent.getRun(id)` and `RunSupervisor.getRun(id)` return snapshots. Application
Service exposes asynchronous `queryRun(id)`, including retained file evidence.

Use one unique request ID per logical submission at retryable boundaries.
An identical retry returns the earlier run before resolving new ambient
configuration or starting MCP resources. Different submitted input with that ID
conflicts. A recovered duplicate supplies evidence, not a reconstructed live
message value and never an automatic retry of an operation.

## Results, budgets and ownership

Phases are initializing, running, awaiting-approval, stopping, finalizing and
terminal. Snapshots carry a run/session ID and monotonically increasing per-run
sequence. `subscribeRunSnapshots` and SSE `run-snapshot` are independent of
optional diagnostic capture; obtain a fresh snapshot after transport gaps or reconnect. The first
terminal result is immutable. Late settlement appears as separate evidence.

Outcomes are completed, cancelled, budget-exceeded, failed and incomplete.
Inspect `operations`, `quiescence`, `recording`, `unresolved` and `cleanupErrors`
together. A known nonzero Bash exit can be an ordinary failed tool result
followed by a completed Agent turn. An unknown external outcome quarantines
resources and prevents conflicting admission until the owner verifies it.

The initial product profile is deliberately finite:

| Limit | Initial value |
| --- | --- |
| Elapsed run time | 600,000 ms |
| Model calls / tool requests / tool rounds | 6 / 32 / 5 |
| Approval wait | 300,000 ms |
| Cleanup | 5,000 ms |
| MCP startup per source / enabled sources | 30,000 ms / 16 |

Owners can pass positive finite time limits and nonnegative integer call/source limits through `execution.limits`
or per-run limits. These values are starting limits, not measured optima.
The supervisor checks elapsed time at admission boundaries and tracks started
promises even when a caller stops waiting. In-process timers cannot preempt
synchronous JavaScript, blocking syscalls, or arbitrary native code. OpenAI and
Anthropic default clients disable SDK retries; injected clients must preserve
that contract. There is no automatic model/tool retry in the managed loop.

Close uses one absolute cleanup deadline and attempts independent cleanup.
Concurrent close calls share the same promise/report; recorder cleanup failures can be retried without reopening writes. Pending writers, models,
clients and unknown effects retain ownership after a bounded incomplete result.
Owned journals and log stores close only when safe; borrowed log stores stay
caller-owned. A borrowed Session delegates its writer lease and should close
after Agent. Do not treat an incomplete close rejection as permission to delete
its files or start conflicting work. `RunSupervisor.reconcileRun()` requires
externally verified outcomes; acknowledging a warning is insufficient evidence.

## Operation permission and compatibility

Default `workspace-confirm` allows managed built-in reads inside configured
roots, asks before writes/commands/MCP and denies outside-root targets. Library
calls without an approval responder deny operations requiring confirmation.
`--execution-policy unrestricted`, or an explicit library policy with that
profile, skips prompts but preserves limits, ownership and required records.
This compatibility change intentionally replaces implicit full access.

Preparation binds parsed input, canonical targets, preimages, cwd/environment,
source/catalog identity and policy generation. A reply belongs to one pending
request, run, digest and authenticated responder scope. Identical replies
coalesce; opposite, expired, revoked or mismatched replies fail. Preview data is
redacted for common secret fields. Intent is acknowledged before the final
revalidation and synchronous registration/dispatch sequence. Approval does not
freeze the operating system: external filesystem races require OS isolation.
Approved shell/MCP/custom operations retain host privileges and network access.

Custom tools supply `ToolDefinition.prepare`; arbitrary legacy handlers require
both `allowLegacyTools: true` and an unrestricted policy. Direct low-level tool,
model or MCP APIs are primitives and do not constitute a managed Agent run.
Managed custom and MCP calls are serial. See [Coding Tools](tools.md) for the
locally validated MCP schema subset. MCP startup itself is authorized before
connecting, and all enabled sources must finish discovery before ready.

CLI `exec` retains its ephemeral session behavior. Interactive/resume and GUI
sessions use required file recording. Non-TTY execution cannot answer a prompt;
select unrestricted only when the application owner intends that access.
Application Service `startRun` is now asynchronous and returns `kind: run` or
`kind: command`; slash commands have no fabricated run ID. The REST message
endpoint requires `requestId`. Thread handles expose `admitted` separately from
completion. Consumers must handle incomplete results and close failures.

## Recording and recovery

Default persistent storage is `~/.orbit/runs/<session>/<run>/events.jsonl`, with
a separate private per-session HMAC key. An explicit SessionRepository root uses
`<rootDir>/.runs`, or its explicit `journalRoot`. Transcripts and optional logs
retain their formats and distinct purposes. Required metadata does not include
raw prompts, commands, patches or secret environment values; HMAC bindings allow
equality checks without exposing guessable plain hashes. Transcripts and full
optional logs can still contain sensitive content under their own policies.

Each JSONL record carries a Run-local version (1 for ordinary Runs, 2 for Graph Runs), identity, sequence, timestamp, elapsed time,
event ID, kind and bounded metadata. `run-admitted` is the first/version header.
Required barriers cover admission, ready, authorization, intent, result and
terminal summary. A terminal summary includes the synchronized transcript
high-water mark. Event IDs provide idempotence for recording, not for external
effects. Journals are retained until explicit session deletion.

Memory acknowledgement means process-local retention. File mode defaults to
`file-and-directory-sync`, including ancestor entries and key synchronization.
Unsupported capability rejects admission without fallback. Owners may explicitly
select `file-sync` through `execution.journalLevel` or `--journal-level`; deletion
uses the same selected level (the CLI delete command accepts that flag too).
Neither level promises universal hardware/controller power-loss survival.

`inspectExecutionJournal(root, sessionId)` reads valid prefixes without changing
torn files. Missing keys or malformed/partial records block writable recovery.
Preserve original bytes for manual repair; never regenerate a missing key over
existing records or replay a recorded command. A missing terminal record is
interrupted/incomplete. An intent without a result remains unknown even if it
might never have dispatched. Reopening rechecks and synchronizes readable file
evidence, but cannot prove the original caller received its acknowledgement.

After verifying the target and owner termination, `recordReconciliation(journal,
runId, {confirmedStopped: true, operations})` adds evidence for unresolved intents.
It does not rewrite the terminal result. Live reconciliation additionally checks
that pending owned work has settled. Torn-file repair and secret-key recovery
are operator tasks, not automatic retry paths.

SessionDeletionService rejects active/quarantined sessions, acquires the session
writer authority, acknowledges a minimal deletion marker, removes logs,
transcript and journal/key, then acknowledges completion. If any step fails,
retry with the same session ID; a retry can return only `{id}`. The retained
marker contains version, session ID and state and prevents identity reuse.
It is not complete erasure of every identifier. Automated retention is deferred.

## Validation scope

Tests under `test/core/execution/` exercise budgets, noncooperative work,
approval races, optional observers, failed/short writes, key and directory sync,
lost acknowledgements, partial deletion, actual stdio MCP transport, and
subprocess exit at admission/intent/effect/result/terminal checkpoints. GUI HTTP
tests cover capability enforcement, two responders, duplicate submissions and
queryable outcomes. These deterministic fixtures require no provider credentials.
They are distinct from the target project's tests invoked by the Agent.

Platform and utilization evidence is recorded with implementation hashes in the
three accepted [execution ADRs](adr/README.md). Passing injected I/O tests does
not establish physical power-loss survival or untested Windows behavior. Initial
limits remain adjustable product starting points; workload and platform coverage
must be reported with any measurements.

## Guarded writer recovery

SessionRecorder serializes all owner transitions with a stable Session-ID guard.
The built-in journal validates its borrowed recorder lease before persistent I/O.
Normal acquisition, rejection, close and deletion use the same protocol; an
abandoned guard denies admission until externally exclusive offline maintenance.
See [registration, migration and recovery](session-storage.md) before upgrading
existing CLI, GUI or library deployments. The [recovery ADR](adr/2026-09-08-session-writer-recovery-guard.md)
retains the earlier two-writer reproduction and subsequent verification evidence.
Windows and representative product trials remain separate verification work.

## Managed Graph Runs

[Processor Graphs](processor-graphs.md) reuse this supervisor, authorization, ownership and storage service. Their v2 required records extend the journal with a bound definition and acknowledged visit/route evidence. Ordinary v1 Runs coexist in the same Session; all records within a Run keep one version. The Graph guide specifies transcript v2 migration, read-only inspection and the distinct final-value API.
