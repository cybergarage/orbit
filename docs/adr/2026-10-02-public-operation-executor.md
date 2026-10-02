---
status: accepted
proposed-date: 2026-10-02
decision-date: 2026-10-02
implementation-status: completed
implementation-completed-date: 2026-10-02
implementation-commits:
  - 50872709eca86b6fd9575a9836a36917626a547a
superseded-by: []
---

# Run-bound Public Operation Executor

## Purpose

Make the owner and dependencies of managed execution discoverable in the public
framework API while preserving v0.8.0 callers and operation guarantees.

## Decision

Adopt OperationExecutor, constructed with one RunContext and ManagedToolOptions.
Its executeTool method prepares a ToolDefinition call. Its executePrepared
method executes a trusted PreparedOperation and OperationPreparation, with an
optional named deferPluginStartupFailure setting. It owns the existing
orchestration code and binds the Run and policy once. Agent's ordinary loop and
Graph tool nodes, and managed MCP startup, use it.

Retain executeManagedTool and executePrepared with their exact existing
signatures as compatibility delegates to the same implementation. Retain
ManagedToolOptions and add a named AgentExecutionOptions interface for the
existing AgentOptions.execution shape. Do not remove or deprecate exports.

Encapsulate the existing two ownership Maps in an internal ResourceCoordinator.
Every executor, Agent, MCP startup and legacy delegate shares one coordinator
per loaded Orbit module instance, as before. Do not expose replacement or reset
APIs. RunContext retains release callbacks; unknown outcomes retain ownership
until the existing release/reconciliation conditions are satisfied. Preserve
MCP identity and canonical-path conflict rules and acquisition order.

Check Run liveness before starting either executor method, so retaining an
executor does not allow preparation or new journal writes after completion.
This correction also applies to the compatibility delegates.

Keep settings merging, session parsing and other stateless helpers as functions.
No serialization, storage format, policy profile, tool scheduling or approval
protocol changes are proposed. Prepare package version 0.8.1 without publishing
or moving the book's fixed v0.8.0 links to an unpublished tag.

## Consequences

- Positive: application authors can discover related operations on one object,
  and do not repeat the Run and policy at every call. Actual internal call paths
  follow the documented design.
- Positive: shared ownership has one implementation and one explicit scope;
  both old and new callers participate in the same exclusion mechanism.
- Negative: compatible function and class forms coexist and must both be tested.
- Neutral: the coordinator remains shared within one module instance and is not
  a cross-process lock or a new sandbox. Trusted low-level callers still own
  admission, readiness, budgets, transcript synchronization and resource cleanup.
- Neutral: settings and codec functions remain visible in an INSIDE-style book.

## Context and Problem Statement

Baseline: 7782b6208052bd3c2f50ef48992d4ab2632b351d (v0.8.0).
Agent, ToolRuntime, RunSupervisor and RunContext already define substantial
responsibilities, but public operation execution is expressed as two functions
with repeated context. Module-local ownership Maps obscure their lifecycle.
The author requested a bounded public API and execution review and instructed
implementation of supported improvements for v0.8.1, not blanket class conversion.

## Decision Drivers

Preserve source compatibility, shared conflict prevention, approval/journal
ordering, cancellation and unknown-outcome ownership. Improve composition and
explanation with minimal new public concepts. Avoid substitutable enforcement
that could bypass the default resource domain.

## External Implementation Research

Investigation date: 2026-10-02. Pi commit
`a13d35a742c6ef8462812a28fbe1d8c8b7431c32` combines Agent/SettingsManager/
SessionManager classes with loop, merge and parse functions. Inspected files
are agent.ts, agent-loop.ts, settings-manager.ts and session-manager.ts in the
paths recorded in the [research](../research/2026-10-02-public-execution-api.md).
Codex commit `c39bfa4c8ff9a57c46a9d3766676d6435e262691`,
`codex-rs/core/src/tools/orchestrator.rs`, centralizes operation orchestration in
ToolOrchestrator and uses ToolRuntime bounds, while retaining helper functions.
Adopt responsibility-oriented composition; reject uniform class conversion and
Codex-specific sandbox/retry behavior. Comparisons are source readings, not
execution tests or evidence that Orbit's safety guarantees are correct.

## Considered Options

1. Documentation only: useful, but leaves repeated execution context and implicit
   ownership unchanged.
2. Convert every exported function to a class/static method: adds names without
   solving an ownership problem and increases migration cost. Rejected.
3. Run-bound executor plus internal shared coordination and compatible delegates:
   selected; bounded, testable and used by existing callers.
4. Publicly replaceable coordinator/executor interface: adds an unsupported
   enforcement substitution surface. Rejected for this patch.

## Implementation and Confirmation

Not started at proposal. Add cross-instance old/new compatibility tests,
approval/denial and terminal-liveness tests, shared workspace/MCP conflict and
unknown-result/reconciliation tests. Retain existing execution contract tests.
Run headers:check, build, the complete test suite and test:package sequentially.
Update execution, architecture, integration and concept documentation, version
metadata and the consumer example. Preserve unrelated research changes.

## Follow-up Work

npm publication and book-wide target-version/link regeneration remain separate
work. Existing parent ADR deferrals remain unchanged. The author subsequently
authorized commits, the annotated v0.8.1 tag and push; the finalization below
records the implementation commit separately from the initial working-tree
validation.

## References

- [Public API review](../research/2026-10-02-public-execution-api.md)
- [Prepared operation authorization](2026-09-07-prepared-operation-authorization.md)
- [Managed Run lifecycle](2026-09-07-managed-run-lifecycle.md)
- [Managed execution](../execution.md)
- [Architecture](../architecture.md)

