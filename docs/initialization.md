# Initialization

Orbit CLI and the embedded GUI share the same default user profile. Initialization
has three modes: `settings`, `data`, and `all`. Existing `orbit storage reset`
retains its older, narrower contract; it does not remove GUI scheduled work.

## Scope and preview

Run `orbit initialize MODE --dry-run` to display a metadata-only plan: exact paths,
file counts, byte sizes, retained scope and a plan ID. No initialization, model
request, credential-value output or backup occurs during planning.

- `settings`: remove only explicitly selected settings.json files. Select each
  with repeatable `--settings-file /absolute/path/settings.json`. No ancestor file
  is selected automatically. An empty selection has no persistent effect.
- `data`: remove sessions, execution journals, logs, the Project database and its
  SQLite sidecars, and GUI schedules, occurrence history and dedicated logs.
- `all`: combine selected settings and saved data with explicitly host-owned
  cache roots. The embedded GUI has no owned persistent browser cache, so no
  browser profile is cleared. Host libraries may supply explicit cache roots.

Settings resolution depends on the working directory and its ancestors. Files
can affect multiple projects and contain API keys or MCP environment values.
Only paths and metadata are displayed, never their contents. Removing a file does
not revoke credentials or change environment variables. Resetting a nearer file
can expose an inherited setting again; review the retained sources separately.

User workspaces, their artifacts, `.orbit/skills`, AGENTS.md, ORBIT.md, plugin data,
Docker images and Ollama models are retained. No profile root is removed. The CLI
never discovers or initializes Electron Orbit App data.

Default saved targets are ~/.orbit/sessions, ~/.orbit/runs, ~/.orbit/logs,
~/.orbit/projects.sqlite (including sidecars), and ~/.orbit/gui-scheduled. appName
configuration changes the dot-directory; ORBIT_LOG_DIR can relocate logs. Custom
library hosts supply their owned paths explicitly. CLI and GUI use the same
`orbitInitializationProfile`; the same selected sources produce the same plan
when underlying metadata has not changed.

## Permanent execution

This operation permanently deletes targets; it does not move them to OS Trash,
create backups, stage copies or promise secure erasure. Stop every CLI, GUI,
library and older writer process; disable automatic restarters; establish external
exclusive control, including shared settings. Declaration flags are required:
`--writers-stopped --restarters-disabled --exclusive-storage-control`.
An interactive terminal then requires `INITIALIZE`. Noninteractive callers must
also pass `--confirm-initialize`. This flag never bypasses offline declarations.

Known session writers, uncertain recovery ownership and scheduled-work locks are
checked even after declaration. Idle old processes, arbitrary file writers and
external services cannot all be detected; declarations are not proof of absence.
The administrator must retain external exclusion until success or reviewed retry.

In GUI Settings → Initialization, select scope and explicit settings sources, then
preview without changes. “Stop this host and review” blocks new API work, drains
existing requests, closes the scheduler and the application including SQLite, and
creates the final plan. If cleanup fails, no deletion occurs and the host remains
in maintenance. A separate final confirmation declares external exclusion and
requires INITIALIZE. Cancel by closing the stopped host. Restart after any
execution; the GUI never silently reopens resources or resumes scheduled work.
Missing storage remains unregistered and follows normal startup initialization.

Paths are checked for protected ancestors, workspace content, symlinks, hardlinks,
unsafe types, nesting and replacement. Plans include metadata identities; changed
targets require a new review. Multi-target deletion is not atomic. Partial failure
lists completed paths, makes no rollback copy and requires continued offline
control. Review a fresh plan of remaining targets before retrying. Restore from
external media, if any, only as a consistent set under offline control.

## Library hosts

Public `planInitialization(profile, mode)` and
`executeInitialization(plan, consent)` share the contract. A trusted host supplies
`InitializationProfile`: storage pairs and SQLite/log paths, scheduled roots,
selected settings files, cache roots, ownership roots and protected retained paths.
It must verify that these are its own data, not caller-supplied workspace trees.
An ownership declaration is a host contract, not filesystem access authority.
Shared SQLite/log paths are deduplicated, while unsafe overlapping targets fail.
Never accept the profile directly from an HTTP client. GUI clients choose only
known settings-source paths; its host profile is fixed server-side.

A future Electron adapter needs a released core version containing these exports.
They are source additions, not APIs in the already published 0.9.2 package. Do not
change Orbit App's dependency until that release exists and is validated. OS Trash
would require a separate host operation and a consistent-set restoration contract.

## Orbit App publication and adoption gate

Version 0.9.3 is the planned release for these public exports; it is not yet
published. Orbit App PR #10 remains pinned to published 0.9.2 and its three
initialization controls remain disabled. Merging core source does not satisfy
the application's package dependency.

After explicit release authorization and actual npm publication:

1. Verify the published version, root exports, declarations and tarball against
   the tested release artifact. Pin the exact version and update the App Worker
   lockfile/image identity in a separate adoption change.
2. Supply an App-owned profile and preserve external workspaces and shared
   context. CLI/embedded-GUI roots must never be reused for Electron data.
   Separate settings and saved-data fields in the App registry deliberately;
   deleting its combined state file is not a settings-only reset.
3. Block admission and scheduled work; interrupt and await title generation;
   finish or stop the Worker and verify its writer has released storage. Close
   SQLite and host handles before creating a final metadata-only plan.
4. Connect preview, final plan identity and explicit permanent confirmation to
   the released API. Keep controls gated until this adapter is complete.
5. Test all three modes using new temporary profiles, including shutdown refusal,
   partial failure, restart, independent storage and retained workspace content.
   Enable controls only after the published dependency and real adapter pass.

These are adoption steps, not functionality already available in Orbit App.
