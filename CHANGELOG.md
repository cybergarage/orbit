# Changelog

## 0.9.2 — Unreleased

Source preparation only. No v0.9.2 tag, GitHub release or npm publication has
been created.

### Fixed

- Keep coordination guard and owner creation descriptors open until identity
  verification and unlink complete. This prevents false identity-change failures
  on bind mounts that change path inode identity after the last handle closes.
- Release owned descriptors on acquisition, cleanup and transcript-maintenance
  failures while retaining uncertain or replaced coordination evidence. Device,
  inode, file type, link count and owner-token checks remain enforced.

### Upgrade notes

- This patch does not change storage formats or migrate existing data. Stop all
  writers before upgrading; mixed-version writers remain unsupported.
- Existing retained guards are not removed automatically. If a previous failure
  left coordination evidence, inspect it under the documented offline recovery
  conditions rather than deleting guards or weakening identity checks.
- The consumer example pins `@cybergarage/orbit@0.9.2` for local tarball validation
  until publication. Orbit App adoption is a separate dependency update.

## 0.9.1 — 2026-10-15

Published to npm and as the v0.9.1 GitHub release.

### Added

- Add Project deletion and persistent Session archive, plus CLI commands for
  Project and Session lifecycle operations.
- Add revisioned Project and Session display names through the public library,
  CLI and embedded GUI. Rename retries are bound to operation IDs and expected
  revisions; names do not replace durable IDs or rewrite conversation history.
- Add Home, Scheduled and Settings workspaces to the embedded GUI, including
  opt-in local scheduling and the existing core scheduling controls.

### Fixed

- Align the embedded GUI with the approved conversation layout. Group Session
  information, model/context, next-run limits and Skills, and logs in a shared
  Details panel that docks on wide windows and overlays compact windows.
- Present operation approvals in a native modal dialog. Preserve pending
  approval on dismissal, prevent duplicate or expired decisions, contain
  keyboard focus and keep important Run states visible with Details closed.

### Upgrade notes

- Version 0.9.1 is published with the Project/Session lifecycle and display-name
  APIs. Applications should pin their exact dependency and validate upgrades.
- Session `title` and `titleRevision` metadata and the rename APIs are included
  in this source version. Hosts should refresh stale revisions and retry only
  the same operation payload after an uncertain response.
- Existing 0.9.0 publication records remain historical. Stop writers and follow
  the documented storage maintenance procedure when changing runtime versions;
  a package upgrade does not authorize mixed-version writers.

## 0.9.0 — 2026-10-14

Source release for the current application-development runtime. GitHub
release creation and npm publication are separate steps.

### Added

- Add public `DurableWorkStore` and scheduling types for single-owner local
  hosts. Persist schedules, occurrences, stable request IDs, attempts, approvals,
  cancellation and results. Interrupted read work can return to the queue;
  uncertain opaque effects require explicit reconciliation. See
  [Durable scheduled work](docs/scheduled-work.md).
- Add the optional `apple` provider, `AppleFoundationModelsAgent` and
  `AppleHelperClient`, with a separately compiled Swift helper included in the
  package. Support local text generation and alternating text turns on eligible
  Macs; tools, streaming and structured generation remain unsupported. See
  [Apple Foundation Models](docs/apple-foundation-models.md).
- Add Orbit branding and links to the Orbit App and Orbit Nest projects.

### Fixed

