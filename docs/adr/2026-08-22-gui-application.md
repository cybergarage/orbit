---
status: accepted
proposed-date: 2026-08-22
decision-date: null
implementation-status: completed
implementation-completed-date: 2026-08-22
implementation-commits:
  - "9380f399842182417c627ed518c330775143b8a7"
superseded-by: []
---

# GUI Application Architecture

## Purpose

This ADR records the architecture and initial product boundary for Orbit's
local graphical application.

## Decision

Orbit will expose its reusable runtime through a loopback-only application
service and an Express and React client. The client will use validated REST
commands and Server-Sent Events instead of calling model adapters or session
files directly, and it will present conversations, sessions, and typed
diagnostics in a three-pane interface.

## Related accepted extension (2026-09-07)

[Managed Run Lifecycle](2026-09-07-managed-run-lifecycle.md)
retains this local service and REST/SSE architecture and extends it with shared
core run ownership, stop results, and cleanup semantics.
This ADR remains accepted for its original scope. The extension was accepted on
2026-09-07 and is not implemented; the historical rationale and implementation
evidence below do not establish completion of that extension.

## Consequences

- Positive: GUI behavior remains testable through provider-neutral application
  contracts, and model, tool, session, and startup activity is inspectable.
- Negative: Orbit owns an additional web build, transport DTOs, event replay,
  and a security boundary that must remain loopback-only and token protected.
- Neutral: projects, worktrees, terminals, previews, remote execution, and
  multi-agent orchestration remain separate future decisions.

## Implementation and Confirmation

The initial scope was implemented on 2026-08-22 by commit
`9380f399842182417c627ed518c330775143b8a7`, with deterministic application,
server, diagnostics, and session tests plus maintained GUI documentation.

## Summary

Orbit already has most of the runtime primitives required by a graphical
client: durable JSONL sessions, a reusable agent runtime, an event-driven
`ThreadManager`, cancellation, model adapters, MCP tools, and structured Pino
logging. The recommended first application is a local Express and React client
with three panes:

- a left sidebar containing New Chat and recent sessions;
- a central conversation view with a prompt composer;
- an optional right diagnostics inspector.

The GUI should not call model adapters or session files directly. A small
application-service layer should expose validated commands and queries over
HTTP and stream typed runtime notifications to the renderer. The first release
should remain a single-workspace application and explicitly defer projects,
worktrees, diff review, integrated terminals, previews, remote execution, and
multi-agent orchestration.

The most important prerequisite is observability. The current logger can feed
raw JSON to a GUI, but log strings are not a stable application protocol.
Orbit should retain the logger for operational output and add a typed
diagnostic event bus for model requests, model responses, tool activity,
configuration resolution, context loading, MCP startup, and session lifecycle
events.

## Product scope

### Initial release

The initial GUI should support:

- creating a new chat in the application working directory;
- listing sessions stored below `~/.orbit/sessions`;
- opening and resuming an existing session;
- rendering user, assistant, tool-call, and tool-result messages;
- sending a prompt and cancelling the active run;
- showing the effective provider and model;
- showing structured startup and runtime diagnostics;
- inspecting the exact redacted model request and model response;
- inspecting tool requests, tool results, usage, stop reasons, and duration;
- showing or hiding the diagnostics pane independently from capture policy;
- closing agents, MCP clients, and session writers reliably at shutdown.

### Deferred

The initial release should not implement:

- projects or project switching;
- Git worktrees or handoff;
- visual diff review;
- an integrated terminal or file editor;
- application previews;
- cloud or SSH execution;
- approvals and permission modes;
- scheduled tasks;
- session archive, deletion, fork, or branching;
- subagents or parallel agent orchestration.

An Orbit application instance has one startup working directory. New chats use
that directory. The Recent list may include sessions from other directories;
resuming one must restore the working directory, provider, model, and system
prompt recorded in its session metadata. Showing a session's working directory
is not a projects feature and is necessary to avoid ambiguous resumes.

## Current Orbit implementation

### Runtime stack

Orbit currently uses:

- Node.js 18 or newer;
- strict TypeScript with native ESM and Node16 module resolution;
- oclif for CLI commands;
- Ink and React for the terminal UI;
- Pino for structured logging;
- OpenAI, Anthropic, Ollama, and MCP SDKs;
- append-only JSONL session persistence;
- Mocha, Chai, and Sinon for tests.

Express, a browser build system, a WebSocket implementation, and a desktop
shell are not current dependencies.

### Sessions and threads

`SessionRepository` creates, opens, lists, and summarizes date-sharded JSONL
sessions under `~/.orbit/sessions`. Stored entries contain session metadata,
turn context, turn state, messages, tool calls, and tool results. Session files
preserve message IDs, timestamps, parent links, and turn IDs.

