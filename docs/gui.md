# Local GUI

Orbit includes a local web interface for inspecting and running durable agent
sessions. The interface has three areas:

- a left sidebar with **New Chat**, a **Project** tree, and **Recent** sessions;
- a center conversation pane with message history, a prompt composer, and run
  cancellation;
- an optional log pane scoped to the selected session.

Project-enabled hosts group separate conversations through core catalog APIs.
See [Projects](projects.md) for navigation, archive, movement, runtime resolution
and the unchanged CLI scope.

## Start the GUI

Build Orbit and start the compiled command:

```sh
npm run build
./bin/run.js gui
```

`orbit gui` checks session storage before opening the server. Unregistered storage
prompts for confirmed offline initialization in a terminal; see
[storage startup](session-storage.md#interactive-startup) for prerequisites and
non-interactive behavior.

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
active runs and closes agents, MCP clients, session recorders, and log writers.

## Sessions and runs

New Chat immediately creates a durable JSONL session under
`~/.orbit/sessions/`. The top-level action creates an unassigned session.
Recent lists unassigned sessions newest first; project conversations appear
under their Project. Hosts without a project catalog list all sessions in Recent. Selecting one
resumes its stored working directory, provider, model, system prompt, and
conversation unless the caller explicitly supplies an override through the
application API.

Right-click a session and choose **Delete session…** to permanently
remove it after confirmation. Deleting the selected session clears the
conversation and log pane. Active or quarantined sessions cannot be deleted. Orbit acknowledges a minimal
deletion marker, removes logs, transcript and journal/key, then retains a
completed marker to prevent reuse of the session ID. Partial deletion can be
retried. See [Managed Execution](execution.md#recording-and-recovery).

The same context menu provides **Copy session ID**, **Session details…**, and,
on project-enabled hosts, **Move to project…**. Each sidebar row exposes its
actions through a **…** button on hover or keyboard focus.
The selected conversation's top-bar **Session actions** button exposes the same
commands for keyboard and pointer users without requiring right-click.
**Copy session ID** writes the complete durable ID to the clipboard and confirms
success. If clipboard access fails, Orbit opens the details dialog so the full
selectable ID can be copied manually.

The details dialog shows status, creation and update times, working directory,
originator, current provider and model, and transcript file. The UUID is not
shown permanently in the sidebar or conversation header; the diagnostics pane
may continue to use its first eight characters as a compact visual cue. Local
paths can disclose private workspace information, so review the dialog before
sharing screenshots or copied details.

Only one run can be active in a session. While a run is active, the conversation
shows whether Orbit is sending, thinking, using a tool, working, or stopping.
The composer remains available as an explicitly labeled draft for the next
message; Enter inserts a line break while the draft cannot yet be sent. The
square Stop button cancels the current run and becomes unavailable while the
stop request is being processed. Cancellation and background failures are shown
in the conversation. Model responses are currently displayed after completion;
token streaming is not part of the initial implementation.

Inputs beginning with `/` are intercepted before model execution. They are
excluded from the durable session and model conversation and are emitted as
`command.submitted` structured log events. The event also appears in the log
pane while diagnostic capture is enabled. Metadata capture persists only the
command name and input/output lengths. Full capture can persist the command and
response for up to 15 minutes. Both remain visible in the current GUI
conversation without entering the durable session transcript. Use `/help` to
list the GUI commands.

If one session file is corrupt or unreadable, the rest of the Recent list
continues to load. The session listing API reports the individual file error
without failing the entire page.

## Session logs and diagnostics

The log pane can be shown or hidden from the sidebar. It loads a bounded
backfill from the active and rotated JSONL segments under
`~/.orbit/logs/<session-id>/` and then receives live records through
Server-Sent Events. Selecting another session clears the prior records, and
records from other sessions are ignored. The pane filters by level and typed
category. Visibility does not change collection.

The capture selector is global and controls which diagnostic events are
adapted into session logs:

- **Full** records metadata plus request payloads, response payloads, context
  text, tool inputs, and tool outputs for at most 15 minutes before returning to
  Metadata automatically.
- **Metadata** records event identities, timing, model and provider details,
  usage, stop reasons, sizes, and errors without full payloads.
- **Off** stops collecting new diagnostic events.

Metadata capture is the default. Full capture is intended for explicit local
model/tool debugging because it can contain prompts, source context, model
output, and tool data. Do not share screenshots, copied records, or log files
without reviewing them. Credential values, authorization headers, API keys, and
MCP environment values are not included in settings and startup summaries.
Common credential fields and token-shaped string values are redacted before
file and live-log delivery, and oversized values are truncated.

Diagnostics are separate from the durable session transcript: turning capture
off does not disable normal session persistence, and hiding the pane does not
delete sessions or log files. The same typed events are forwarded through the
session-bound `Logger`; use `--debug` when debug-level records should also be
written to the session log. Version 2 records expose stable event type,
category, outcome, duration, usage, and nested correlation fields. Per-session
logs are independently bounded by byte, record-count, and age limits.

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

The initial GUI provides session browsing, identity copying, diagnostic detail
inspection, deletion, completed-message rendering, prompt submission,
cancellation, tool detail cards, response metadata, and selected-session logs.
Project/worktree management, diff review, terminal panes, attachments,
and token-delta streaming are follow-up features rather than part of this release.

## Operation confirmation

Each pending operation displays its bound preview and Approve/Deny controls.
Replies use the startup capability and the pending request ID/digest. Repeating
the same decision is idempotent; an opposite, stale or wrong-run decision fails.
The composer retains a request ID across uncertain HTTP replies and refreshes
snapshots on reconnect. Run banners distinguish completed, cancelled, failed,
budget-exceeded and incomplete results, including recording failure. Stop asks
core to stop; it does not announce that external work has terminated.

## Project memory

The core Project service groups independent conversations; the GUI exposes
curated notes, source excerpts, selection and preview. Memory is captured once
per managed Run as journal-v3 evidence and inserted as a fixed user-role prefix.
It is not appended to canonical history or included in compaction source text.
The prepared-request budget still includes it. Library callers opt in explicitly;
GUI Project conversations default to curated mode and offer Off. CLI workflows
remain single-session. See [Projects and curated memory](projects.md) for API,
source validation, compatibility and retained-history behavior.

## Run limits and continuation

Open **Limits for the next run** below the conversation to change tool rounds,
model calls, tool requests or elapsed minutes. Settings apply to the next Send or
Continue action, including per-workspace defaults. They cannot alter active work.

After a budget stop, Orbit explains the exhausted limit and shows
**Continue with these limits**. Optionally type additional guidance before using
it. This starts a new Run in the same conversation; it does not replay the last
tool. The previous result stays unchanged. Saved budget-stop status is restored
when reopening a session after a server restart.

`Recording: acknowledged` means storage acknowledgement, not task completion.
Unknown work, failed recording or unverifiable old history can prevent continuation.
Orbit displays the reason; retain the old conversation and inspect logs or start a
new chat with your task and known progress. See [execution recovery](execution.md#continue-after-a-budget-stop).
