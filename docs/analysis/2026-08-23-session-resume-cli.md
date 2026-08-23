# Session Resume Behavior and CLI Design

## Purpose

This document verifies how Orbit currently chooses a session in the GUI,
compares the documented session-resume contracts of the Codex and Claude Code
CLIs, and proposes an implementation contract for resuming Orbit interactive
sessions by recency or session ID.

The repository findings describe the implementation as of 2026-08-23. The
Orbit CLI sections are a proposal, not an implemented feature.

## Executive conclusion

Orbit's GUI treats the thread held in the renderer's `thread` state as the
current session. Creating a chat or selecting a saved session replaces that
state, and subsequent input is sent to that thread ID. This is a client-local,
in-memory selection, not a process-wide current-session concept.

The GUI does **not** currently restore the most recent session, or even the
last-selected session, when it starts or when the page is reloaded. Startup
loads the session list but leaves the current thread unset until the user
creates or selects one.

Codex and Claude Code also make resumption explicit rather than silently
resuming the latest session on an ordinary launch:

- Codex uses `codex resume --last` for the latest session and
  `codex resume <SESSION_ID>` for an exact session. `codex resume` without a
  target opens a picker.
- Claude Code uses `claude --continue` for the latest session in the current
  directory and `claude --resume <SESSION_ID>` for an exact session.
  `claude --resume` without a target opens a picker.

Orbit should follow its existing oclif command structure and Codex's command
shape:

```sh
orbit resume --last
orbit resume <SESSION_ID>
orbit resume --last --all
```

Plain `orbit` should continue to create a new session. The first release should
reserve bare `orbit resume` for a future picker and report a useful error until
that picker exists.

## Verified Orbit behavior

### The GUI's current session is renderer-local state

`src/apps/gui/client.tsx` initializes `thread` as `undefined`. The startup
effect fetches runtime information, preferences, and the saved-session list,
but it does not create or resume a thread.

The following actions set the effective current session:

- **New Chat** posts to `/api/threads` and assigns the returned snapshot to
  `thread`.
- Selecting a recent session posts to `/api/sessions/:id/resume` and assigns
  the returned snapshot to `thread`.
- The composer posts new messages to `/api/threads/${thread.id}/messages`.
- The sidebar's active style compares each saved session ID with `thread.id`.
- Deleting the selected session clears `thread` and the active run ID.

`selectedThreadId` is a ref derived from `thread.id`. It is used only to decide
which visible thread to refresh when diagnostic events arrive; it is not
durable current-session storage.

The backend can keep multiple resumed threads in `ThreadManager`. If a GUI
client selects a thread that is already loaded, `OrbitApplicationService`
returns that loaded snapshot. There is still no single backend "current"
thread: each page chooses which thread ID it displays and addresses. Different
pages could therefore select different current threads.

Consequences:

- closing or reloading the page loses the selection;
- restarting `orbit gui` loses the selection;
- the saved session is not lost, only the client's pointer to it;
- automatic latest-session resume is not currently implemented.

### The CLI creates a new persistent session

With a TTY and no explicit command, `bin/args.js` routes Orbit to the hidden
`_interactive` command. `runInteractiveCommand()` resolves settings and system
contexts from `process.cwd()` and calls `runInteractiveSession()` without an
existing session. The interactive runner consequently creates a new session
with originator `orbit-interactive`.

The reusable interactive API already accepts both `session` and
`sessionRepository`, so it has most of the injection point needed by a resume
command. It is not yet sufficient for a complete CLI feature:

- `createInitialInteractiveState()` always starts its visible messages and
  conversation messages as empty arrays, even when an existing session is
  supplied. The agent can use the persisted history, but the TUI will not show
  that history.
- `runInteractiveSession()` closes only a session it created itself. A resume
  command that opens a session must close it in its own `finally` block.
- workspace settings and system contexts are currently loaded before any
  persisted session is selected, always using the launch directory.

### The persistence layer can locate and open sessions

`SessionRepository` already provides the core primitives:

- `findById()` scans all session pages for an exact ID;
- `listPage()` sorts summaries by `updatedAt` descending;
- summaries include `cwd`, `originator`, provider, model, and file path;
- `open()` validates and hydrates a writable session while preserving message
  IDs, timestamps, payloads, parents, and lifecycle entries;