`ThreadManager` supplies the main GUI-facing lifecycle API. It can create and
resume threads, return snapshots, send messages, cancel runs, and close owned
resources. It emits typed events for:

- run start, completion, cancellation, and failure;
- model iteration start;
- assistant message completion;
- tool start and completion.

Only one run may execute in a thread, while independent threads may run in
parallel. The manager currently accepts one event callback at construction
time, and `sendMessage` returns only after the model run finishes.

The GUI needs two refinements:

1. a subscription API that permits the application service, diagnostics, and
   tests to observe the same event stream safely;
2. a run-start operation that returns a run ID and completion promise
   immediately, while retaining `sendMessage` as a compatibility wrapper.

Resume also needs correction. The current path restores persisted messages and
the system prompt, but it does not automatically apply the persisted working
directory, provider, and model to the new agent. That is especially important
when Recent shows sessions created in different directories.

### Session listing

`SessionRepository.list()` recursively scans and parses every JSONL file using
synchronous filesystem calls, then sorts summaries by creation time. This is
acceptable for the current CLI but can block an Express event loop as the
number or size of sessions grows. One corrupt session can also prevent the
entire list from rendering.

The GUI query should therefore use an asynchronous, paginated listing API and
return per-file diagnostic errors without failing the complete result. A
database or index is unnecessary for the first release; a bounded asynchronous
scan is sufficient.

### Logger suitability

The current `Logger` supports structured fields, child bindings, dynamic debug
level control, and an injected Pino destination. A custom destination can send
raw Pino records to the right pane, making it a useful bootstrap mechanism.

It is not a suitable stable GUI protocol because:

- message strings are implementation details;
- correlation fields are not required;
- configuration, context, session, and MCP operations do not consistently log;
- model request and response values are not logged;
- a renderer should consume versioned domain events rather than parse logs.

Orbit should keep Pino logging and add a separate `DiagnosticEventBus` with
typed events and multiple sinks. Expected sinks are a Pino sink, an in-memory
ring buffer, and the GUI event stream.

### Model request and response visibility

The agent currently logs model iteration start and completion, tool count, and
message counts. It does not log the actual provider request or response.

The provider SDK responses contain useful data that adapters currently discard:

- OpenAI exposes a response ID, model, finish reason, prompt tokens,
  completion tokens, total tokens, cached tokens, and reasoning tokens;
- Anthropic exposes a response ID, model, stop reason, input tokens, output
  tokens, cache-read tokens, and cache-creation tokens;
- Ollama exposes prompt evaluation count, evaluation count, load duration,
  prompt evaluation duration, evaluation duration, and total duration.

Orbit should normalize these values into provider-neutral response metadata and
retain an optional provider-specific diagnostic payload. The exact redacted
provider request should be emitted after message and tool serialization so the
debug inspector shows what was actually sent, rather than an approximation at
the agent layer.

Tool requests are already represented as `payload.toolCalls` and emitted in
thread events. Tool results are also persisted. The missing part is complete
diagnostic presentation: input, output, error state, correlation ID, duration,
and association with a model iteration.

Streaming is not currently implemented. Each adapter waits for a complete
provider response and `ThreadManager` emits a completed message. Token-delta
events can be added later without changing the initial HTTP command surface.

### Startup, settings, and context visibility

Provider and model resolution follows this precedence:

1. explicit CLI or application options;
2. merged workspace settings;
3. Orbit provider defaults.

Workspace settings are loaded from ancestor directories that participate in
the Orbit workspace search. Within one directory,
`.orbit/settings.json` takes precedence over `settings.json`, and deeper
workspace settings override shallower values. The loader returns only the
merged settings object, so the source of an effective value is lost.

System context loading searches for `ORBIT.md` and `AGENTS.md` in the same
workspace ancestry. It returns source paths, but the CLI joins only the text
and does not retain the source details in the running agent. The current
workspace locator only considers ancestor directories containing `.orbit`.
This may be surprising when an `AGENTS.md` exists without a matching `.orbit`
directory and must be visible in diagnostics even if the search semantics are
not changed immediately.

Add trace-returning loaders rather than logging internally:

```ts
interface ResolvedSettings {
  settings: WorkspaceSettings
  sources: SettingsSource[]
  effectiveSources: Record<string, string>
}

interface LoadedSystemContext {
  content: string
  file: string
  order: number
  size: number
}
```

The application service can then emit redacted diagnostic events and expose a
read-only runtime inspection endpoint. API keys, authorization headers, raw
environment values, and provider credentials must never appear in diagnostics.

## External application research

### Codex and the ChatGPT desktop app

OpenAI's current desktop documentation describes chats and long-running work,
file inspection, browser and desktop tool access, plugins, integrated
terminals, and Git worktrees. The integrated terminal is scoped to the current
chat or worktree, and worktrees isolate parallel chats.

