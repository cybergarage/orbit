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

# Prepared Operation Authorization

## Purpose

Allow the application to show an edit or command and execute only the operation
that the user actually confirmed. Apply the same rule to built-ins, custom tools,
MCP startup, and MCP tool calls, regardless of the CLI, GUI, or library entry point.

## Decision

**Accepted on 2026-09-07; implementation partial, with confirmation remaining.** Core prepares an operation, evaluates application
policy, validates any approval reply, and consumes a one-use execution permit.
Application code supplies rules and the confirmation UI; it does not implement
an alternative enforcement path. This extends the accepted initial full-access
tool architecture with a new managed authorization contract.

### Prepared operation and admission sequence

A trusted tool adapter parses and validates input and prepares an immutable
serializable descriptor before asking for permission. Preparation must have no
mutating or remote effects. It may perform policy-authorized metadata/preimage
reads; if a read itself needs approval, it is a separate operation. Raw model
arguments and arbitrary tool descriptions are never authority.

The descriptor is a discriminated union. Both variants carry schema version,
operation ID, run/session IDs, normalized input, canonical cwd, policy/configuration
generation, effect kind, and targets. A `tool-call` also binds the model call ID,
source identity, and resolved catalog generation. An `mcp-startup` binds a core
startup ID and configured server/transport identity, with no model call ID or
resolved catalog yet. It is available during initialization before `run-ready`.
For tool calls, MCP identity includes configured server ID and the original remote tool name,
not just the flattened model alias. A trusted executor closure is retained in
core and receives the prepared input exactly once; no public callback receives
a reusable `execute` continuation.

For built-in edits, targets include the resolved path, preimage digest or
expected absence, proposed resulting content/patch, and mutation resource key.
Commands include exact command text or executable/argv, shell selection, cwd,
resolved environment identity, timeout, and execution backend. A command's
approval authorizes that invocation; it cannot describe every file/network effect
of the program. MCP startup includes resolved executable/args, cwd, effective
environment identity, server identity, and transport generation.

Use a versioned canonical JSON encoding and the journal's per-session keyed
descriptor digest for comparison, not as an authorization credential. Reject
unsupported/non-finite values before approval. Keep the full immutable descriptor
private to the runtime; send the authorized UI a redacted display projection,
opaque operation ID, and keyed digest. Do not publish an unkeyed hash of
secret-bearing input. Memory mode generates an ephemeral key with the same
binding semantics but no restart guarantee.
Secret values must not be copied into diagnostic events. The display explicitly
identifies redacted inputs and the credential/environment binding without
revealing values. If those omissions prevent an informed decision, policy must
deny or require application-owner configuration rather than accepting a vague
confirmation. The keyed digest includes effective values while public records
omit those values. Approval replies echo the same opaque ID and keyed digest.

The accepted execution sequence is:

1. For a tool call, validate its unique call ID, resolve the catalog entry, parse
   input, and prepare the descriptor. For MCP startup, resolve the frozen server
   configuration and prepare the startup variant without a catalog lookup.
   Invalid operations produce `invalid` without handler invocation.
2. Evaluate the immutable application policy against that descriptor. Return
   `allow`, `deny`, or `ask`; policy errors fail closed. A tool or Skill cannot
   alter the policy, trusted descriptor adapter, or approval responder.
3. For `ask`, create a pending request and await an authenticated application
   reply bounded by the run/approval deadline. Persist the request and decision
   through the required journal; a display event is not a save acknowledgement.
4. Acquire the declared in-process mutation lease, revalidate the target and
   relevant generations, and check cancellation and budget again. If the
   preimage, path resolution, environment identity, catalog, or policy differs,
   invalidate the permit, release the lease, and prepare a new request. Do not
   keep a mutation lease locked while waiting for human input.
