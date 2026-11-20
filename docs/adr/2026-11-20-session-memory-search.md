---
status: accepted
proposed-date: 2026-11-20
decision-date: 2026-11-20
implementation-status: in-progress
implementation-completed-date: null
implementation-commits: []
superseded-by: []
---

# Host-Permitted Session Memory Search

## Purpose

Let embedded hosts request canonical Project search without registering a tool or
choosing a Project ID. Keep the existing authorization and isolation boundaries.

## Decision

Add a run-local `AgentInvokeOptions.memorySearch?: () => boolean` host permission.
Absent, false or throwing callbacks deny automatic attachment. The Agent's already
configured ProjectMemoryService derives a binding from the leased live Session,
its registered file and current active membership. Recheck the binding revision,
host permission and actual model object/identity before declarations and execution,
and after results. Core registers the existing read-only factory only in that
run's ordinary tool snapshot. No persistent/default registry mutation occurs.

General supported/unknown capabilities allow attachment; explicit unsupported
does not. Apple requires the concrete dedicated AppleProjectMemoryAgent and its
named observation, never the legacy text-only route or a provider-name guess.
Reject automatic name collisions, keep explicitly registered tools unchanged when
automatic attachment is not requested, and restrict this API to ordinary unselected
Agent runs. A changed admitted binding fails closed rather than silently switching
Projects. The callback is trusted host behavior, not serializable model input or a
workspace setting. The user requested this implementation and the bounded decision
was accepted before coding on 2026-11-20.

## Consequences

Permission can be revoked during a run. Repeated bounded metadata/membership reads
cost time but do not generate or grant execution rights. Search still traverses
the normal OperationExecutor, source validation and existing result limits. Hosts
must configure the trusted service and choose the actual model. No new fallback,
Graph wiring, App/Nest integration, extraction, retention or compaction behavior.

## Context and Problem Statement

Merged #40 supplies explicit scope-bound search, #41 optional tri-state metadata,
and #42 the restricted native Apple route. Constructor-level tool definitions
cannot safely express a per-run current-Session binding or revocable host grant.

## Decision Drivers

Default denial, live scope authority, declaration/execution consistency, no model
scope argument, legacy compatibility and deterministic separate-session evidence.

## External Implementation Research

The accepted search/Apple decisions record Codex
fdd89e78ac33f02e65dabe60567cdfeba2e954d4 (memories/write/src/phase1.rs)
and Pi 95fbc04997eaee961eb673fa7923e9220609ebd5
(packages/coding-agent/src/core/session-manager.ts). Retain the recorded separation
between persisted knowledge and model context. Neither provides this Orbit
OperationExecutor/session lease contract; do not copy global memory attachment or
infer permissions from a provider. This change extends the inspected Orbit
boundaries on cf0306c1ed05772e5501198d2ded009f3daede53, not a new retrieval design.

## Considered Options

Reject default enablement, host/model supplied Project IDs, persistent registry
mutation, tool-name shadowing, and Apple capability claims without its real route.
A callback rather than a bare bool also supports revocation before dispatch.

## Implementation and Confirmation

Pending implementation, full/package verification and deterministic boundary tests.

## Follow-up Work

App/Nest transport APIs, Graph selection and live-model quality evaluation remain
separate work. No real data or paid inference is authorized by this decision.

## References

- https://github.com/cybergarage/orbit/issues/39
- https://github.com/cybergarage/orbit-nest/issues/21
- [Search](2026-11-19-project-memory-search-tool.md)
- [Apple bridge](2026-11-19-apple-project-memory-bridge.md)