## Review and Delegated Acceptance — 2026-10-02

The author explicitly instructed the bounded review and implementation of
supported improvements for v0.8.1. Under that delegation, accept option 3 after
reviewing its compatibility and ownership conditions. This record was first
created proposed / not-started, then reviewed and accepted before source edits.
No additional speculative framework or public replacement mechanism is adopted.

Review corrections: keep the coordinator internal and shared across all
instances; keep the old function signatures; include MCP startup and Graph
nodes; name the existing Agent settings rather than introduce a second settings
model. A named optional method argument replaces the positional startup boolean
only in the new API. Terminal liveness is checked before any preparation.
The documented benefits are composition and explicit responsibility, not
measured performance or a stronger sandbox. Implementation remains not-started
at acceptance. Lifecycle commits are deferred because the author has not
authorized commits, tags or publication in this request.

## Implementation Evidence — 2026-10-02

The accepted code and documentation scope is implemented and validated in the
working tree based on 7782b6208052bd3c2f50ef48992d4ab2632b351d. Status is partial
only because the required implementation/finalization commits have not been
authorized or created; implementation-commits and completion date remain empty.
No tag, push or npm publication was performed.

- `src/core/execution/authorization.ts` owns OperationExecutor and compatibility
  delegates; `resources.ts` owns the internal shared ResourceCoordinator.
- Agent loop, Graph tool nodes and managed MCP startup call the executor.
- AgentExecutionOptions names the original inline option shape, with no field
  removal. PreparedExecutionOptions names the new method's optional setting.
- A recursive source-export inventory found all 462 v0.8.0 root export names
  retained, with exactly those three new public names. This inventory checks
  names, not every historical consumer's source compatibility.
- Constructor binding reduces each tool execution call from five arguments to
  three; prepared calls bind Run, policy and observer once and accept a named
  optional setting. Internal use and the installed-consumer test confirm this
  is the active implementation rather than an unused API wrapper.
- Settings merging, parsing, persistence formats, policy profiles and resource
  conflict identities remain unchanged. No dependencies were updated.

On macOS, Node.js v26.10.0 and npm 11.19.1:

| Check                       | Result                                                                                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| headers:check               | Passed; no header updates needed                                                                                                                               |
| build                       | Passed, including GUI bundle                                                                                                                                   |
| docs:commands               | Passed; generated CLI version/source links identify 0.8.1                                                                                                      |
| New targeted executor tests | 8 passed                                                                                                                                                       |
| npm test                    | 1,078 passed; lint has 0 errors and 99 warnings                                                                                                                |
| test:package                | Passed; 394-file tarball independently installed; new and legacy root imports/type declarations compiled; executor ran; existing consumer and CLI smoke passed |
| git diff --check            | Passed                                                                                                                                                         |

The initial targeted fixture omitted Run readiness for tool-call intents,
causing a timeout and an incorrect expected outcome. Adding the same readiness
step required of trusted consumers fixed the fixture; the corrected tests and
full suite passed. An initial lint run found two sequential-loop lint errors
in the new tests; these were corrected before the successful full run. No
production workaround was introduced for either test issue. Formatter-only
changes to five unrelated e2e files were removed after validation. Pre-existing
Apple Foundation Models research and its index entry were preserved.

Evidence logs: `/private/tmp/orbit-081-headers.log`, `orbit-081-build.log`,
`orbit-081-docs-commands.log`, `orbit-081-targeted.log` (initial failure),
`orbit-081-targeted-2.log`, `orbit-081-tests.log`, `orbit-081-package.log` and
`orbit-081-exports.json`, all under `/private/tmp`. Temporary logs are not
Git-preserved handoff assets.

Verified package: `/private/tmp/orbit-081-release/cybergarage-orbit-0.8.1.tgz`.
SHA-256: `1c88d7af1ca5eb908d84695e66d1447fa73ba177c8e459bfece2c7bf5680f73e`.
The source remains 0.8.1 Unreleased. Real-provider evaluations and additional
platform runs were not repeated. Parent ADR deferrals remain unchanged.
The book's existing v0.8.0 source links and EPUB remain unchanged pending an
explicit release tag and subsequent book comparison.

## Implementation Finalization and Source Release — 2026-10-02

Following working-tree validation, the author explicitly requested commits,
tagging and push. The research/decision record was committed in
5646b18a9890a7090eaa9dde3226464f482064c2 (the initial uncommitted lifecycle is
preserved above). The accepted
implementation is committed in
50872709eca86b6fd9575a9836a36917626a547a. Its complete defined scope and maintained
documentation are delivered, with the 1,078-test suite and independent package
validation recorded above. Mark this bounded ADR completed; do not change the
status or deferred confirmation scope of any parent ADR.

The release finalization changes only documentation and release evidence.
No source, test, dependency or storage behavior changed after validation.
The changelog date is 2026-10-02. The annotated v0.8.1 tag identifies the
subsequent release documentation commit, which contains this implementation
hash. Publish main and that tag together without rewriting v0.8.0. npm
publication and book-wide source comparison are outside this release action.

Final release-documentation package validation passed with 394 files, including
consumer compilation, operation execution, existing consumer smoke and CLI help.
Log: `/private/tmp/orbit-081-package-final.log`.
Package: `/private/tmp/orbit-081-release-final/cybergarage-orbit-0.8.1.tgz`.
SHA-256: `9e00b4a786413c9e37340e73ee8f4f825f03bea10f702f2e267a79a8662de989`.