5. Acknowledge the operation-intent record while retaining the mutation lease.
   After that asynchronous wait, revalidate target identity/preimage and all
   permit conditions again. Immediately before invocation, core synchronously
   checks the descriptor binding, unconsumed permit, approval expiry, policy
   revocation, run deadline, counters, and stop state, then consumes/registers/
   starts without an intervening await. If any check fails, do not execute;
   record not-started evidence when possible. Changed content needs a new
   descriptor, approval when required, and intent; the old intent is not reused.
   If storing the non-dispatch outcome fails, return failed recording while
   retaining the live fact that no handler was invoked.

Only the trusted adapter may derive the actual dispatch arguments. Rechecking
path identity/preimages is required but does not eliminate filesystem TOCTOU
against another process. Stronger race resistance requires suitable filesystem
operations or an isolation backend and must not be advertised without testing.
In-process leases prevent cooperating Orbit operations from racing, not arbitrary
external edits. Custom code is trusted: it must obey the descriptor/executor
contract. Calling arbitrary exported JavaScript functions outside the managed
runtime is not a supported policy-enforced execution path.

Policy revocation and target invalidation can occur while acknowledgement or
revalidation is awaited, so every await returns to the final dispatch checks.
Holding an Orbit lease does not prevent an external filesystem writer from
changing the target after the last check; the existing TOCTOU limitation remains.
Metadata/preimage preparation is constrained by the policy's read rules before
reading content, even when the later write would need confirmation.

### Approval replies and waiting

A pending approval contains request ID, run ID, operation ID, descriptor digest,
configuration generation, expiry, and local responder scope. The UI shows the
operation's exact non-secret target, change/command, cwd, effect warning, and
one-operation scope. Model text, transcript messages, tool outputs, and Skills
cannot submit approval replies.

`replyApproval` accepts approve or deny once, validates the authenticated local
application channel and all identifiers, and returns a stable acknowledgement.
An approval response becomes usable only after its authorization record is
acknowledged. Identical transport retries return the prior committed reply
acknowledgement, or pending/recording-failed while it remains unconfirmed;
an opposite reply or mismatched digest is a conflict. Never acknowledge a usable
grant merely because the reply reached memory. A second GUI tab does not
create a second execution. Knowledge of a digest alone grants no permission.

The initial scope is one operation in one live run. Denial, expiry, cancellation,
configuration change, or process restart invalidates it. A browser disconnect
leaves a pending request available to authenticated reconnection until expiry;
shutdown cancels it. A terminal application without a responder fails an `ask`
operation as `approval-unavailable` and never silently allows it. A later process
may display an old request as history, but must re-investigate and create a new
run/request to execute. Session-wide grants and automatic adoption are deferred.

### Operation outcomes and scheduling

`invalid`, `denied`, and `cancelled-before-start` mean no handler was invoked.
Once invoked, use `succeeded`, `failed`, or `unknown`, plus known partial effects
and cancellation metadata. A cancellation signal alone never proves no effect.
Refusal and validation errors return structured model-visible results, with
user denial distinct from execution failure. Each repeated model request consumes
the shared call budget and passes policy again.

The initial profile permits parallel already-authorized reads and serializes
edits, commands, and MCP startup. A waiting mutation does not authorize later
mutations; preserve the serial barrier. Independent permitted reads may finish
while approval is pending. Do not provide batch approval or automatic retries
of mutations. The target project's test command is a command operation that can
modify data or use the network, not a privileged read-only special case.

### MCP and resource startup

Apply startup policy before constructing/connecting a transport that can spawn
or send data. A run-owned MCP client starts only after its startup intent is
acknowledged. Discovery uses the run deadline and closes partial connections on
failure. Returned schemas/annotations are untrusted input, not permission rules.
Validate MCP inputs against the pinned catalog schema before the call; reject
unsupported schema constructs explicitly instead of accepting arbitrary input.
The implementation must select and test a compatible validator; a major new
dependency would need its own justification before adding it.

The catalog is fixed after initialization acknowledges `run-ready`. Reject alias collisions and unsupported names
with original identity in the error; do not silently select one tool. A stable
renaming/migration scheme and richer MCP content handling are separate decisions.
Calling an MCP tool requires its own policy decision; permission to start the
server is not blanket permission for its tools. Forward cancellation/deadline
to SDK calls and register the client with the supervisor. A timeout or transport
close does not prove the remote operation was cancelled.

