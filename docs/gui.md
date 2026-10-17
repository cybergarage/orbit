# Local GUI

Orbit includes a local web interface for inspecting and running durable agent
sessions. The interface has three columns: a 64px Home/Scheduled/Settings navigation rail,
a 280px context list, and the selected workspace. Settings stays at the bottom
of the rail. On compact windows the context list opens as a dismissible drawer.
Home retains the existing conversation, project menus, send/stop and individual
operation approvals. The **Logs** icon button opens one shared right panel with **Conversation**
(session information, model and Project context), **Run settings** (next-run limits
and Skills, with recorded settings kept separate), and **Logs**. It docks beside
the conversation on wide windows and overlays it on compact windows. Project
conversations are indented; user messages appear on the right and Orbit replies
on the left. The header shows the selected conversation and its Project with
compact type. It shares the conversation background, with a subtle divider and
transparent Logs/menu icons that highlight on hover or expansion. Scoped
header/surface/Logs colors follow the system light/dark preference; this is not an
application-wide dark theme. User messages remain distinct from the dark surface.
The Logs pane uses compact section headings, muted metadata, wrapping monospace
records and separate bounded scrolling for long log entries. Conversation
information, budgets, Skills and Project memory are retained. The Logs icon has
the accessible name and tooltip “Logs”; the panel retains conversation details
and run settings alongside diagnostic logs.
Approval, error, limit and reconnection states remain visible when Logs is closed.
Settings exposes diagnostic capture controls, runtime information and
[Initialization](initialization.md). Provider and credential values are not shown;
initialization removes only explicitly selected settings files.

Message history and logs scroll independently within the window, including
after reopening a session with a long saved history. The log list does not push
the prompt composer below the window.

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

Use `--metrics-port 4101` to start a separate loopback Prometheus endpoint.
It is disabled by default and exposes aggregate operational metrics, not
session content. See [Prometheus metrics](metrics.md) for the metric contract.

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
shown permanently in the sidebar or conversation header. Local
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

Open **Logs** and its diagnostic log section to inspect logs. Settings controls diagnostic display.
The log list loads a bounded
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

Each pending operation opens a centered **Confirm one operation** dialog showing
its operation and target, full bound preview, expiry, **Deny** and **Approve once**.
Background clicks never approve. **Close** or Escape dismisses the dialog while
leaving approval pending; **Review operation** reopens it. Focus stays within the
open dialog and returns to the pending-operation action on dismissal. Decisions
are disabled while submitting or after expiry. Closing Logs also never grants
approval.
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

Open **Logs → Run settings → Limits for the next run** to change tool rounds,
model calls, tool requests or elapsed minutes. Settings apply to the next Send or
Continue action, including per-workspace defaults. Each aggregate field defaults
to **Unlimited**; select **Limited** to enter a numeric ceiling. They cannot alter active work.

After a budget stop, Orbit explains the exhausted limit and shows
**Continue with these limits**. Optionally type additional guidance before using
it. This starts a new Run in the same conversation; it does not replay the last
tool. The previous result stays unchanged. Saved budget-stop status is restored
when reopening a session after a server restart.

`Recording: acknowledged` means storage acknowledgement, not task completion.
Unknown work, failed recording or unverifiable old history can prevent continuation.
Orbit displays the reason; retain the old conversation and inspect logs or start a
new chat with your task and known progress. See [execution recovery](execution.md#continue-after-a-budget-stop).

## Local scheduled tasks

Scheduled supports one-shot UTC timestamps and fixed intervals of at least one
second. Task creation requires an absolute, existing workspace, bounded name and
instructions, schema version 1 and the explicit `workspace-read` permission.
No calendar or cron recurrence is supported. Creation replay keys are persisted
atomically with the schedule and reject conflicting retries.

The GUI host saves tasks by default, with dispatch disabled. Explicitly start
`orbit gui --scheduled-work` to opt into dispatch for that process. No daemon,
login item or Docker container is installed. Exit, sleep and poweroff stop work;
missed fixed intervals coalesce on restart. The interface keeps these process
conditions in its local scheduling help.

The local adapter uses [DurableWorkStore](scheduled-work.md), owns one execution
at a time, and caps saved tasks at 100 with the store's 16 MiB history bound.
A dedicated managed Agent retains its actual session and operation journal,
allows only read/list/glob/grep within the selected workspace, denies other
effects, and never starts inherited MCP servers or approves operations. Model
execution uses the host's configured provider/model and the selected workspace's
provider settings; task instructions cannot expand permissions. Runs are bounded
to two minutes, 12 model calls, 12 tool rounds and 64 tool requests.

Pause affects future occurrences; queued and active work are unaffected.
Cancel durably records the request before signalling cooperative stop of one
occurrence, and remains pending until the owning executor settles. A restart
retains that cancellation even if the read attempt was interrupted. Uncertain outcomes stop further dispatch and never
replay automatically. Reconciliation requires explicit confirmation that external
execution stopped plus evidence, and closes the occurrence as failed. It does
not assert success. Interrupted read attempts can resume after a process restart
using their stable request identity.

State lives in the `gui-scheduled` directory beside session storage. Corrupt or
unsupported saved payloads/effects/approval grants fail closed. This host does
not support scheduled write/command/send actions or unattended blanket approvals.

## Synthetic GUI regression checks

After building, `node e2e/gui-details.e2e.mjs` verifies the shared Logs panel,
compact layouts, approval dismissal and decisions, expiry, Rename and resume
using a temporary repository and an injected model. It reads no real user history.
Install the Playwright dependency under `e2e/coding-workflows/browser` first, or
set `ORBIT_PLAYWRIGHT_MODULE` to an existing Playwright ES module. Optional
`ORBIT_CHROMIUM_PATH` selects an existing browser and `ORBIT_GUI_EVIDENCE` selects
the screenshot/result directory (default `/tmp/orbit-gui-details-evidence`).
