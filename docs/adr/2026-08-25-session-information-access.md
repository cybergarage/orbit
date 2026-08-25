---
status: proposed
proposed-date: 2026-08-25
decision-date: null
implementation-status: not-started
implementation-completed-date: null
implementation-commits: []
superseded-by: []
---

# User-Accessible Session Information

## Purpose

Orbit users need a supported way to retrieve the identity and diagnostic
summary of the session they are using. The immediate requirement is to obtain
the exact session ID when reporting or investigating a problem, without
searching persisted JSONL files or inferring an ID from a log path.

This decision defines a consistent read-only session-information contract for
both the CLI and GUI. It does not change session persistence, resume behavior,
or logging, and it does not implement the proposed interfaces.

## Decision

Orbit will expose one canonical, read-only session diagnostic summary through
CLI and GUI surfaces. The exact, durable `Session.id` is the primary field and
is never shortened in copied or machine-readable output.

The CLI will provide two entry points with the same field semantics:

- `/session` displays the active interactive session's diagnostic summary.
- `orbit session <SESSION_ID>` inspects an exact saved session.
- `orbit session --last` inspects the most recently updated eligible session
  for the launch working directory, and `--last --all` removes that directory
  filter. These selection rules match `orbit resume`.
- `--json` emits the canonical summary for tools, while `--id-only` emits only
  the full ID and a newline. The two output flags are mutually exclusive.

An exact ID is global and does not apply the working-directory filter. Bare
`orbit session` fails with an actionable request to pass an ID or `--last`;
it does not silently guess which session the user meant. `--all` is valid only
with `--last`. Machine-readable success data is written to stdout and
diagnostics and failures are written to stderr.

The initial human-readable and JSON summary will contain the existing
`SessionSummary` fields: `id`, `status`, `createdAt`, `updatedAt`, `cwd`,
`originator`, `provider`, `model`, `file`, and `preview` when present. For an
active session, current runtime provider and model values take precedence over
older persisted values. Human output may label or wrap values but must keep the
full ID available for terminal selection.

The GUI will expose the same information without making a UUID permanent
visual chrome:

- Add `Copy session ID` to the existing Recent-session context menu, before
  the destructive separator and `Delete session…`.
- Add `Session details…` beside that action. It opens an accessible dialog
  showing the full selectable ID, a dedicated copy button, status, timestamps,
  working directory, originator, provider, model, and transcript file.
- Make the same actions available from an overflow button in the selected
  conversation's top bar. Right-click remains a shortcut, not the only
  discoverable or keyboard-accessible route.
- Successful copying produces a short `Session ID copied` confirmation. A
  clipboard failure leaves the full ID selectable and reports an actionable
  error.

The implementation will derive all surfaces from the session currently owned
by the interactive runtime or from `SessionRepository`; it will not parse file
names or log names to reconstruct an ID. Inspection is read-only, makes no model
request, does not obtain a writer lock, and does not alter recency or session
status.

The session ID is a correlation identifier, not an authentication secret. GUI
inspection remains protected by the existing loopback, capability-token, and
origin boundaries. Orbit will not include transcript contents, prompts,
credentials, environment variables, or log payloads in the summary. Local
paths are diagnostic data and should be treated as potentially sensitive when
users copy JSON or screenshots.

## Consequences

### Positive

- Users can obtain the exact ID from either product surface without knowing
  Orbit's storage layout.
- Support reports can correlate a session with its transcript and
  session-scoped logs using an explicit, stable identifier.
- Interactive, one-shot CLI, and GUI presentation use the same fields and
  avoid divergent meanings of "session information."
- `--id-only` and `--json` support scripts without requiring clipboard tooling
  or scraping human-formatted output.
- The GUI keeps the common workspace uncluttered while making session identity
  discoverable through both pointer and keyboard-accessible controls.

### Negative

- `orbit session`, its JSON field names, and the GUI details become supported
  product contracts that require compatibility tests and documentation.
- Displaying transcript and working-directory paths can reveal local
  information when output is pasted into a public issue; documentation and UI
  copy must make that risk understandable.
- The GUI needs clipboard fallback, notification, dialog focus management, and
  menu accessibility behavior in addition to the underlying data retrieval.
- Active runtime values and persisted summary values can differ briefly, so
  the implementation must define and test which source is authoritative.

### Neutral

- This decision does not add session listing, renaming, export, resume, fork,
  deletion, or log-bundling behavior.
- It does not migrate existing flat commands into a nested `orbit session ...`
  command group. That broader CLI taxonomy remains a future decision.
- Session IDs remain UUIDv7 values generated by the persistence layer; no
  persistent format migration is required.
- The diagnostics panel may continue to display a shortened ID as a compact
  visual cue, provided copying and details always use the full value.