### Product profiles and compatibility

Adopt a named `workspace-confirm` product profile: permit supported read
operations inside configured roots, ask for writes, commands, and configured
MCP startup/calls, and deny undeclared targets or capabilities. Outside-root
operations require a policy change by the application owner, followed by a new
run; an approval reply cannot override a deny rule. Commands display that no OS
sandbox is supplied by this profile. Roots constrain built-in path admission,
not arbitrary shell behavior. Unknown custom tools require an explicit trusted
adapter and policy registration rather than relying on a friendly tool name.

Keep low-level library omission of a tool profile as no built-ins. Calls through
registered tools still use this authorization path. Headless consumers must
provide a policy that can decide without UI, or a responder. Provide an explicit
`unrestricted` policy for trusted legacy use, still using lifecycle and required
recording; never select it as an automatic fallback after a denial. Saved
transcripts do not import past permission. Migrating product defaults from full
access is an intentional compatibility change accepted by the author on
2026-09-07. Prepare release/migration documentation before implementation.
This decision partially supersedes the initial tool architecture as described
below; adoption does not change the current executable behavior.

### Compatibility conditions

`unrestricted` changes the policy result, not lifecycle, parsing, recording,
deadlines, or one-time dispatch. It is not complete behavioral compatibility:
turn limits, SDK retry defaults, resource ownership, and close/error reporting
still follow the managed lifecycle. Existing library calls with no tools remain
usable with explicit ephemeral recording and do not acquire built-ins.

Legacy custom Tool/AgentTool definitions without a preparation adapter are
rejected before model exposure under `workspace-confirm`. Applications may
explicitly register them through a legacy adapter under `unrestricted`: bind the
validated serializable input and source/handler identity, mark effects as opaque,
serialize the call, and reserve the whole managed workspace. This adapter does
not claim path containment, a precise edit preview, or forced cancellation.
Nonserializable parsed input or side-effecting preparation is not adaptable by
silently skipping validation; such integrations require a new trusted adapter.
Inherited tools must never gain unrestricted access just because migration failed.
The implementation must document these cases and test both source compatibility
and observable behavior rather than describing the policy flag as a universal
legacy-mode switch.

### Acceptance and relationship to earlier decisions

The author explicitly accepted the reviewed recommendation on 2026-09-07,
including one-operation approval, full-access migration, legacy adapter limits,
and the distinction between policy and OS isolation. Implementation remains
not-started, including migration documentation and platform confirmation.

This decision partially supersedes
[Vibe Coding Tool Architecture](2026-08-23-vibe-coding-tools.md): replace its
permission-free product defaults and deferred approval/path-admission policy,
strengthen managed MCP input validation beyond its record-preserving codec,
and require the stated preparation adapters for managed custom-tool execution.
Retain the seven tools, source-aware registry, provider-neutral specifications,
result normalization, and model-provider registration. The older ADR is marked
superseded with this limited scope, preserving its original rationale and
completed implementation evidence. Current full-access behavior remains the
implemented baseline until this accepted change is delivered.

## Consequences

- Positive: the displayed operation, policy decision, execution, and result
  share one identity across every supported surface; MCP startup is covered.
- Negative: users may see more confirmations, custom integrations need trusted
  preparation adapters, and current full-access workflows must opt in explicitly.
- Neutral: policy is not an OS sandbox; external service behavior and arbitrary
  extension code still require trust or a separately supplied isolation backend.

## Context and Problem Statement

At Orbit `8ee97144c20b006225db52efc482004200527e4c`, ToolRuntime's optional
wrapper receives raw calls and a reusable execution closure. Parsing happens
inside that closure. Built-in paths lack containment enforcement, and MCP
`getTools` can start processes before any tool call. A04/A07/A13/A11 require a
shared prepared-operation boundary, rather than a GUI-only confirmation dialog.
The accepted tool ADR deliberately selected full access initially; this is a
new policy choice, not an assertion that current tools violate that decision.