- `ThreadManager.resumeThread()` restores persisted cwd, model, provider,
  system prompt, and message history for GUI threads.

There is no repository operation that atomically expresses "latest session in
this directory." `list()` is unsuitable because it sorts by `createdAt`, while
resume recency should mean the latest activity (`updatedAt`). Fetching one
page and filtering it in the command is also incorrect: a heavily used session
from the requested directory could fall beyond the first global page.

### Concurrent writers are a release blocker

`SessionRecorder` prevents the same resolved file from being opened twice only
inside one process. It has no cross-process lock. The GUI and CLI are separate
processes, so resuming the same JSONL session in both can create concurrent
writers and corrupt ordering or data.

General CLI resume support should not ship until opening a session obtains a
cross-process single-writer lock or otherwise fails closed. If a GUI owns a
session, `orbit resume` must fail with an actionable message rather than append
concurrently.

## Reference CLI contracts

### Codex CLI

The documented interactive command is:

```text
codex resume [OPTIONS] [SESSION_ID] [PROMPT]
```

Relevant behavior:

- `codex resume` opens a session picker.
- `codex resume --last` resumes the most recent eligible session without a
  picker.
- latest-session selection is scoped to the current working directory by
  default; `--all` disables that filter.
- `codex resume <SESSION_ID>` accepts a session UUID or saved session name.
- `--include-non-interactive` includes sessions created by non-interactive
  commands in selection.
- if the saved and launch directories differ, Codex can ask which directory to
  use; configuration and an explicit `-C` can control the decision.
- `codex exec resume` provides corresponding resume behavior for
  non-interactive execution.

The important design signals for Orbit are an explicit `resume` command,
current-directory scoping for `--last`, a separate global scope switch, and a
clear distinction between latest selection and exact identity.

### Claude Code CLI

Claude Code uses launch flags rather than a resume subcommand:

```text
claude --continue
claude --resume
claude --resume <SESSION_ID_OR_NAME>
```

Relevant behavior:

- `--continue` (`-c`) resumes the most recent interactive session in the
  current directory.
- `--resume` (`-r`) without a value opens a picker.
- `--resume <value>` resumes an exact session ID or a named session.
- direct ID lookup searches the current project and its worktrees first, then
  other projects, and requires an exact unique match.
- programmatic sessions are omitted from the picker and `--continue`, but are
  still resumable by ID.
- `--fork-session` creates a new session ID instead of continuing to append to
  the resumed session.
- the separate `--session-id <uuid>` option assigns an ID to a conversation; it
  is not the resume operation.

The important design signals for Orbit are the concise latest-session path,
project-local default scope, exact-ID escape hatch, and separation of resume
from fork.

### Comparison

| Operation                          | Codex                 | Claude Code                      | Orbit today            | Proposed Orbit                 |
| ---------------------------------- | --------------------- | -------------------------------- | ---------------------- | ------------------------------ |
| Start a new interactive session    | `codex`               | `claude`                         | `orbit`                | unchanged                      |
| Resume latest in current directory | `codex resume --last` | `claude --continue`              | unavailable            | `orbit resume --last`          |
| Resume exact session               | `codex resume <ID>`   | `claude --resume <ID>`           | library/GUI only       | `orbit resume <ID>`            |
| Choose from a picker               | `codex resume`        | `claude --resume`                | GUI recent list only   | future `orbit resume`          |
| Search outside current directory   | `--all`               | picker/global search or exact ID | GUI lists global store | `--last --all`; IDs are global |
| Fork instead of append             | separate fork support | `--fork-session`                 | unavailable            | future command/flag            |

Neither reference tool makes an ordinary launch equivalent to "resume latest."
Orbit should preserve the same new-versus-resume distinction.

## Proposed Orbit CLI contract

### Command grammar

The initial command should be a public oclif command:

```text
orbit resume [SESSION_ID] [--last] [--all] [agent flags]
```

Supported invocations:

