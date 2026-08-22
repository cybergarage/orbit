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
- `src/apps/cli/`: oclif commands and CLI-specific behavior
- `src/core/`: reusable runtime and public library implementation
- `src/core/models/adapters/`: provider-specific model adapters
- `src/core/thread.ts`: event-driven thread API for GUI integrations
- `test/`: Mocha and Chai tests mirroring the source areas
- `docs/`: user and developer documentation
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

## Documentation changes

Update the relevant documentation when changing CLI behavior, settings, public
APIs, or integration contracts. The interactive command reference is generated
from `docs/interactive.adoc` and `docs/data/interactive.csv`; update those
sources rather than editing only `docs/interactive.md`.

Command metadata changes may require regenerating oclif documentation with
`npm run prepack` or `make oclif-docs`. Review all generated differences before
committing them.