## Decision Drivers

- Bind user confirmation to the actual prepared input and effective settings.
- Apply policy before every managed effect, including process startup.
- Prevent replay, stale replies, and model-generated permission escalation.
- Support a small coding application without claiming a built-in OS sandbox.

## External Implementation Research

On 2026-09-07, source inspection used Codex
`5adb68a49933ae446bf11935662c83dba55a0804` (`rust-v0.152.1`) and Pi
`b79e4cc834970cca69daebffab7df1da7d1e52c4` (`v0.84.4`).
Codex `core/src/tools/orchestrator.rs` evaluates approval before the first
sandbox attempt; `tools/approvals.rs` defines typed actions with command/cwd,
patch content, or original MCP name/arguments and cancellation context.
Adopt typed pre-execution approval and cancellation-aware waiting. Do not copy
its cached grants, guardian, or sandbox escalation as prerequisites for Orbit.
Pi `packages/agent/src/agent-loop.ts` validates arguments before `beforeToolCall`,
can block the call, and checks cancellation after the hook. Adopt this small
preparation step; object passing to hooks is not evidence of immutable approval
binding. Neither system inspection establishes an exact-effects guarantee for
arbitrary commands; Orbit's descriptor/one-use rules are accepted target additions.

## Considered Options

| Option                                                 | Advantages                                          | Costs and disposition                                                                  |
| ------------------------------------------------------ | --------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Application-only callback before a tool event          | Minimal core changes, easy UI integration.          | Can miss library calls, parsing changes, and MCP startup. Not recommended.             |
| Core prepared descriptor, policy, and one-use approval | Shared enforcement with application-specific rules. | New contract and migration cost. Selected.                                             |
| Session-wide remembered permission by default          | Fewer interruptions.                                | More complex scope/revocation and larger accidental authorization. Deferred.           |
| Require an OS sandbox for all operations immediately   | Stronger control of untrusted local programs.       | Broader platform/deployment scope and no remote rollback guarantee. Separate decision. |

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

Prepared operations now bind parsed input, response-local call identity plus
iteration, canonical targets/preimages, environment, source/catalog and policy.
The runtime acknowledges authorization and intent, revalidates after storage,
then registers and starts the trusted executor without an intervening await.
MCP startup resolves the actual executable and its file identity before asking;
managed MCP operations retain a server identity as well as workspace ownership.
Library calls without a responder deny asks; explicit unrestricted legacy
migration remains available. GUI confirmation is bound to its capability,
request ID, digest and responder scope.

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
| Deny, invalid input, absent responder and legacy adapters | `test/core/execution/{agent,contracts}.test.ts` passed again with dispatch counters. | Covers the explicit fixture inputs and policies. |
| Mutation, preimages, symlinks, revocation and approval identity | Existing tests cover frozen input, post-intent target changes, expiry/revocation, wrong digest, opposite and duplicate replies; GUI two-client checks passed again. | Windows path/race behavior remains unmeasured. |
| Unsupported MCP schema | `mcp-contract.test.ts` rejects references, format, unevaluated properties and nested unsupported vocabulary before model exposure. | The tuple-style items case originally escaped recursive checks; `validateSchemaKeywords` now traverses it. No new schema vocabulary was adopted. |
| Supported nested MCP input | Seven input cases exercise compositions, enum/const, properties, array/numeric/string constraints and invalid-before-approval behavior. | This finite matrix does not claim every JSON Schema vocabulary/dialect is supported. |
| Remote timeout and external confirmation | Injected rejection and an actual slow stdio call retain unknown effects, do not retry, close the child, and reconcile from explicit evidence without rewriting the original result. | Production services and network transports were not exercised. |
| User-facing confirmation | Full Ink approve/deny/Ctrl+C and the GUI fault proxy were exercised. The browser returned completed/acknowledged after SSE disconnect, HTTP 503, a delayed stale response and duplicate/reordered notifications. | Fake model and test previews; wider usability trials remain. |