```sh
# Resume the most recently updated session whose saved cwd is the launch cwd.
orbit resume --last

# Resume by exact ID, independent of the launch cwd.
orbit resume 0198f4d2-...

# Resume the most recently updated Orbit interactive session across all cwd values.
orbit resume --last --all
```

Validation rules:

- exactly one of `SESSION_ID` and `--last` is required in version 1;
- `--all` requires `--last`;
- an unknown ID is an error and must not create a new session;
- no eligible latest session is an error and must not create a new session;
- partial ID matching should not be added implicitly;
- bare `orbit resume` should explain the two supported forms and remain
  available for a future picker;
- `orbit --continue` and a `continue` alias should be deferred. `resume` fits
  Orbit's existing top-level verb commands and does not require special changes
  to the default-command argument normalizer.

Orbit has no persisted session names or titles today, so version 1 should
accept only exact IDs. Human-readable names can be added after the session
format has a durable naming operation and collision policy.

### Latest-session eligibility

`--last` should select by greatest `updatedAt`, not `createdAt`.

Default eligibility should be:

1. the summary's normalized saved `cwd` exactly equals normalized
   `process.cwd()`;
2. the session is a durable interactive conversation created by
   `orbit-interactive` or `orbit-thread-manager`;
3. the transcript has a valid, supported format.

Including both current originators permits continuity between Orbit's CLI and
GUI. This is useful because both surfaces use the same provider-neutral session
format. If product policy later wants surface isolation, it should be an
explicit filter rather than an accidental consequence of implementation.

`--all` removes only the cwd filter. Exact ID lookup is already global and does
not need `--all`.

Lock availability must not affect which session is considered latest. Orbit
should select the latest eligible identity first, then either acquire its lock
or report that this specific session is already open. Silently skipping a
locked latest session would resume unexpected history.

The repository should own this query, for example:

```ts
interface FindLatestSessionOptions {
  cwd?: string
  originators?: string[]
}

findLatest(options: FindLatestSessionOptions): Promise<SessionSummary | undefined>
```

This avoids pagination bugs and makes the sorting/filtering contract reusable
by GUI startup policies or future pickers.

### Working directory and configuration

Version 1 should run the resumed conversation in the session's saved `cwd`.
This matches `ThreadManager.resumeThread()` and avoids silently mixing a saved
conversation with settings and project instructions from an unrelated launch
directory.

The command must therefore select the session before resolving workspace
configuration:

1. parse and validate the resume target;
2. find the session summary;
3. choose the effective cwd (saved cwd in version 1);
4. load workspace settings and system contexts for that cwd;
5. open and lock the session;
6. resolve provider and model precedence;
7. start the interactive renderer with the hydrated session;
8. close the session in `finally`.

A later release can add a Codex-like choice or explicit option such as
`--cwd=session|current`. It should not guess based on whether the two paths
differ.

### Provider, model, and system-context precedence

The proposed precedence is:

1. explicit CLI provider/model flags;
2. provider/model stored in the session header;
3. effective workspace settings and Orbit defaults.

The persisted system prompt should be reused by default so the resumed
conversation retains the context under which it began. Workspace settings
still need to be loaded for credentials, MCP configuration, and current
runtime options. Replacing the stored system prompt with newly discovered
context should require an explicit future policy because it changes the model
contract mid-session.

This resolution should live in a shared core helper rather than being copied
between `_interactive`, `resume`, and GUI code.

### Interactive history hydration

The resumed TUI should display the persisted user and assistant conversation
immediately. `createInitialInteractiveState()` should initialize both
`conversationMessages` and the visible model-message list from
`session.getConversationMessages()` when a session is supplied.

Local slash-command notices must remain excluded because they are not durable
model conversation. Tool-call and tool-result display policy can remain as it
is today, but the canonical conversation passed to the agent must always come
from the session rather than a second reconstructed history.

### Ownership and failure behavior

The resume command opens the session and therefore owns it. It must close the
session in a `finally` block after the interactive renderer exits or fails.
`runInteractiveSession()` should retain its existing ownership rule for
callers that inject a session.

Expected errors should identify the target and corrective action:

