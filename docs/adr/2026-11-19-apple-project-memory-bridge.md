---
status: accepted
proposed-date: 2026-11-19
decision-date: 2026-11-19
implementation-status: in-progress
implementation-completed-date: null
implementation-commits: []
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

Pending protocol, package, complete repository and real-device verification.

## Follow-up Work

General tool support, durable continuation and Nest integration remain out of scope.

## References

- https://developer.apple.com/documentation/foundationmodels/expanding-generation-with-tool-calling.md
- https://github.com/cybergarage/orbit/pull/40
- https://github.com/cybergarage/orbit/pull/41
- [Search decision](2026-11-19-project-memory-search-tool.md)