## Context and Problem Statement

### Verified Orbit behavior

The findings below describe Orbit at commit
`ddf9891a322c1234bced4c35e97c8b13f3ca6c58`, inspected on 2026-08-25.

`SessionRepository.create()` generates the durable session ID and records it in
the session header. `SessionSummary` already provides the ID, lifecycle status,
timestamps, working directory, originator, provider, model, transcript file,
and preview. `findById()`, `findLatest()`, and `listPage()` provide read-only
selection primitives, so no new persistence index or format is needed.

The current CLI has flat top-level commands including `resume`, `delete`,
`exec`, and `gui`. `orbit resume <SESSION_ID>` and its `--last [--all]` form
already establish exact-ID and recency-selection semantics. The
interactive TUI has a small slash-command namespace containing `/help`,
`/model`, and `/debug`, but no session-information command.

The GUI receives `SessionSummary` records from `GET /api/sessions`. Recent
session rows show preview, updated time, model, and working directory. Their
context menu contains only `Delete session…`. The selected conversation's top
bar shows title and provider/model but has no action menu. The diagnostics
panel displays only the first eight characters of the selected session ID.

Consequently, the information needed by both clients already crosses the core
and GUI boundary, but users do not have a supported way to retrieve the exact
ID. Reading `~/.orbit/sessions`, inspecting network traffic, or reconstructing
an ID from logs exposes implementation details and is not an acceptable user
workflow.

### Problem boundaries

"Session information" in this decision means a small diagnostic read model,
not the conversation transcript or a general session-management API. The
contract must work for the currently active interactive session and for a
saved session selected outside the TUI. It must also avoid confusing the
session ID with model response IDs, message IDs, run IDs, log record IDs, or
the GUI startup capability token.

## Decision Drivers

- The full session ID must be easy to retrieve for debugging and support.
- CLI and GUI must describe the same session with the same field names and
  source of truth.
- The common operation must not require knowledge of storage paths or log
  internals.
- The CLI must fit Orbit's existing slash-command and flat oclif command
  conventions.
- Shell users need output that is safe to pipe and parse.
- GUI users need a fast copy action and a discoverable way to inspect context.
- Retrieval must be read-only and must not resume, lock, update, or send the
  session to a model.
- Full UUIDs should not add persistent visual noise to the normal GUI.
- Existing loopback GUI security and local-path privacy boundaries must remain
  intact.
- The first version should reuse current persistence and summary data rather
  than create a second session registry.

## External Implementation Research

Research was performed on 2026-08-25. Source references are pinned where an
implementation repository is available.

### Codex CLI

Codex CLI `0.149.0` was inspected at source commit
`758ef40f50c1a458425c7cfbf1eb12cbc07af0b0` (tag `rust-v0.149.0`). Its
interactive `/status` command is described as showing current session
configuration and token usage. The status card includes the full session ID
alongside model, directory, permissions, and usage. Non-interactive `codex
exec` also prints the session ID in its configuration header. The top-level CLI
does not provide a dedicated saved-session information command.

Orbit should adopt the principle that an in-session diagnostic command includes
the exact ID and that non-interactive output can expose the ID without a
clipboard dependency. Orbit should not adopt the generic name `/status`:
Orbit's existing runtime, debug, and provider states make that name ambiguous,
while `/session` precisely describes this decision's boundary. Orbit also
should not put a full UUID permanently in its prompt or GUI chrome.

### Pi Coding Agent

Pi was inspected at source commit
`a79b3733421ead0dcea3cbe32247ea2464400dcb`. Its interactive `/session`
command shows the current session file, ID, message count, tokens, and cost.
Its RPC `get_state` and `get_session_stats` responses expose structured session
IDs and related metadata to integrations. Session selection remains a separate
CLI concern through `--session <path|id>`.

Orbit should adopt Pi's precise `/session` name and the separation between
inspection and session selection. Orbit should also share one structured read
model across interactive and GUI integrations. Orbit should not promise token
costs or message statistics in the initial contract because those values are
not currently part of Orbit's canonical `SessionSummary` and are unnecessary
for the debugging requirement.

### Claude Code CLI

Claude Code `2.1.197` was inspected through its installed CLI and official
documentation. Its top-level help has resume and assignment flags but no
dedicated session-information command. For programmatic use, `claude -p ...
--output-format json` includes `session_id`; official documentation demonstrates
extracting that field and passing it to `--resume`. `--session-id` assigns a
specific UUID to a conversation and is not an inspection operation.

Orbit should adopt structured output that exposes an exact ID and keep
selection separate from inspection. Orbit should not use an assignment-style
`--session-id` flag for retrieval because the same spelling would imply two
opposite operations.

