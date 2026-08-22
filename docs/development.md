# Development

This document explains how to set up the Orbit repository, run the CLI from
source, and validate changes. It is intended for contributors and maintainers
working on the CLI or the reusable TypeScript library.

## Prerequisites

- Node.js 18 or newer
- npm

## Setup

Clone the repository, change to its root directory, and install the locked
dependencies:

```sh
npm ci
```

`package-lock.json` is the authoritative dependency lockfile. Use npm when
adding or updating dependencies, and include the resulting lockfile changes.

## Run the development CLI

Run Orbit directly from the TypeScript sources with:

```sh
./bin/dev.js
```

Pass CLI arguments after the script name. For example, to display help:

```sh
./bin/dev.js --help
```

On Windows, use the corresponding command script:

```bat
bin\dev.cmd --help
```

The development launcher uses `ts-node`, so rebuilding is not required after
each source change.

## Build and run the compiled CLI

Compile the TypeScript sources into `dist/`:

```sh
npm run build
```

Then run the compiled CLI with:

```sh
./bin/run.js --help
```

Do not edit files in `dist/` or `oclif.manifest.json` by hand. They are
generated outputs.

## Configuration

Orbit supports OpenAI, Anthropic, and Ollama. Configure the provider, model,
credentials, and optional MCP servers as described in [Settings](settings.md).
Keep real credentials out of source files, tests, documentation, logs, and
commits.

## Project structure

- `src/index.ts`: package entry point
- `src/apps/cli/`: oclif commands
- `src/apps/cli-flags.ts`: shared CLI flag handling
- `src/core/`: reusable runtime and public library implementation
- `src/core/models/adapters/`: provider-specific model adapters
- `src/core/thread.ts`: event-driven thread API for GUI integrations
- `test/`: Mocha and Chai tests mirroring the source areas
- `docs/`: user and developer documentation
- `docs/analysis/`: dated engineering analysis and design records
- `bin/`: CLI launchers and repository maintenance scripts

Keep reusable behavior in `src/core/` and CLI-specific behavior in
`src/apps/cli/`. Relative TypeScript imports must use the emitted `.js`
extension.

## Tests and validation

Run the narrowest relevant test while iterating. For example:

```sh
TS_NODE_PROJECT=tsconfig.test.json npx mocha --forbid-only "test/core/thread.test.ts"
```

Before submitting a change, run the complete validation set:

```sh
npm run headers:check
npm run build
npm test
```

`npm test` runs Prettier and ESLint before the test suite. These commands can
rewrite files, so review the resulting diff afterward. New TypeScript files
must include the standard copyright and SPDX header; run
`npm run headers:apply` to add missing headers.

Add or update deterministic, isolated tests for every behavioral change. Stub
model providers, MCP services, and other external boundaries instead of making
live network requests.

## Engineering analysis documents

Use `docs/analysis/` for durable, point-in-time records of substantial
engineering investigations, design explorations, trade-offs, and implementation
directions. These documents preserve the context behind a decision; they are
not authoritative user documentation and do not replace updates to the README,
API documentation, or feature-specific guides.

Do not store routine progress reports, chat transcripts, or temporary scratch
notes in this directory. Before adding a document, check whether an existing
analysis already covers the topic and update it when the work is a continuation
of the same investigation.

Name each new analysis document using its creation date and a concise English
topic slug:

```text
docs/analysis/YYYY-MM-DD-<topic>.md
```

Use an ISO 8601 date and lowercase kebab-case for the topic, for example:

```text
docs/analysis/2026-08-22-session-persistence.md
```

Keep the original filename when revising the same analysis. Create another
dated document only for a distinct investigation or a deliberate re-evaluation
that should preserve the earlier record.

An analysis document should include, as applicable:

- a descriptive title and purpose;
- the observed current behavior and supporting repository evidence;
- requirements and constraints;
- alternatives and their trade-offs;
- the recommended direction, open questions, and implementation status.

Clearly distinguish verified current behavior from proposals or future work.
Because an analysis captures a point in time, the current code and maintained
user documentation take precedence if they later differ from the analysis.

## Documentation changes

Update the relevant documentation when changing CLI behavior, settings, public
APIs, or integration contracts. The interactive command reference is generated
from `docs/interactive.adoc` and `docs/data/interactive.csv`; update those
sources rather than editing only `docs/interactive.md`.

Command metadata changes may require regenerating oclif documentation with
`npm run prepack` or `make oclif-docs`. Review all generated differences before
committing them.