The most relevant architecture is the open-source Codex App Server. It exposes
bidirectional JSON-RPC commands and notifications over JSONL stdio, WebSocket,
or a Unix socket. Its protocol includes initialization, thread list and read,
thread start and resume, turn start and steering, streamed item events,
cancellation, approvals, authentication state, and generated TypeScript and
JSON schemas.

This reinforces two Orbit design decisions:

- keep the GUI as a client of a reusable agent application service;
- separate request/response commands from asynchronous notifications.

OpenAI documents and publishes the Codex CLI, SDK, and App Server sources. The
desktop GUI framework itself is not documented as an open-source component, so
there is no reliable official basis for selecting Electron, React, or another
framework merely to match the implementation.

### Claude Code Desktop

Anthropic documents Claude Code Desktop as a graphical interface over the same
underlying engine as the CLI. Its current development interface includes:

- a sidebar for multiple sessions;
- automatic Git worktree isolation;
- rearrangeable chat, diff, preview, terminal, file, plan, task, and subagent
  panes;
- a verbose mode that exposes tool calls and intermediate activity;
- visual diff review and inline comments;
- a live application preview;
- local, SSH, and cloud environments;
- model, permission, effort, context, and plan-usage controls;
- connectors, MCP servers, skills, plugins, and hooks.

The initial Orbit design intentionally adopts only the session sidebar,
conversation pane, diagnostics visibility, model identity, and asynchronous
status ideas. The broader IDE and orchestration features remain deferred.

Anthropic's official documentation does not specify the internal desktop GUI
framework. As with Codex, feature and engine boundaries are more useful than an
unverified claim about the shell technology.

## Recommended architecture

```text
Browser or desktop renderer
  |-- REST commands and queries
  `-- server-sent diagnostic and thread events
             |
Express 5 application
             |
OrbitAppService
  |-- ThreadManager
  |-- SessionRepository
  |-- RuntimeInspector
  `-- DiagnosticEventBus
             |
Agent -> model adapters, MCP tools, session recorder
```

Express 5 is compatible with Orbit's Node.js 18 minimum. React and Vite are a
small, conventional browser layer and allow the application to be served as a
local web UI before committing to a desktop shell. A future Electron main
process can host the same local server and load its random loopback URL with
Node integration disabled.

### Transport

Use ordinary JSON HTTP endpoints for commands and queries. Use Server-Sent
Events for the initial event stream because all required live data flows from
server to client; prompts and cancellation already travel as HTTP commands.
SSE also provides event IDs and straightforward reconnection. A later app
server can add WebSocket or JSON-RPC without coupling that protocol to the
domain layer.

Suggested endpoints are:

```text
GET    /api/runtime
GET    /api/sessions
POST   /api/threads
POST   /api/threads/:threadId/resume
GET    /api/threads/:threadId
POST   /api/threads/:threadId/messages
POST   /api/runs/:runId/cancel
GET    /api/events
GET    /api/preferences
PATCH  /api/preferences
```

Validate request bodies and serialized responses with Zod at the application
boundary. Do not expose arbitrary file paths, model clients, settings objects,
or the raw `ThreadManager` over HTTP.

### Event envelope

Use a monotonically increasing process-local sequence number and a stable
versioned envelope:

```ts
interface ApplicationEvent<TType extends string, TData> {
  version: 1
  sequence: number
  timestamp: string
  level: 'debug' | 'info' | 'warn' | 'error'
  type: TType
  sessionId?: string
  threadId?: string
  runId?: string
  iteration?: number
  data: TData
}
```

The in-memory event store should be a bounded ring buffer. An SSE client can
send `Last-Event-ID` after reconnecting and receive available missed events.
Session history remains authoritative for conversation rendering; the ring
buffer is only transient diagnostic state.

Recommended event types include:

```text
app.started
settings.source.loaded
settings.resolved
context.source.loaded
context.resolved
model.selected
session.created
session.resumed
run.started
model.request.started
model.response.completed
model.response.failed
tool.started
tool.completed
mcp.server.connecting
mcp.server.connected
mcp.tools.loaded
run.completed
run.cancelled
run.failed
```

### Diagnostic capture and display

Do not use one boolean for both capture and pane visibility. Define two
settings:

```ts
type DiagnosticCapture = 'off' | 'metadata' | 'full'

interface GuiPreferences {
  debugPanelVisible: boolean
  diagnosticCapture: DiagnosticCapture
}
```

`metadata` includes counts, model names, timing, usage, source paths, and tool
names without full prompts, responses, inputs, or results. `full` includes the
redacted model-visible content. Pane visibility is a renderer preference and
can initially live in browser local storage. Capture level is a backend runtime
preference because it changes what data enters the process ring buffer.

