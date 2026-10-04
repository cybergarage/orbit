---
status: proposed
proposed-date: 2026-10-03
decision-date: null
implementation-status: partial
implementation-completed-date: null
implementation-commits: []
superseded-by: []
---

# Optional local Apple Foundation Models adapter

## Purpose

Expose Apple's on-device model from Node.js while preserving portable npm installation and Orbit's provider boundary. The user requested implementation and a draft PR; the draft implementation is review evidence, not acceptance of this ADR.

## Decision

Propose an optional, explicitly compiled Swift executable with a versioned JSON stdin/stdout protocol. Each request owns one child process, reconstructs a text transcript, checks model availability, and exits. Node owns cancellation, deadlines and byte bounds. No shell, automatic compilation, asset download, cloud fallback or API credentials are involved.

Support text conversations only in this first draft. Reject tool specifications, tool history, non-text output parts, JSON formatting and runtime context overrides. Apple supports additional capabilities, but adapting them honestly requires separate protocol work and live verification. Do not advertise this as a coding-agent replacement.

## Consequences

Portable consumers retain the existing providers without Apple dependencies or install hooks. Mac users must compile and explicitly select a trusted helper. Per-request processes simplify ownership and cancellation but lose framework caches. Text transcript replay does not preserve Apple's private session state. The helper is a trusted local executable; changing its path can execute arbitrary local code and must never be driven by model output.

## Evidence and alternatives

Inspected Orbit main `839ca4f70a816c0d997083e8e264caaee576f0cf`: models/factory.ts registers providers; models/model.ts exposes serializable tool specs and prepared invocations; models/adapters/tools.ts preserves structured outputs; agent.ts dispatches tools outside adapters. Keep these boundaries. Native Node bindings would require another platform dependency; a persistent IPC service would require more lifecycle machinery.

Apple's official Foundation Models documentation and installed SDK Swift interface expose SystemLanguageModel.default.availability, LanguageModelSession, Transcript and GenerationOptions. Swift is the supported language API; no Node API was found. Availability distinguishes device eligibility, disabled Apple Intelligence and model readiness. The framework supports streaming, guided generation and Tool callbacks, which this adapter does not yet bridge. Apple cautions against code generation, math and complex reasoning with the on-device model.

Codex and Pi comparisons are not applicable to this narrow platform bridge: neither determines Apple's licensed SDK, model eligibility or Swift interoperability. Orbit's existing provider-neutral tool and cancellation contracts remain authoritative; no agent scheduling, persistence or tool authorization change is proposed.

## Confirmation and follow-up

Initially observed Mac mini M4, 24 GB, macOS 27.0.1 with xcrun stopped by the unaccepted Xcode license. The user subsequently reported accepting the license. Rechecking verified Swift 6.4; the helper compiled with Xcode 27.0 for an arm64 macOS 26 target. Actual availability returned true. Sandbox generation failed, while the same bounded Node invocation outside the sandbox generated a response and replayed a synthetic two-turn transcript, answering Cobalt to the prior favorite-color prompt. Native process cancellation and invalid protocol fields/caps also passed. No Apple Intelligence settings, downloads, Xcode selection or additional agreements were changed. Live tool roundtrip remains outside the draft subset.

Node build, header checks, 1094 local tests and independent npm consumer validation passed for implementation commit `238f4bb44b046522072a99b398582513677ac19c`. The optional `npm run test:apple` smoke script makes native verification reproducible. The ADR remains proposed: successful text verification does not accept wider framework capabilities.

## References

- https://developer.apple.com/documentation/foundationmodels
- https://developer.apple.com/documentation/foundationmodels/generating-content-and-performing-tasks-with-foundation-models
- https://developer.apple.com/documentation/foundationmodels/expanding-generation-with-tool-calling
- [Usage and protocol](../apple-foundation-models.md)
