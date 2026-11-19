---
status: accepted
proposed-date: 2026-11-19
decision-date: 2026-11-19
implementation-status: completed
implementation-completed-date: 2026-11-19
implementation-commits: [037d6d80c9b5e75f16c5158cd708e52fe42ca371]
superseded-by: []
---

# Runtime Model Capabilities

## Purpose

Expose the tool-calling capability of the selected Model/adapter route without
requiring inference probes or breaking existing custom Models.

## Decision

Add optional `Model.getCapabilities({signal})`, a bounded resolver, and a common
`canIncludeModelTools` policy. Preserve `supported`, `unsupported` and `unknown`
as distinct observations. Permit tool information for supported and unknown;
exclude it only for an explicit unsupported observation. This is eligibility
for supplying tool information, not authorization to execute tools.

Use the selected instance's metadata and effective SDK route. Ollama reads one
show response for its exact model; missing/malformed metadata or transport errors
are unknown. Reuse the exact OpenAI Chat Completions tool-model list only on the
native endpoint. Reuse Anthropic's active model metadata rule on its native
endpoint with a matching model ID. Unknown IDs, legacy records, unidentified
injected clients and compatibility endpoints remain unknown. The current Apple
text-only adapter reports unsupported independently of Apple's SDK capabilities.

The resolver bounds custom discovery, propagates caller cancellation and aborts
cooperative transports on its deadline. No inference, model download, implicit
retry or default invocation discovery is introduced. Built-in metadata discovery
is bounded too. Do not connect Nest/App, automatically attach Project memory,
filter existing arbitrary tools, or change the coding catalog's strict selection
policy in this change.

## Consequences

Legacy adapters remain source-compatible and resolve to unknown. Unknown is
permissive for optional tool information but is never reported as supported.
Capability is an observation, not an availability, credential or entitlement
check. A backend may still reject a request. Calls do not cache a stale decision
across model or route changes. Injected clients must declare their SDK base URL
for native-route evidence; otherwise the observation is unknown.

## Context and Problem Statement

Baseline c120f125a81a7ac5fcb1b277b5c8bbd4cdc94315 has optional context discovery,
Ollama show metadata, an exact OpenAI tool list, and Anthropic active catalog
records. It has no common runtime capability contract. Catalog inclusion and
optional runtime tool information require different unknown policies.

## Decision Drivers

Backward compatibility, explicit uncertainty, actual model/route identity,
bounded cancellation, metadata-only discovery and unchanged authorization.

## External Implementation Research

Reuse the recorded pinned comparisons in the accepted conversation-model
selection ADR: Codex aa380897f67b91e1a47d530d7286d497b6726d3f
(`codex-rs/core/src/session/turn.rs`) and Pi
5fd446ca1843682e8da3fec4ceb71c42f56fbace
(`packages/coding-agent/src/core/agent-session.ts`). Those reviews support keeping
per-model observations distinct from global defaults; they do not establish
capability rules for Orbit's adapters. Provider evidence is the existing exact
catalog plus official Ollama show, OpenAI model and Anthropic Models API contracts.
Do not copy another framework's provider-name or prefix inference.

## Considered Options

Reject mandatory methods, provider-wide supported defaults, inference probes,
changing unknown to supported, and rejecting unknown optional tool information.
Keep the resolver and policy separate from tool dispatch and catalog eligibility.

## Implementation and Confirmation

The user explicitly approved this Core-only contract, including the permissive
unknown policy, on 2026-11-19. Record implementation confirmation after the scoped
source, tests, export/package and existing validation checks pass.

## Follow-up Work

Nest/App integration and Project-memory attachment are separate work. No release,
merge or change to the Project-memory PR is authorized by this record.

## References

- [Conversation model selection](2026-10-28-conversation-model-selection.md)
- [Model catalog](../model-catalog.md)
- https://docs.ollama.com/api-reference/show-model-details
- https://developers.openai.com/api/docs/models/gpt-4o
- https://platform.claude.com/docs/en/api/models/retrieve

## Implementation confirmation — 2026-11-19

Implementation commit 037d6d80c9b5e75f16c5158cd708e52fe42ca371 adds the optional
contract, resolver/policy, conservative route-aware built-ins and shared catalog
parsers. Headers/build pass, all 1,408 tests pass, and the installed-package probe
compiles and executes legacy/three-state public API checks. The targeted metadata,
context, catalog and selection run passes 42 tests. A separate metadata-only read
of the existing local Ollama model reports tools supported; no inference/load or
model download was requested. Remote API behavior is verified with deterministic
fixtures and official contracts, not live credentialed calls. Apple helper/model
inference, Nest/App integration and automatic tool/memory attachment remain out
of scope. The Project-memory branch and its evaluation conditions are unchanged.
