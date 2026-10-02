---
status: current
investigation-date: 2026-10-02
orbit-commit: 7782b6208052bd3c2f50ef48992d4ab2632b351d
related-adrs:
  - docs/adr/2026-10-02-public-operation-executor.md
superseded-by: []
---

# Public Execution API Review

## Purpose

Review the framework boundaries visible to application developers and readers
of an implementation-focused book. Limit changes to managed execution and its
public composition surface; do not convert every internal function to a class.

## Findings

Source inspection establishes that Orbit already combines stateful components
and data transformations. A function's existence is not evidence of missing
design. The useful correction is to expose the ownership of a managed operation
without forcing callers to repeatedly assemble its Run and policy arguments.

| Public area                      | Baseline evidence                                                                        | Assessment                                                                                             |
| -------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Application and conversations    | `application.ts`, `thread.ts`, `agent.ts`: service, manager and Agent classes            | Retain the existing integration boundaries.                                                            |
| Run lifecycle                    | `execution/run.ts`: RunSupervisor, RunContext, RunHandle                                 | Retain admission, shutdown, reconciliation and immutable results.                                      |
| Operation execution              | `execution/authorization.ts`: executeManagedTool and executePrepared                     | Add a Run-bound executor used by Agent, Graph and managed MCP startup; retain compatible functions.    |
| Shared ownership                 | Module-level serverOwners and resourceOwners Maps in authorization.ts                    | Encapsulate ownership in an internal coordinator, preserving sharing across executors and supervisors. |
| Tools and model adapters         | ToolDefinition, ToolRegistry, ToolRuntime, Model, ModelRegistry                          | Already have typed extension boundaries; no new parallel abstraction needed.                           |
| Settings                         | settings.ts: mergeWorkspaceSettings builds a new result                                  | Keep the transformation function; no persistent instance is needed.                                    |
| Session data                     | session/codec.ts: parseSessionFile parses supplied text; repository and recorder own I/O | Keep the codec functions and existing classes.                                                         |
| Evaluation and Graph compilation | core/index.ts exposes inspection/comparison/compilation functions and typed results      | No demonstrated ownership or substitution problem requiring a class in this scope.                     |

This is a responsibility review of the package export surface and selected
implementations, not an exhaustive audit of every exported function. Low-level
exports are trusted integration machinery, not automatically safe standalone
Agent substitutes. An additional class must be used internally as well as
exported; a cosmetic wrapper with a separate implementation would not help.

## External Systems Investigated

Investigated on 2026-10-02 by source reading, without executing their tests.

- Pi: `a13d35a742c6ef8462812a28fbe1d8c8b7431c32`, clean local checkout.
  `packages/agent/src/agent.ts` defines Agent as the stateful wrapper around the
  loop; `agent-loop.ts` supplies standalone loop and tool-execution functions.
  `packages/coding-agent/src/core/settings-manager.ts` combines SettingsManager,
  SettingsStorage and standalone merging helpers. `session-manager.ts` combines
  SessionManager and parseSessionEntries/buildSessionContext functions.
  Adopt explicit state ownership and retain transformations. Do not infer that
  Pi's parsing, permission or persistence guarantees equal Orbit's.
- Codex: `c39bfa4c8ff9a57c46a9d3766676d6435e262691`.
  `codex-rs/core/src/tools/orchestrator.rs` defines ToolOrchestrator with a run
  method bounded by ToolRuntime and standalone result helpers. Its central
  operation orchestration supports a named execution component, but the
  orchestrator itself is a fieldless Rust struct. This is contrary evidence to
  any claim that all behavior must own instance state. Do not adopt its sandbox
  retries or equate Rust traits with TypeScript inheritance.

## Non-binding Implications

A small OperationExecutor bound to RunContext and managed options can make
ownership and method discovery clearer. Its two operations should cover tool
preparation and already-prepared startup operations. Resource coordination must
remain shared across instances, including legacy free-function calls. Exposing
an arbitrary coordinator replacement would allow callers to accidentally split
the conflict domain and is not justified by this review.

Name Agent's existing execution option shape so hosts can type reusable
configuration directly. Preserve all existing root exports and call signatures.
No new storage format, permission policy, network dependency or inheritance tree
is needed. Acceptance belongs to the linked ADR, not this note.

## Confirmation Required

Exercise new and legacy APIs together: approvals and denials, admission before
effects, shared workspace and MCP ownership across supervisors, normal release,
retention after unknown outcomes, reconciliation and refusal after terminal
completion. Validate the root import in an independently installed package.

## Limitations

The Orbit baseline is the local v0.8.0 commit. Initial unauthenticated remote
lookup failed in the restricted shell; the Codex pinned file was subsequently
retrieved with authorized network access. No comparative performance or
security improvement is claimed. Existing deferred platform and product
validation in earlier ADRs remains deferred.

## References

- [Pi Agent](https://github.com/badlogic/pi-mono/blob/a13d35a742c6ef8462812a28fbe1d8c8b7431c32/packages/agent/src/agent.ts)
- [Pi loop](https://github.com/badlogic/pi-mono/blob/a13d35a742c6ef8462812a28fbe1d8c8b7431c32/packages/agent/src/agent-loop.ts)
- [Pi settings](https://github.com/badlogic/pi-mono/blob/a13d35a742c6ef8462812a28fbe1d8c8b7431c32/packages/coding-agent/src/core/settings-manager.ts)
- [Pi sessions](https://github.com/badlogic/pi-mono/blob/a13d35a742c6ef8462812a28fbe1d8c8b7431c32/packages/coding-agent/src/core/session-manager.ts)
- [Codex orchestrator](https://github.com/openai/codex/blob/c39bfa4c8ff9a57c46a9d3766676d6435e262691/codex-rs/core/src/tools/orchestrator.rs)
