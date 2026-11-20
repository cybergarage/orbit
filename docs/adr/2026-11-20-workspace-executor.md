---
status: accepted
proposed-date: 2026-11-20
decision-date: 2026-11-20
implementation-status: in-progress
implementation-completed-date: null
implementation-commits: []
superseded-by: []
---

# Optional Workspace Executor for Core Coding Tools

## Purpose

Allow an embedding host to replace the execution of Orbit's built-in coding tools
without moving the Agent, its Session, Project memory, model, approvals, or
journal into the execution environment.

## Decision

Add a trusted, optional construction-time `AgentExecutionOptions.workspaceExecutor`
for managed `bash`, `read`, `write`, `edit`, `list`, `glob`, and `grep`.
Orbit retains schemas, tool registration, scope and path preparation, policy,
approvals, resources, intent records, and settlement. The executor receives only
an immutable, size-bounded prepared request and the current run's abort signal,
after authorization and final revalidation. There is no legacy fallback after
injected dispatch. Unconfigured clients retain the existing local path.

Phase 1 assumes the host and executor agree on the prepared workspace namespace.
A trusted backend must faithfully execute the request within that namespace and
report known outcomes or reject when settlement is unknown. Contract conformance
is not an OS sandbox. Application-controlled selection is not a model argument,
workspace setting, or GUI setting. No App/Host/CLI/GUI/Nest backend is enabled.

## Consequences

Managed backends are injectable without rewriting tool declarations or bypassing
execution policy. A failed/uncertain invocation keeps the existing unknown-effect
behavior; it is never silently rerouted. The interface increases the trusted code
surface of the embedding host. Existing filesystem and process limits are not
replaced by native enforcement in this phase.

## Context and Problem Statement

Built-in operations are prepared and authorized in
`src/core/execution/authorization.ts`. The default handlers in
`src/core/tools/builtins/` execute locally. Replacing whole tool definitions
would duplicate schema, authorization, and run evidence, while moving the whole
Agent would mix execution isolation with conversation state.

## Decision Drivers

Preserve default behavior and approval/journal ordering, keep filesystem effects
separate from memory and model access, use one reviewed preparation path, and
decline unsupported or uncertain work rather than retrying on the host.

## External Implementation Research

Inspected 2026-11-20:
- [Codex exec at a4495dd5c9b99c528a73bba1a5d39d4048834db0](https://github.com/openai/codex/blob/a4495dd5c9b99c528a73bba1a5d39d4048834db0/codex-rs/core/src/exec.rs)
  prepares the local request via SandboxManager before passing it to execution.
  Adopt the reviewed-request boundary, not its process/backend implementation.
- [Pi bash](https://github.com/earendil-works/pi/blob/95fbc04997eaee961eb673fa7923e9220609ebd5/packages/coding-agent/src/core/tools/bash.ts)
  and [read](https://github.com/earendil-works/pi/blob/95fbc04997eaee961eb673fa7923e9220609ebd5/packages/coding-agent/src/core/tools/read.ts)
  at 95fbc04997eaee961eb673fa7923e9220609ebd5 accept injected operations below
  the tool descriptions and schemas. Adopt narrow dependency injection, not
  direct replacement of Orbit's managed operation policy or a backend selector.

## Considered Options

- Retain only the local path: best compatibility, but no substitutable boundary.
- Rebuild all tools in each host: rejected because this duplicates contracts and
  makes review and journal consistency harder.
- Separate prepared execution below managed built-ins: selected.
- Move the Agent into each executor or use a memory proxy: not needed for phase 1.

## Implementation and Confirmation

The maintainer approved phase 1 implementation on 2026-11-20. Confirm each of the
seven routing paths, scope and approval denial, stale preimage rejection,
cancellation/unknown settlement, no fallback, and unchanged default behavior
before finalizing this record.

## Follow-up Work

Consider Docker transport and backend attestation, then native/automatic selection
and explicit Host as separate decisions. Remote path translation, a remote
preparation protocol, and concrete backend isolation are outside phase 1.

## References

- [Current Core architecture](../architecture.md)
- [Execution model](../concepts/execution-model.md)
