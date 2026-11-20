---
status: accepted
proposed-date: 2026-11-20
decision-date: 2026-11-20
implementation-status: completed
implementation-completed-date: 2026-11-20
implementation-commits: [5a9c32d585b86a742eec022cff45ee6fb47b8a53]
superseded-by: []
---

# Host-Permitted Session Memory Search

## Purpose

Let embedded hosts request canonical Project search without registering a tool or
choosing a Project ID. Keep the existing authorization and isolation boundaries.

## Decision

Add a run-local `AgentInvokeOptions.memorySearch?: ProjectMemorySearchPermission` host permission.
The callback receives immutable Core-derived Project/Session IDs, never a scope
selected by its return value. Absent, false or throwing callbacks deny attachment. The Agent's already
configured ProjectMemoryService derives a binding from the leased live Session,
its registered file and current active membership. Recheck the binding revision,
host permission and actual model object/identity before declarations and execution,
and after results. Core registers the existing read-only factory only in that
run's ordinary tool snapshot. No persistent/default registry mutation occurs. Core Application/Thread facades
only pass through the trusted callback; UI and transport routes do not grant it.
Permission identity participates in request conflict detection. Apple's fixed path
uses a search-only run catalog even when general defaults are configured, and
Core closes that automatically attached native continuation when the run exits.

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

Implementation commit 5a9c32d585b86a742eec022cff45ee6fb47b8a53 delivers the
run-local Agent catalog/guards, trusted Core facade passthrough, public permission
type, canonical live-binding lookup and the maintained feature/architecture guide.
Headers/build and all 1,483 tests pass, including 28 new synthetic boundaries.
The independent installed-package consumer passes (534 files), including public
callback types at Agent/Thread/Application boundaries. The existing compiled Swift
native actor protocol regression passes two distinct calls with reverse-order
results, separately from model inference.

The tests dispatch actual canonical search from Session B against source-backed
memory saved in A without answer pre-injection. They cover supported/unknown/
unsupported, immutable scope grants, default/denied/throwing permissions, foreign
repositories and scope injection, current-model switches, changed membership,
execution-policy denial, correction/retirement, per-run catalogs and collisions,
permission-aware retry identity, revocation before provider dispatch and after
retrieval, and paused native cleanup. No real user data, real-model inference,
paid provider requests or benchmark rerun was used. Native persisted-history replay
limits remain inherited; they are not qualified or expanded by these checks.

## Follow-up Work

App/Nest transport APIs, Graph selection and live-model quality evaluation remain
separate work. No real data or paid inference is authorized by this decision.

## References

- https://github.com/cybergarage/orbit/issues/39
- https://github.com/cybergarage/orbit-nest/issues/21
- [Search](2026-11-19-project-memory-search-tool.md)
- [Apple bridge](2026-11-19-apple-project-memory-bridge.md)