### Security boundary

The server must bind only to a loopback address by default. It should choose an
available port, reject unexpected `Origin` headers, use a random per-process
capability token or secure same-site cookie, set strict content security
headers, and never serve workspace files through a general static-file route.

The renderer must not receive API keys, provider settings containing secrets,
process environment contents, model client objects, arbitrary stack traces, or
unredacted authorization values. Full diagnostics may still contain prompts,
source code, tool arguments, and tool results and must be described as
sensitive local data. Diagnostic persistence or export should require a
separate explicit feature.

## Three-pane interface

### Left pane

The left pane contains:

- New Chat;
- Recent sessions sorted by recency;
- session status, timestamp, provider/model, and working directory;
- the diagnostics-pane visibility control.

Session titles do not currently exist. The initial list can derive a preview
from the first user message and fall back to provider/model plus timestamp.
Titles can later become a versioned mutable session metadata entry.

### Center pane

The center pane contains:

- the selected session history;
- user and assistant messages rendered as Markdown;
- collapsible tool-call and tool-result cards;
- running, failed, and cancelled state;
- a provider/model badge;
- a bottom prompt composer with Send and Stop actions.

System context should not appear as a normal chat message. It belongs in the
runtime inspector and can be opened from a session-details control.

### Right pane

The optional diagnostics pane contains:

- filters for level, type, thread, run, provider, and model;
- formatted and raw JSON views;
- expandable model request, response, usage, stop reason, and duration;
- expandable tool input, output, error, and duration;
- startup configuration and context-source inspection;
- automatic-scroll and clear-view controls.

Clearing the view does not delete sessions or persistent logs; it only advances
the renderer's displayed sequence baseline.

## Implementation plan

### Phase 1: observability and runtime contracts

1. Add provider-neutral model response metadata.
2. Capture provider response IDs, model identity, stop reasons, token usage,
   and durations in all model adapters.
3. Add the typed diagnostic event bus, ring buffer, and Pino sink.
4. Emit exact redacted provider requests and normalized responses.
5. Add trace-returning settings and context loaders.
6. Emit startup, model selection, session, MCP, run, and tool diagnostics.

### Phase 2: GUI-safe application service

1. Add a run handle that exposes the run ID immediately.
2. Add multi-subscriber thread events.
3. Restore cwd, provider, model, and system prompt during resume.
4. Add asynchronous paginated session listing with previews and isolated
   corrupt-file errors.
5. Add runtime inspection and GUI preference services.
6. Define and validate transport DTOs.

### Phase 3: Express and React MVP

1. Add Express 5 commands and queries.
2. Add an SSE endpoint with replay from the diagnostic ring buffer.
3. Serve a production React build and use Vite in development.
4. Implement the left Recent sidebar and New Chat flow.
5. Implement conversation rendering and the prompt composer.
6. Implement the diagnostics inspector and visibility setting.
7. Add loopback security, graceful shutdown, and resource cleanup.

### Phase 4: verification and follow-up

1. Add deterministic unit tests for diagnostics, usage normalization, event
   replay, resume defaults, and application-service commands.
2. Add HTTP integration tests without live model, network, or MCP calls.
3. Add renderer component tests for session selection and event projection.
4. Run header checks, build, and the complete test suite.
5. Document startup, security, sensitive diagnostics, and development commands.

## Initial completion criteria

The initial GUI is complete when:

- New Chat creates a durable session;
- Recent lists and opens stored sessions without blocking the UI;
- a resumed session uses its recorded runtime context by default;
- the center pane sends, receives, cancels, and renders a run;
- tool requests and results are inspectable;
- the right pane shows startup decisions, settings sources, context sources,
  model requests, model responses, usage, stop reasons, timing, and errors;
- diagnostics visibility and capture level are independent;
- no credential is exposed through the API or event stream;
- shutdown closes every agent, MCP connection, and session recorder;
- the full repository validation set passes.

## Sources

- OpenAI, ChatGPT desktop app:
  <https://learn.chatgpt.com/docs/app>
- OpenAI, Codex App Server:
  <https://learn.chatgpt.com/docs/app-server>
- OpenAI, Integrated terminal:
  <https://learn.chatgpt.com/docs/integrated-terminal>
- OpenAI, Git worktrees:
  <https://learn.chatgpt.com/docs/environments/git-worktrees>
- OpenAI, Codex open-source components:
  <https://learn.chatgpt.com/docs/open-source>
- Anthropic, Claude Code Desktop:
  <https://code.claude.com/docs/en/desktop>
- Anthropic, Claude Code Desktop quickstart:
  <https://code.claude.com/docs/en/desktop-quickstart>
- Express, Express 5 installation:
  <https://expressjs.com/en/5x/starter/installing/>