### Claude App and Codex App

Claude App `1.34493.1` was inspected directly. The active session's `More
options` menu contains `Copy session ID` with other session actions such as
pin, rename, archive, and delete. The request also reports the action in a
session context menu. This validates a menu-level copy action as an established
desktop interaction, but a copy-only action does not provide the surrounding
diagnostic fields Orbit already has.

No public OpenAI Codex App documentation found during the investigation
described a corresponding copy-session-ID action. Automated inspection of the
running Codex App was unavailable because the application prevents controlling
itself, so absence of the action was not verified. The Codex App result is
therefore "not confirmed," not evidence that the feature does not exist.

Orbit should adopt Claude App's concise copy label and proximity to other
session actions. It should additionally offer `Session details…` and a visible
overflow control so the function is not dependent on discovering right-click.

### Comparison

| Surface              | Verified retrieval behavior                                                          | Relevant Orbit lesson                                                |
| -------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Codex CLI 0.149.0    | `/status` and `codex exec` expose the full session ID                                | Include identity in active and non-interactive diagnostics           |
| Pi at `a79b373`      | `/session` and RPC state/stats expose ID and metadata                                | Use `/session` and a shared structured read model                    |
| Claude Code 2.1.197  | JSON print output contains `session_id`; no dedicated info command in top-level help | Provide parseable output without overloading assignment flags        |
| Claude App 1.34493.1 | `Copy session ID` is present in the active session menu                              | Put a direct copy action with other session actions                  |
| Codex App            | No public documentation found; UI absence not verified                               | Do not infer a product contract from an inconclusive negative search |

## Considered Options

### Option 1: Shared summary with `/session`, `orbit session`, copy, and details

This is the proposed option. It treats identity retrieval as one read-only
capability with presentation appropriate to each surface. It supports the
active TUI, saved-session shell workflows, a one-click GUI path, and richer
inspection without introducing another persistence model.

### Option 2: Expose only `Copy session ID`

This is the smallest GUI change and directly follows Claude App. In a terminal,
however, a platform-specific clipboard operation is less portable than
selectable or pipeable output. Copy alone also omits the provider, model,
working directory, timestamps, and transcript location needed to verify that
the user selected the intended session. This option is rejected as too narrow
for the stated session-information purpose.

### Option 3: Always display the full ID in the prompt, sidebar, and top bar

This makes identity visible without a command or menu. A UUID is low-value
visual noise during normal work, is difficult to scan, and can displace the
session title and model information. It also does not solve structured shell
retrieval. This option is rejected; compact prefixes may remain diagnostic
cues, while explicit actions expose the full value.

### Option 4: Add `orbit status` and `/status`

Codex demonstrates this broader command. Orbit already distinguishes model
selection, debug logging, session persistence, runtime health, and GUI server
state, so `status` would need a larger and less stable contract. This option is
rejected in favor of the precise `session` term used by Pi and the domain being
inspected.

### Option 5: Introduce a nested `orbit session show|list|delete` command group

A command group could become appropriate if Orbit consolidates all session
management. Today the public grammar uses flat `resume` and `delete` verbs, and
the request adds one inspection operation rather than a complete taxonomy
migration. Moving existing commands would create aliases, deprecation policy,
documentation changes, and compatibility questions unrelated to ID retrieval.
This option is deferred. The singular `orbit session` command preserves room
for a later, separately decided migration.

### Option 6: Document how to find the ID in session or log files

This requires users to understand private directory layout and file naming,
does not work naturally in the GUI, and couples support instructions to storage
implementation details. It may also encourage users to share full transcripts
or logs when only an identifier is needed. This option is rejected.

## Implementation and Confirmation

No implementation is authorized by this proposed ADR. Its implementation
status remains `not-started`.

When this decision is accepted, implementation should proceed through the
existing boundaries:

1. Define or extract a core formatter/projection whose minimum fields match
   `SessionSummary`, with an active-runtime override for current provider and
   model.
2. Add `/session` to the interactive command registry without persisting the
   local response or sending it to the model.
3. Add a public, non-TTY `orbit session` oclif command with exact-ID,
   `--last`, `--all`, `--json`, and `--id-only` validation consistent with
   `resume`.
4. Add GUI copy and detail actions to both the Recent-session context menu and
   selected-conversation overflow menu, reusing the existing authenticated
   session data or a narrowly scoped read endpoint if freshness requires it.
5. Update maintained CLI, interactive, GUI, and session documentation; update
   generated oclif documentation through the repository's documented command.

Confirmation must include deterministic tests for:

- exact active and saved session IDs, including a resumed session;
- active provider/model precedence over persisted values;
- exact ID, `--last`, and `--last --all` selection parity with `resume`;
- human, JSON, and ID-only stdout, including mutually exclusive flags and
  stable error output;
- no writer lock, status update, recency update, transcript mutation, or model
  call during inspection;
- context-menu and overflow-menu availability for the selected session;
- full-ID clipboard content, success and failure feedback, selectable fallback,
  dialog focus, Escape, and keyboard operation;
- preservation of the GUI capability-token and origin checks; and
- absence of transcript content, credentials, environment values, and log
  payloads from the summary.

After implementation is committed and validated with the repository's full
validation set, a later ADR-only commit must record the full implementation
commit hashes, completion date, confirmation evidence, and updated
implementation status.

## Follow-up Work

- Decide separately whether multiple session operations justify a nested
  `orbit session ...` command group and how flat-command compatibility would be
  preserved.
- Consider opt-in support-bundle export only if ID plus existing logs is
  insufficient; such a feature requires a separate privacy and redaction
  decision.
- Consider message counts, token usage, cost, and context utilization only
  after Orbit has canonical accounting for them. They must not be approximated
  differently by CLI and GUI.
- Consider a user-visible session name independently from durable identity;
  names must never replace the exact ID in diagnostic or machine output.
- Re-check the Codex App UI manually before implementation if product parity is
  still a decision driver; this ADR intentionally records the current result as
  inconclusive.

## References

### Orbit

- Orbit repository baseline
  [`ddf9891a322c1234bced4c35e97c8b13f3ca6c58`](https://github.com/cybergarage/orbit/commit/ddf9891a322c1234bced4c35e97c8b13f3ca6c58),
  inspected 2026-08-25.
- [`src/core/session/repository.ts`](../../src/core/session/repository.ts),
  `SessionSummary`, `findById()`, `findLatest()`, and `listPage()`.
- [`src/core/session/session.ts`](../../src/core/session/session.ts), durable
  session identity and metadata.
- [`src/core/interactive.tsx`](../../src/core/interactive.tsx), interactive
  state and slash-command handling.
- [`src/apps/cli/resume.ts`](../../src/apps/cli/resume.ts), exact-ID and
  latest-session CLI selection.
- [`src/apps/gui/client.tsx`](../../src/apps/gui/client.tsx), Recent-session
  list, context menu, selected-conversation top bar, and diagnostic ID prefix.
- [`src/apps/gui/server.ts`](../../src/apps/gui/server.ts), authenticated GUI
  session routes.
- [Session Resume Behavior and CLI Design](2026-08-23-session-resume-cli.md).
- [GUI Application Architecture](2026-08-22-gui-application.md).
- [Session-scoped Logging Architecture](2026-08-25-session-scoped-logging.md).

### External implementations

- OpenAI Codex source at
  [`758ef40f50c1a458425c7cfbf1eb12cbc07af0b0`](https://github.com/openai/codex/tree/758ef40f50c1a458425c7cfbf1eb12cbc07af0b0),
  inspected 2026-08-25:
  [`codex-rs/tui/src/slash_command.rs`](https://github.com/openai/codex/blob/758ef40f50c1a458425c7cfbf1eb12cbc07af0b0/codex-rs/tui/src/slash_command.rs),
  [`codex-rs/tui/src/status/card.rs`](https://github.com/openai/codex/blob/758ef40f50c1a458425c7cfbf1eb12cbc07af0b0/codex-rs/tui/src/status/card.rs),
  and
  [`codex-rs/exec/src/event_processor_with_human_output.rs`](https://github.com/openai/codex/blob/758ef40f50c1a458425c7cfbf1eb12cbc07af0b0/codex-rs/exec/src/event_processor_with_human_output.rs).
- Pi Coding Agent source at
  [`a79b3733421ead0dcea3cbe32247ea2464400dcb`](https://github.com/earendil-works/pi/tree/a79b3733421ead0dcea3cbe32247ea2464400dcb),
  inspected 2026-08-25:
  [`packages/coding-agent/docs/usage.md`](https://github.com/earendil-works/pi/blob/a79b3733421ead0dcea3cbe32247ea2464400dcb/packages/coding-agent/docs/usage.md)
  and
  [`packages/coding-agent/docs/rpc.md`](https://github.com/earendil-works/pi/blob/a79b3733421ead0dcea3cbe32247ea2464400dcb/packages/coding-agent/docs/rpc.md).
- Anthropic,
  [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference),
  `--resume`, `--session-id`, and `--output-format`, accessed 2026-08-25.
- Anthropic,
  [Run Claude Code programmatically](https://code.claude.com/docs/en/headless),
  JSON session-ID extraction and resume example, accessed 2026-08-25.
- Claude App `1.34493.1`, active-session `More options` menu, inspected
  2026-08-25.
