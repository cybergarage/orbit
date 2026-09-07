---
status: proposed
proposed-date: 2026-09-07
decision-date: null
implementation-status: not-started
implementation-completed-date: null
implementation-commits: []
superseded-by: []
---

# Prepared Operation Authorization

## Purpose

Allow the application to show an edit or command and execute only the operation
that the user actually confirmed. Apply the same rule to built-ins, custom tools,
MCP startup, and MCP tool calls, regardless of the CLI, GUI, or library entry point.

## Decision

**Proposed, not accepted.** Core prepares an operation, evaluates application
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

The descriptor carries schema version, operation ID, run/session/call IDs,
source identity, tool/catalog generation, normalized input, canonical cwd,
policy/configuration generation, declared effect kind, and applicable targets.
MCP identity includes configured server ID and the original remote tool name,
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

Use a versioned canonical JSON encoding and SHA-256 descriptor digest for
comparison, not as an authorization credential. Reject unsupported/non-finite
values before approval. Keep the full immutable descriptor private to the
runtime; send the authorized UI a redacted display projection with a digest.
Secret values must not be copied into diagnostic events. The display explicitly
identifies redacted inputs and the credential/environment binding without
revealing values. If those omissions prevent an informed decision, policy must
deny or require application-owner configuration rather than accepting a vague
confirmation. The private digest
includes effective values, while durable/public references use an opaque
operation ID and a keyed digest as specified by the journal ADR.

The proposed sequence is:

1. Validate unique call IDs, resolve the catalog entry, parse input, and prepare
   its descriptor. Invalid calls produce `invalid` without handler invocation.
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
5. Acknowledge an operation-intent record, then atomically consume the permit
   and register/start the handler with respect to the supervisor's stop check.
   If stop wins during the acknowledgement, append not-started evidence and do
   not execute. Record the outcome even if the caller has disconnected.

Only the trusted adapter may derive the actual dispatch arguments. Rechecking
path identity/preimages is required but does not eliminate filesystem TOCTOU
against another process. Stronger race resistance requires suitable filesystem
operations or an isolation backend and must not be advertised without testing.
In-process leases prevent cooperating Orbit operations from racing, not arbitrary
external edits. Custom code is trusted: it must obey the descriptor/executor
contract. Calling arbitrary exported JavaScript functions outside the managed
runtime is not a supported policy-enforced execution path.

### Approval replies and waiting

A pending approval contains request ID, run ID, operation ID, descriptor digest,
configuration generation, expiry, and local responder scope. The UI shows the
operation's exact non-secret target, change/command, cwd, effect warning, and
one-operation scope. Model text, transcript messages, tool outputs, and Skills
cannot submit approval replies.

`replyApproval` accepts approve or deny once, validates the authenticated local
application channel and all identifiers, and returns a stable acknowledgement.
Identical transport retries return the previous reply acknowledgement; an
opposite reply or mismatched digest is a conflict. A second GUI tab does not
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

The catalog is fixed for the run. Reject alias collisions and unsupported names
with original identity in the error; do not silently select one tool. A stable
renaming/migration scheme and richer MCP content handling are separate decisions.
Calling an MCP tool requires its own policy decision; permission to start the
server is not blanket permission for its tools. Forward cancellation/deadline
to SDK calls and register the client with the supervisor. A timeout or transport
close does not prove the remote operation was cancelled.

### Product profiles and compatibility

Recommend a named `workspace-confirm` product profile: permit supported read
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
access is an intentional compatibility change requiring author approval and
release/migration documentation before implementation. No existing accepted ADR
is marked superseded while this proposal remains undecided.

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
arbitrary commands; Orbit's descriptor/one-use rules are proposed additions.

## Considered Options

| Option                                                 | Advantages                                          | Costs and disposition                                                                  |
| ------------------------------------------------------ | --------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Application-only callback before a tool event          | Minimal core changes, easy UI integration.          | Can miss library calls, parsing changes, and MCP startup. Not recommended.             |
| Core prepared descriptor, policy, and one-use approval | Shared enforcement with application-specific rules. | New contract and migration cost. Recommended.                                          |
| Session-wide remembered permission by default          | Fewer interruptions.                                | More complex scope/revocation and larger accidental authorization. Deferred.           |
| Require an OS sandbox for all operations immediately   | Stronger control of untrusted local programs.       | Broader platform/deployment scope and no remote rollback guarantee. Separate decision. |

## Implementation and Confirmation

No implementation or acceptance is recorded. Baseline headers/build and 293 tests
passed; they do not exercise this proposed API. If accepted, integrate with the
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
Real MCP, OS race resistance, Windows, and real browser behavior remain untested.

## Follow-up Work

The author should judge the explicit full-access migration, single-operation
approval scope, and the limited safety claim without built-in isolation. Details
of session-wide grants, external sandbox backends, MCP alias migration, and
resumable approvals remain outside this proposal. Implementing an MCP validator
requires a documented supported schema subset and tests before claiming support.
The journal defines record privacy; the runtime defines deadlines and ownership.

## References

- [Research and source ledger](../research/2026-09-07-run-execution-approval-and-recording.md).
- [Managed Run Lifecycle](2026-09-07-managed-run-lifecycle.md).
- [Required Execution Journal](2026-09-07-required-execution-journal.md).
- [Accepted full-access tool architecture](2026-08-23-vibe-coding-tools.md): retain registration/tool primitives; explicit permission-free product defaults would be replaced only upon acceptance of this proposal.
- [Current ToolRuntime](../../src/core/tools/registry.ts), [MCP manager](../../src/core/mcp.ts).
- [Pinned Codex `codex-rs/core/src/tools/orchestrator.rs`](https://github.com/openai/codex/blob/5adb68a49933ae446bf11935662c83dba55a0804/codex-rs/core/src/tools/orchestrator.rs).
- [Pinned Codex `codex-rs/core/src/tools/approvals.rs`](https://github.com/openai/codex/blob/5adb68a49933ae446bf11935662c83dba55a0804/codex-rs/core/src/tools/approvals.rs).
- [Pinned Pi `packages/agent/src/agent-loop.ts`](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/agent/src/agent-loop.ts).