- Support Windows storage registration, writer coordination, migration and
  managed execution with explicit file-flush acknowledgements. Use writable
  file handles for synchronization and preserve native realpath identity,
  including expanded Windows short paths. Explicit unsupported directory-sync
  guarantees still fail; errors are not silently ignored. See
  [Platform acknowledgement](docs/session-storage.md#platform-acknowledgement).

### Upgrade notes

- Pin application dependencies to `@cybergarage/orbit@0.9.0` and retain the
  application lockfile. The consumer example now targets this version.
- Existing v0.8.1 execution APIs remain available. This release does not add a
  Session or execution-journal format migration. Existing or interrupted data
  still requires the applicable [storage maintenance](docs/session-storage.md)
  procedure before changing writers.
- Windows defaults to `file-sync`; Linux and macOS retain
  `file-and-directory-sync`. Hosts requiring the stronger level must request it
  explicitly and handle rejection on unsupported platforms. File-only
  acknowledgement does not establish namespace durability across power loss.
- Scheduling supplies host storage primitives, not a background daemon or
  calendar/timezone recurrence. Apple model use requires explicit native setup
  and a text-only configuration; other provider installations remain portable.

### Validation scope

Deterministic tests and an independently installed package consumer validate the
runtime and distribution surface. Live-provider quality, deployment recovery
and physical power-loss behavior require separate qualification. The existing
stale-lock reclamation race remains documented in
[Development](docs/development.md#tests-and-validation).

## 0.8.1 — 2026-10-02

Source release with compatible public execution APIs. npm publication remains
a separate step.

### Added

- Add public `OperationExecutor`, binding a Run and its policy for tool and
  prepared-operation execution, and reusable `AgentExecutionOptions`.

### Changed

- Route Agent, Graph tool nodes and managed MCP startup through the same
  operation executor. Encapsulate shared resource ownership without changing
  its conflict domain, approval protocol or journal/storage formats.
- Preserve `executeManagedTool` and `executePrepared` as compatible delegates.
  Settings merging and session parsing remain standalone transformations.

### Fixed

- Refuse new operation preparation and recording through retained executors or
  compatibility calls after their Run has terminated.

See [Managed Execution](docs/execution.md) for ownership and API selection.

## 0.8.0 — 2026-10-01

Source release for the Orbit version used as the technical book's source
baseline. npm publication and the book's full source comparison are tracked
separately.

### Added

- Add transactional Project catalogs, SQLite-backed storage, Session membership
  and explicitly curated cross-session memory, with GUI management and sidebar
  navigation. See [Projects and Memory](docs/projects.md).
- Load local Agent Plugins containing Skills and stdio MCP configuration through
  managed discovery, preparation and execution. See [Agent Plugins](docs/plugins.md).
- Add CLI inventories for tools, MCP servers and plugins, and confirmed offline
  storage reset. See the [CLI Reference](docs/cli.md).
- Add opt-in Prometheus operational metrics. See [Metrics](docs/metrics.md).
- Add local Ollama/Docker coding evaluations, pinned SWE-bench grading and
  independent checks of generated patches. Preserve dated conditions, failures
  and limitations in the [evaluation results](e2e/results/README.md).

### Changed

- Support unlimited execution budgets by default, configurable finite limits
  and explicit GUI continuation after budget stops. Applications that require
  bounded execution must configure limits; see [Managed Execution](docs/execution.md).
- Resolve model context capacity from provider metadata and settings, and compact
  completed rounds within long-running turns. See [Model Context Capacity](docs/model-context-capacity.md)
  and [Compaction](docs/context-compaction.md).
- Preserve descriptive Skill metadata, including license and compatibility.
- Pin the standalone consumer example to package version 0.8.0.

### Fixed

- Reject incomplete model responses before tool dispatch and preserve unhandled
  shell test failures.
- Recover truncated, empty and incomplete context summaries with bounded
  batching, validated regeneration and retained output allowances.
- Preserve source-derived edit and command observations beside checkpoints,
  and factor repeated summary tool output losslessly.
- Restore application-specific workspace instruction files and improve
  interactive input handling and GUI layout.

### Validation scope

Deterministic runtime and installed-package checks are separate from live-model
quality and deployment validation. Local SWE-bench results are diagnostic
observations, not general model-reliability estimates. Summary semantic errors
remain in recorded live diagnostics. The known stale-lock reclamation race and
its diagnostic probe remain documented in [Development](docs/development.md).
Existing installations must follow the applicable storage guides before
changing writers or storage formats.

## 0.6.1 — 2026-09-15

First npm publication; the GitHub 0.6.0 source release remains unchanged.

- Describe Orbit as an agent framework for building agent applications.
- Move generated CLI usage and commands to `docs/cli.md`; keep the root README
  focused on framework installation, application development and guide links.
- Route `docs:commands`, the version hook and Makefile through the same oclif
  generator with an explicit documentation path.
- Rename the application guide to `docs/building-agents.md` and the example to
  `examples/agent`. The example now uses `AGENT_WORKSPACE`, `AGENT_DATA_DIR`
  and `.agent` as its default data directory. Existing example data can be
  retained by setting `AGENT_DATA_DIR` to the previous `.assistant` path.
- Preserve model message roles and the public API.

## 0.6.0 — 2026-09-15

First public release as `@cybergarage/orbit`. The command remains `orbit`.

### Application development

- Document the Node.js application boundary, host-owned capabilities and 0.x
  compatibility policy. Planned milestones are 0.8 for book publication and
  1.0 for a completed assistant application and stable runtime API contract.
- Add a standalone TypeScript assistant example with an offline model adapter,
  persistent conversations, approvals, cancellation, logs and restart/resume.
- Update maintained guide imports to use the scoped package and correct GUI
  integration guidance for storage setup, admission and observation.

### Distribution

- Build the runtime, type declarations, GUI bundle and CLI manifest before
  packing; keep README generation separate from package publication.
- Validate the installed tarball from an independent consumer and run that
  check in release/publish workflows and Linux CI on Node.js 20.19 and 24.

### Included runtime

The initial release includes OpenAI, Anthropic and Ollama adapters; coding and
MCP tools; managed Run budgets, approvals, cancellation and journals; persistent
Sessions and storage maintenance; explicit Skill selection; and bounded
processor graphs with workflow evaluation and application-owned selection.
See the [documentation map](docs/README.md) for behavior and limitations.

This is an evolving 0.x runtime, not a complete autonomous assistant product.
Persistent storage must be initialized under offline exclusive control. Existing
development installations must follow the applicable storage migration guides.
Live provider, deployment, Windows persistence and physical-failure validation
are separate from the deterministic consumer checks.