- no saved session for the current directory;
- unknown session ID;
- invalid option combination;
- corrupt or unsupported transcript;
- saved working directory no longer exists;
- session is already open by another Orbit process;
- stored provider/model is unavailable and no override was supplied.

The command must not fall back to creating a new session for any resume error.
That would make users believe they continued history when they did not.

## Required implementation changes

### Core session layer

1. Add `SessionRepository.findLatest()` with cwd and originator filters and an
   `updatedAt` ordering contract.
2. Add a cross-process writer lock around `SessionRecorder.create/open`.
   Prefer an atomic sidecar lock with owner metadata or a proven portable lock
   library. Define stale-lock recovery explicitly and test it on supported
   platforms.
3. Preserve the existing exact `findById()` behavior for direct resume.

### Interactive core

1. Hydrate initial visible and conversation state from an injected session.
2. Extract shared configuration precedence so persisted metadata can be
   combined with explicit overrides.
3. Keep injected-session ownership with the caller and document it in the new
   command helper.

### CLI application

1. Add `src/apps/cli/resume.ts` with the optional session argument, `--last`,
   `--all`, and existing agent flags.
2. Implement a testable `runResumeSessionCommand()` separated from the oclif
   class, following the pattern used by `delete.ts`.
3. Refactor the interactive startup path so selection occurs before settings
   and contexts are loaded.
4. Update command documentation and generated oclif metadata using the
   repository's documented generation commands.

### GUI follow-up

No GUI change is required to deliver the CLI resume command. A separate GUI
product decision can add one of these startup policies:

- retain the current explicit-selection behavior;
- persist and restore the last-selected session ID per browser/workspace;
- select the latest session for the GUI workspace.

Restoring the last-selected ID is less surprising than always choosing the
latest updated session, especially when another CLI process modified a
different session. Any automatic GUI resume must also handle lock acquisition
and an already-open external writer.

## Test plan

### Repository tests

- latest is selected by `updatedAt`, including an old session updated after a
  newer-created session;
- cwd filtering uses normalized absolute paths;
- `--all`-equivalent lookup removes the cwd filter;
- eligible originators are included and other originators are excluded;
- corrupt files are reported without hiding a valid eligible session;
- two processes cannot open the same session for writing;
- stale-lock behavior follows the chosen explicit policy.

### CLI tests

- exact ID resumes the expected file;
- `--last` resumes the latest session for the launch cwd;
- `--last --all` resumes the global latest eligible session;
- bare command and invalid flag combinations produce stable English errors;
- unknown IDs and empty results never create a session;
- explicit provider/model flags override persisted values;
- persisted values override workspace defaults;
- settings and contexts are loaded from the effective resumed cwd;
- the opened session is closed on normal exit and on renderer failure.

### Interactive tests

- injected persisted messages are visible at startup;
- the next user turn appends to the same session ID and file;
- prior persisted history is supplied exactly once to the model;
- local slash-command messages remain non-persistent;
- a resumed session preserves the stored system prompt unless explicitly
  overridden.

### GUI regression tests

- startup loads recent sessions without selecting one;
- selecting a session marks it active and directs the composer to its ID;
- deleting the selected session clears the current client state;
- selecting an already loaded backend thread returns its current snapshot.

## Delivery sequence

1. Implement and test cross-process session locking.
2. Add repository-level latest-session lookup.
3. Hydrate injected interactive sessions and centralize resume option
   resolution.
4. Add `orbit resume <SESSION_ID>` and `orbit resume --last [--all]`.
5. Update maintained and generated CLI documentation.
6. Consider a picker, names, cwd selection, and fork only after the core resume
   contract is stable.

## Sources

- OpenAI, [Codex CLI command reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli),
  `codex resume` and `codex exec resume` sections, accessed 2026-08-23.
- Anthropic, [Claude Code sessions](https://code.claude.com/docs/en/sessions),
  resume and session-picker sections, accessed 2026-08-23.
- Orbit repository: `src/apps/gui/client.tsx`, `src/core/application.ts`,
  `src/apps/cli/_interactive.ts`, `src/core/interactive.tsx`,
  `src/core/session/repository.ts`, `src/core/thread.ts`, `bin/args.js`, and
  `docs/session.md`, inspected 2026-08-23.
