# Current Architecture

This document maps the Orbit implementation at the current repository state.
It describes existing components in the present tense. Directional concepts
that are not implemented belong under [Concepts](concepts/README.md), and the
rationale for significant choices belongs in
[Architecture Decision Records](adr/README.md).

## System overview

Orbit is an oclif-based CLI and reusable TypeScript library with a loopback-only
local GUI. All application surfaces use components from the reusable runtime
under `src/core/`. The runtime connects workspace configuration and context, a
provider-neutral model interface, tool registries, persisted sessions,
structured logs, and thread lifecycle events.

```text
CLI exec / interactive       Local GUI
          |                      |
          |            OrbitApplicationService
          |                      |
          |                ThreadManager
          |                      |
          +---------> Agent <----+
                   /   |    \
              Model  Tools  Session
                |      |       |
           provider  built-in, records and
           adapters  custom,   persistence
                     and MCP
```

## Application surfaces

- `src/apps/cli/` contains oclif commands and command-specific input and output.
- `src/apps/gui/` contains the loopback HTTP server and React client. Its
  server delegates runtime behavior to `OrbitApplicationService`.
- `src/core/application.ts` provides the application service used by the GUI.
  It resolves settings and context, owns thread, session, log, and diagnostic
  services, and exposes runtime snapshots.
- `src/core/thread.ts` manages in-memory thread lifecycles, active runs,
  cancellation, event translation, and session ownership.

## Agent turn lifecycle

`Agent` in `src/core/agent.ts` is the current orchestration boundary. One
invocation performs the following sequence:

1. Record turn context, append new messages, and emit a turn-start event.
2. Load MCP tools and combine built-in, custom, turn-scoped, and MCP tool
   definitions into an immutable tool snapshot.
3. Build model context from the session and invoke the configured model.
4. Append and emit the assistant response.
5. Return when the response has no tool calls.
6. Otherwise validate and execute tool calls, append their results, and repeat
   the model step within the configured iteration limit.
7. Flush the terminal session state on completion, cancellation, or failure.

Model iterations are sequential because each request depends on the previous
tool results. Within one iteration, `ToolRuntime` can batch tools marked for
parallel scheduling; serial tools act as barriers.

This is a fixed, bounded model/tool loop. The runtime does not currently
interpret a general execution graph or change its topology between turns.

## Model boundary

`src/core/models/model.ts` defines a provider-neutral `Model` interface that is
also an `Operator`. Provider adapters under `src/core/models/adapters/` own
request and response serialization for OpenAI, Anthropic, and Ollama.
`ModelRegistry` selects registered providers without placing provider switches
inside the agent loop.

Normalized output parts preserve ordered text, reasoning, refusal, media,
citation, and tool-call information. Provider-only response data remains under
JSON-serializable metadata.

## Tool boundary

`src/core/tools/` separates model-facing tool specifications from executable
handlers. `ToolRegistry` validates names and rejects collisions, then creates a
snapshot used by `ToolRuntime`. The runtime validates tool input, applies
scheduling rules, and converts failures to tool results.

Built-in coding tools, custom tools, turn-scoped tools, and tools discovered
through MCP share this execution boundary. MCP is an integration source for
tools; it is not the runtime's general composition mechanism.

## Operator and Processor boundary

`src/core/processor/` provides the current composition primitives:

- `Operator` defines a named asynchronous `invoke` contract.
- `Agent`, `Model`, and `Tool` implement `Operator`.
- `OperatorSequence` passes each operator's output to the next operator in a
  non-empty linear sequence.
- `Processor` extends `Operator` with required `name` and `type` identity.
- `ProcessorRegistry` registers processors by their type and name.

The current `Processor` types reuse `OperatorType`, whose supported values are
agent, model, sequence, and tool. No runtime component currently executes
arbitrary processor edges, routes by state, validates a graph, or persists a
graph version.

## State and persistence

`State` currently owns a `Session`. The session package records messages, turn
context, turn terminal events, and session metadata. `SessionContextBuilder`
derives model input from those durable records.

`SessionRepository` creates, opens, lists, and deletes append-only session
files. `SessionRecorder` serializes writes and uses process-aware lock files to
prevent concurrent writers. Session records are distinct from structured
runtime logs; the former reconstruct model context and user history, while the
latter support diagnostics and observability.

## Configuration and context

Workspace settings are merged from discovered `.orbit/settings.json` files and
explicit options. System context is loaded from `ORBIT.md` and `AGENTS.md` in
qualifying ancestor workspaces. Provider credentials and connection settings
remain configuration inputs rather than persisted session content.

## Observability and control

Agent, model, tool, turn, and thread boundaries emit structured events.
Session-scoped logs retain correlation identifiers for application, session,
thread, run, turn, and iteration where applicable. Abort signals propagate
through threads, model calls, and tool execution; terminal state is flushed
before a run settles.

The GUI boundary is loopback-only and requires a startup capability token for
assets, APIs, and event streams. Origin checks, request limits, and schema
validation remain part of that boundary.

## Current extension seams

Orbit can currently be extended through registered model providers, custom and
MCP tools, workspace settings and context, injected dependencies at external
boundaries, and the public thread event API. These are implemented seams, not a
plugin system for replacing every runtime component.

The broader Processor Graph and adaptive execution models are directional.
They must pass through research and ADR review before they change the runtime.

## Related documentation

- [Concept Overview](concepts/overview.md)
- [Agent Runtime](concepts/agent-runtime.md)
- [Processor Model](concepts/processor-model.md)
- [Coding Tools](tools.md)
- [Sessions](session.md)
- [Session Logs](logging.md)
- [GUI Integration](gui-integration.md)
- [Architecture Decisions](adr/README.md)
