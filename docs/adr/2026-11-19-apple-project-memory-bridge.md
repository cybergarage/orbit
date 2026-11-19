---
status: accepted
proposed-date: 2026-11-19
decision-date: 2026-11-19
implementation-status: in-progress
implementation-completed-date: null
implementation-commits: [74110e9018a8b17f9e9916b6211ba4516ba5e0bd]
superseded-by: []
---

# Native Apple Project Memory Tool Bridge

## Purpose

Connect the native Foundation Models Tool protocol to the opt-in Core Project
memory search without expanding tool permissions or exposing storage to Swift.

## Decision

Use a separate, explicitly selected adapter and JSON-lines helper. Register only
`project_memory_search` in Swift. Pause native tool calls and return normalized
calls to the ordinary Core ToolRuntime; feed its authorized results back by
invocation nonce and call ID. Bind Project and Session exclusively in the existing
Core tool factory. Retain the original text-only helper unchanged. Advertise only
this named tool, not arbitrary tool support. The user explicitly approved this
bounded implementation on 2026-11-19; the decision was reviewed and accepted
before implementation.

## Consequences

Core remains the storage and authorization boundary. A live native generation
owns a bounded subprocess between tool rounds; callers must close abandoned
adapters. Continuations are process-local and cannot be resumed after restart.
SDK parallel calls need unique IDs; Core dispatch may serialize them. No cloud
fallback, automatic registration, extraction changes, or App/Nest wiring follows.

## Context and Problem Statement

The existing Apple v1 helper closes stdin before generation and rejects tools.
PR #40 supplies the actual read-only search factory and membership validation.
PR #41 supplies an optional capability contract, independent of this stacked
implementation. General tool support remains unsupported on this restricted path.

## Decision Drivers

Native Tool execution, existing authorization, host-owned scope, bounded IPC,
correlation under concurrency, fail-closed compatibility, and isolated evidence.

## External Implementation Research

Apple's official Foundation Models tool-calling article, inspected 2026-11-19,
specifies native Tool, LanguageModelSession, concurrent repeated calls, and
transcript inspection. The existing search ADR records Codex
fdd89e78ac33f02e65dabe60567cdfeba2e954d4 (memories/write/src/phase1.rs)
and Pi 95fbc04997eaee961eb673fa7923e9220609ebd5
(packages/coding-agent/src/core/session-manager.ts). Adopt its separation of
stored memory from transmitted context. Neither implementation is an Apple SDK
IPC bridge; no concurrency or Foundation Models compatibility claim is inferred
from them. The existing Orbit runtime, not either external runtime, owns approval.

## Considered Options

Reject direct Swift database access and model-selected Project IDs. Reject
in-process executable handlers in model specs, arbitrary tools, and a text-only
simulation of native tool execution. Keep the old helper for compatibility.

## Implementation and Confirmation

Implementation commit 74110e9018a8b17f9e9916b6211ba4516ba5e0bd delivered
the separate adapter/helper, public exports, protocol and Core integration tests,
maintained architecture and feature guide. Header checks, build, all 1,421 tests,
and the 526-file independent package consumer passed on 2026-11-19.

The production Swift helper compiled with Swift 6.4.2 targeting macOS 26 on macOS
27.2.1/Apple silicon. The real separate-session synthetic E2E passed without
memory or answer pre-injection: one native Tool call, one ordinary Core dispatch,
matching canonical entry/source IDs, one SDK transcript tool output and a grounded
answer. SDK arguments matched IPC dispatch arguments; only counts/booleans were
published. This is local model evidence, not a quality benchmark.

A distinct ORBIT_PROTOCOL_TEST native build, invoking no model, passed two
concurrent calls with different arguments and reversed result arrival. Deterministic
TypeScript tests cover malformed/foreign calls, correlation, cancellation and late
results, the old EOF-only helper deadline, bounded output, and a real Core membership
change that feeds no result to Swift. The full suite also retains #40's Project
isolation, correction, tombstone and scope controls. See the
[reproduction and limits](../apple-project-memory.md).

## Follow-up Work

General tool support, durable continuation and Nest integration remain out of scope.
Other Apple hardware/OS releases and CI do not establish native-model coverage;
the explicit real-device command remains separate from mock tests.

## References

- https://developer.apple.com/documentation/foundationmodels/expanding-generation-with-tool-calling.md
- https://github.com/cybergarage/orbit/pull/40
- https://github.com/cybergarage/orbit/pull/41
- [Search decision](2026-11-19-project-memory-search-tool.md)

## Accepted capability clarification — 2026-11-19

After #41 merged, the user explicitly requested that Core's optional
`ModelCapabilities.namedTools` preserve bounded adapter-declared names through the
shared resolver. Normalize and copy a valid name list; omit malformed observations.
This does not enable arbitrary tools, select a Project, or grant permissions.
Identity changes during discovery discard named observations together with the
rest of the result; there is no cross-model cache. Extend the existing fixed-tool
decision with this additive contract and verify it through public/package APIs.
This clarification is accepted before implementation. Prior native-device evidence
above remains historical; no new inference is necessary for metadata normalization.