The GUI corrections ignore a previous run's delayed start and clear only the
stream-disconnected notice when the stream reconnects. These and the nested
schema correction restore the accepted behavior; they introduce no new public
API, persistence format or architectural choice. The separate stale-lock race
can defeat cross-process ownership assumed by this contract; its remedy is not
implicitly approved by this evidence update.

### Confirmation remaining before completed

- Resolve the journal ADR's inherited stale-lock ownership defect before claiming
  cross-process ownership under this contract; the option is not yet adopted.
- Windows executable/shell resolution and filesystem race behavior remain
  unverified. A Windows environment and supported Bash installation are needed;
  neither an OS sandbox nor hard process isolation is provided.
- The initial schema subset and local stdio timeout fixtures now have direct
  evidence. Additional dialects/services require explicit compatibility tests,
  not a claim of universal schema support. Production services, broader previews
  and actual human decision timing still need representative trials.

The implementation reference is [Managed Execution](../execution.md), with
[current architecture](../architecture.md), [Agent Runtime](../concepts/agent-runtime.md)
and [coding tool migration](../tools.md). The following original checklist is
retained as acceptance history; it must be reconciled case by case, not marked
satisfied merely because the aggregate suite passes.

### Original acceptance checklist

Acceptance was recorded on 2026-09-07 before implementation.
Baseline headers/build and 293 tests passed; they do not exercise this target
API. Integrate with the
managed supervisor and required journal, add explicit policy selection and
migration docs, then update tool/MCP guides, public types, architecture, and
concepts. Preserve old transcript readability and label missing historical
approval evidence as unknown, never approved.

Required tests include zero handler calls on deny/invalid/unavailable responder;
mutation of raw inputs after preparation; changed preimages/symlinks/configuration
while waiting; wrong run/digest, expired, duplicate, and opposite replies; stop
between journal acknowledgement and dispatch; two GUI clients; unauthorized MCP
startup; remote timeout with unknown effects; and a library invocation with no UI.
Use counters and deferred operations to prove dispatch counts. Separate core
contract tests, confirmation UI application tests, and the edited project's tests.
Also test startup descriptors before a resolved catalog exists, expired approval
and changed targets during the intent-write wait, policy revocation immediately
before dispatch, pending/failed reply acknowledgements, and legacy custom tools
under both policies. Real MCP, OS race resistance, Windows, and real browser
behavior remain untested.

## Follow-up Work

The author accepted the explicit full-access migration, single-operation
approval scope, and the limited safety claim without built-in isolation on
2026-09-07. Details of session-wide grants, external sandbox backends, MCP alias migration, and
resumable approvals remain outside this decision. Implementing an MCP validator
requires a documented supported schema subset and tests before claiming support.
The journal defines record privacy; the runtime defines deadlines and ownership.

## References

- [Research and source ledger](../research/2026-09-07-run-execution-approval-and-recording.md).
- [Managed Run Lifecycle](2026-09-07-managed-run-lifecycle.md).
- [Required Execution Journal](2026-09-07-required-execution-journal.md).
- [Historical full-access tool architecture](2026-08-23-vibe-coding-tools.md): partially superseded for permission-free defaults, managed admission/validation, and custom-tool compatibility; registration and provider-neutral primitives remain retained.
- [Current ToolRuntime](../../src/core/tools/registry.ts), [MCP manager](../../src/core/mcp.ts).
- [Pinned Codex `codex-rs/core/src/tools/orchestrator.rs`](https://github.com/openai/codex/blob/5adb68a49933ae446bf11935662c83dba55a0804/codex-rs/core/src/tools/orchestrator.rs).
- [Pinned Codex `codex-rs/core/src/tools/approvals.rs`](https://github.com/openai/codex/blob/5adb68a49933ae446bf11935662c83dba55a0804/codex-rs/core/src/tools/approvals.rs).
- [Pinned Pi `packages/agent/src/agent-loop.ts`](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/agent/src/agent-loop.ts).
