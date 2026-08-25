# Repository Guidelines

## Language Policy

English is the canonical and required language for this project.

- Write source code identifiers, comments, docstrings, log messages, error messages, CLI help, documentation, examples, configuration samples, test names, fixtures, and generated text in English.
- Write commit messages, branch names, pull request titles and descriptions, issue text, review comments, release notes, and changelog entries in English.
- Use English as the source language before adding any localization. Non-English text is allowed only in dedicated localization resources or test data when a language-specific behavior must be implemented or verified; keep the surrounding names and explanations in English.
- Do not copy the language of a user request into repository artifacts when that language is not English. Translate the intended content into clear technical English first.
- Follow the existing commit convention: `<type>(<scope>): <imperative summary>`, for example `feat(core): add provider fallback`. Common types include `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, and `style`.

## Project Overview

Orbit is an agentic CLI and reusable TypeScript library for content workflows. It supports OpenAI, Anthropic, and Ollama models, MCP tools, interactive sessions, workspace settings, and a thread lifecycle API for GUI integrations.

- `src/index.ts` is the package entry point.
- `src/apps/cli/` contains oclif commands; `src/apps/cli-flags.ts` contains shared flag handling.
- `src/apps/gui/` contains the loopback-only local GUI server and React client.
- `src/core/` contains the reusable runtime and public library implementation.
- `src/core/models/adapters/` contains provider-specific model adapters.
- `src/core/tools/` contains tool definitions, the registry and runtime, and built-in coding tools.
- `src/core/session/` contains persisted session records, context assembly, resume support, and deletion behavior.
- `src/core/logs/` contains session-scoped structured log stores and records.
- `src/core/thread.ts` provides the event-driven thread API used by GUI clients.
- `test/` mirrors the source areas with Mocha/Chai unit tests.
- `docs/` contains user-facing documentation. `docs/interactive.adoc` and `docs/data/interactive.csv` are sources for the generated `docs/interactive.md`.
- `bin/` contains CLI launchers and repository maintenance scripts.

## Development Environment

- Use Node.js 20.19 or newer and npm. `package-lock.json` is the authoritative dependency lockfile.
- Install reproducibly with `npm ci`. Update dependencies with npm and include the resulting lockfile changes.
- Run the CLI from TypeScript sources with `./bin/dev.js` on POSIX systems or `bin\dev.cmd` on Windows. Pass command arguments directly to the launcher, for example `./bin/dev.js --help`.
- After a build, run the compiled CLI with `./bin/run.js` on POSIX systems or `bin\run.cmd` on Windows. Build before using `orbit gui`, and rebuild after changing either GUI source file.
- The project uses TypeScript in strict mode, native ESM, and Node16 module resolution.
- Relative imports in TypeScript must use the emitted `.js` extension, such as `./settings.js`.
- Do not edit generated or ignored outputs such as `dist/` or `oclif.manifest.json` by hand.
- Do not assume a fresh machine has provider credentials, a running Ollama service with a tool-capable model, configured MCP commands, or existing `~/.orbit` data. Builds and unit tests do not require them; use live integrations only when the task requires them and the environment is configured.
- Local runtime settings can be inherited from ancestor `.orbit/settings.json` files, while saved sessions and logs default to `~/.orbit/sessions/` and `~/.orbit/logs/`. Consult `docs/settings.md` before manual provider runs and keep tests isolated from these real locations.

## Implementation Conventions

- Keep CLI-specific behavior in `src/apps/cli/` and reusable behavior in `src/core/`.
- Preserve the public API through `src/core/index.ts` and `src/index.ts`. Export new public values and their associated types deliberately, and add an export test when appropriate.
- Keep provider-specific serialization and API behavior inside the relevant model adapter. Shared behavior belongs in provider-neutral core modules.
- Model adapters receive serializable `ModelToolSpec` definitions, never executable handlers. `ToolRegistry` combines built-in, custom, turn-scoped, and MCP definitions, while `ToolRuntime` validates and schedules calls.
- Preserve normalized `ModelOutputPart` values when adapting assistant responses so provider state needed by later requests is not flattened away. Store provider-only response data under JSON-serializable `ModelResponseMetadata.providerMetadata`.
- Register model providers through `ModelRegistry` or `registerModelProvider()` rather than adding provider-selection switches. Register external providers before loading settings that select them.
- The OpenAI adapter currently uses Chat Completions. A future Responses API adapter must preserve ordered output items and continuation state instead of flattening a response into one text message.
- Workspace discovery only considers ancestors that contain an `.orbit` directory. System context loading reads both `ORBIT.md` and `AGENTS.md` from those workspaces, ordered from shallowest to deepest; keep this contract aligned with settings discovery.
- Preserve the GUI security boundary: bind only to loopback, require the startup capability token for HTML, JavaScript, REST, and event-stream requests, and retain origin checks, request limits, and schema validation.
- Prefer explicit TypeScript types at module boundaries. Use `import type` and `export type` for type-only dependencies.
- Follow the repository's dependency-injection pattern for code that talks to models, MCP clients, settings loaders, or other external boundaries so it remains unit-testable.
- Keep asynchronous cleanup reliable. Close agents, MCP managers, and other owned resources with `finally` blocks when failure paths can otherwise leak them.
- Add the standard copyright and SPDX header to new `.ts` files. Run `npm run headers:apply` to add missing headers and `npm run headers:check` to verify them.
- Let Prettier and ESLint define formatting and import ordering. Avoid unrelated formatting or refactoring in focused changes.
- The built-in `bash` tool requires Bash. On Windows it resolves `ORBIT_BASH_PATH`, Git Bash, or `bash.exe` on `PATH`; keep changes to shell execution portable across those paths.

## Testing and Validation

- Add or update tests for every behavioral change. Place tests in the matching `test/apps/cli/` or `test/core/` area and write `describe`/`it` text in English.
- Keep unit tests deterministic and isolated. Stub model/provider behavior rather than making live LLM, network, or MCP service calls.
- Use temporary directories for filesystem tests and avoid depending on a developer's real workspace settings or credentials.
- Run the narrowest relevant test while iterating. A POSIX-shell example is:

  ```sh
  TS_NODE_PROJECT=tsconfig.test.json npx mocha --forbid-only "test/core/thread.test.ts"
  ```

- Before handing off a change, run the complete validation set:

  ```sh
  npm run headers:check
  npm run build
  npm test
  ```

- `npm test` runs `npm run format` and `npm run lint` first; both commands can rewrite files. Review the resulting diff after running it.
- CI exercises the build and test suite on Ubuntu and Windows across multiple supported Node.js releases. Avoid platform-specific path, shell, and newline assumptions in runtime code and tests.

## Documentation and Generated Files

- Update user documentation when changing CLI behavior, settings, public APIs, or integration contracts.
- Record architecturally significant decisions as research-backed ADRs in `docs/analysis/` before implementation. Use `.agents/skills/architecture-decision-record/SKILL.md` to create, review, migrate, finalize, or supersede them, and follow `docs/analysis/README.md` for the authoritative format and lifecycle.
- For agent runtime, model, tool, session, context, CLI or GUI agent workflow, persistence, and observability decisions, investigate Codex and Pi Coding Agent at pinned source revisions by default. State why either comparison is not applicable instead of omitting it silently.
- Keep accepted decision rationale intact. Record implementation completion and full commit hashes in a later documentation commit; use a new linked ADR when a decision is materially replaced.
- Do not store routine progress reports, chat transcripts, temporary plans, or local implementation details in `docs/analysis/`, and do not treat ADRs as a substitute for maintained user documentation.
- Treat `README.md` command sections and `oclif.manifest.json` as oclif-generated content. Use `npm run prepack` or `make oclif-docs` when command metadata changes, then review generated differences.
- Update `docs/data/interactive.csv` or `docs/interactive.adoc` when changing the interactive command reference, and regenerate `docs/interactive.md` from those sources.
- Do not run `make doc` unless an automatic documentation commit is explicitly intended: the current Makefile can invoke `git commit` while regenerating AsciiDoc-derived Markdown. Prefer running the individual generation command and reviewing changes before committing.
- Never include real API keys, credentials, private paths, or secret environment values in code, tests, documentation, logs, or commits. Use clearly fake placeholders in examples.

## Change Discipline

- Inspect the working tree before editing and preserve unrelated user changes.
- Keep changes scoped to the request. Do not modify generated files, dependencies, or public APIs unless the change requires it.
- Do not create commits, tags, releases, or push changes unless explicitly requested.
- Review `git diff` after formatters, linters, generators, and tests have run. Report any validation that could not be completed.
