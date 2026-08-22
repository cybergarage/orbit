# Local GUI

Orbit includes a local web interface for inspecting and running durable agent
sessions. The initial interface deliberately excludes project management and
focuses on three areas:

- a left sidebar with **New Chat** and sessions from `~/.orbit/sessions/`;
- a center conversation pane with message history, a prompt composer, and run
  cancellation;
- an optional diagnostics pane with startup, model, tool, MCP, session, and run
  events.

## Start the GUI

Build Orbit and start the compiled command:

```sh
npm run build
./bin/run.js gui
```

Orbit prints a loopback URL containing a random capability token. Open that
exact URL in a browser. An available port is selected automatically; use a
fixed loopback port when needed:

```sh
./bin/run.js gui --port 4100
```

The GUI uses the same `--provider`, `--model`, provider credential-environment,
Ollama host, and `--debug` flags as other agent commands. Explicit command
options override workspace settings, which override provider defaults.

Press Ctrl+C in the starting terminal to stop the server. Shutdown cancels
active runs and closes agents, MCP clients, and session recorders.

## Sessions and runs

New Chat immediately creates a durable JSONL session under
`~/.orbit/sessions/`. Recent sessions are listed newest first. Selecting one
resumes its stored working directory, provider, model, system prompt, and
conversation unless the caller explicitly supplies an override through the
application API.

Only one run can be active in a session. The square Stop button cancels the
current run. Model responses are currently displayed after completion; token
streaming is not part of the initial implementation.

Inputs beginning with `/` are intercepted before model execution. They are
excluded from the durable session and model conversation and are emitted as
`command.submitted` structured log events. The event also appears in the
diagnostics pane while diagnostic capture is enabled. Command input and output
remain visible in the current GUI conversation without being persisted. Use
`/help` to list the GUI commands.

If one session file is corrupt or unreadable, the rest of the Recent list
continues to load. The session listing API reports the individual file error
without failing the entire page.

## Diagnostics

The diagnostics pane can be shown or hidden from the sidebar. Visibility does
not change collection. Select a capture level in the diagnostics header:

- **Full** records metadata plus request payloads, response payloads, context
  text, tool inputs, and tool outputs in the in-memory event buffer.
- **Metadata** records event identities, timing, model and provider details,
  usage, stop reasons, sizes, and errors without full payloads.
- **Off** stops collecting new diagnostic events.

Full capture is the GUI default because the interface is intended for local
development and model/tool debugging. It can contain prompts, source context,
model output, and tool data. Do not share screenshots or copied events without
reviewing them. Credential values, authorization headers, API keys, and MCP
environment values are not included in the settings and startup summaries.

The pane receives typed events through Server-Sent Events and can replay the
bounded in-memory buffer after reconnecting. Diagnostics are separate from the
durable session transcript: turning capture off does not disable normal session
persistence, and hiding the pane does not delete either sessions or events.
The same typed events are forwarded through the configured `Logger`; use
`--debug` when debug-level diagnostic records should also be written to the
terminal log destination.

## Startup inspection

The initial event stream and runtime endpoint expose:

- the Orbit version, process working directory, provider, and model;
- the session storage directory;
- each loaded settings file and the provider/MCP names it contributed;
- each loaded `ORBIT.md` or `AGENTS.md` context source and its size;
- model requests, normalized response metadata, token usage, stop reason, and
  wall-clock duration;
- tool and MCP lifecycle details, including input/output when Full capture is
  enabled.

Context discovery follows Orbit's existing workspace rules. In particular,
ancestor traversal currently depends on an Orbit workspace marker. The runtime
view reports what was actually loaded so this behavior is visible during
debugging.

## Local security boundary

The Express server listens only on a loopback address and refuses non-loopback
hosts. Every HTML, JavaScript, REST, and event-stream request requires the
random capability token printed at startup. The server also applies a strict
Content Security Policy, origin checks, JSON size limits, and schema validation
for request bodies.

Treat the printed URL as a temporary local secret. Do not forward the port,
publish the URL, or paste the token into issue reports. The initial GUI has no
remote-access or multi-user mode.

## Current scope

The initial GUI provides session browsing, completed-message rendering, prompt
submission, cancellation, tool detail cards, response metadata, and diagnostics.
Project/worktree management, diff review, terminal panes, approvals, attachments,
and token-delta streaming are follow-up features rather than part of this release.
