# Changelog

## 0.8.1 — Unreleased

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
