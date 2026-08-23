# Development

This document explains how to set up the Orbit repository, run the CLI from
source, and validate changes. It is intended for contributors and maintainers
working on the CLI or the reusable TypeScript library.

## Prerequisites

- Node.js 20.19 or newer
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

## Run the local GUI application

The GUI client is bundled as part of the normal build, so build Orbit before
starting the application:

```sh
npm run build
./bin/run.js gui
```

The command prints a loopback URL containing a temporary capability token.
Open that exact URL in a browser. Orbit selects an available port by default;
pass `--port` to use a fixed port:

```sh
./bin/run.js gui --port 4100
```

Provider and model flags can be passed to the same command. For example:

```sh
./bin/run.js gui --provider ollama --model llama3.1
```

Press Ctrl+C in the starting terminal to stop the application and close its
active agents, MCP clients, and session recorders. Re-run `npm run build` after
changing the React client or server source. See [Local GUI](gui.md) for session,
diagnostics, and security details.

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
- `src/core/tools/`: tool contracts, registry, runtime, and built-in coding tools
- `src/core/thread.ts`: event-driven thread API for GUI integrations
- `test/`: Mocha and Chai tests mirroring the source areas
- `docs/`: user and developer documentation
- `docs/analysis/`: dated engineering analysis and design records
- `bin/`: CLI launchers and repository maintenance scripts

Keep reusable behavior in `src/core/` and CLI-specific behavior in
`src/apps/cli/`. Relative TypeScript imports must use the emitted `.js`
extension.

Model adapters receive `ModelToolSpec` values and never executable tool
handlers. `ToolRegistry` combines built-in, custom, turn-scoped, and MCP
definitions; `ToolRuntime` validates and schedules calls. Add reusable tools
under `src/core/tools/` and keep provider-specific serialization in the model
adapter. See [Coding Tools](tools.md) for the public behavior.

Completed assistant messages keep their primary text in `Message.content` for
compatibility and may expose normalized `ModelOutputPart` values in
`ModelAssistantPayload.parts`. Adapters use these parts to preserve provider
state needed by later requests, such as Ollama thinking text and images.
Provider-native metadata that has no shared field belongs under
`ModelResponseMetadata.providerMetadata` and must remain JSON-serializable.

OpenAI currently uses Chat Completions. Adding a Responses API adapter requires
ordered output-item and continuation-state support; do not flatten Responses
items directly into a single text message. See
[Model Response and Tool Integration](analysis/2026-08-23-model-response-tool-integration.md)
for the verified protocol differences and follow-up direction.

Model providers are registered through `ModelRegistry` rather than selected by
a factory switch. A provider registration supplies its name, default model, and
model constructor:

```ts
import {registerModelProvider} from 'orbit'

registerModelProvider({
  name: 'custom',
  defaultModel: 'custom-default',
  create(model, provider) {
    return new CustomModel(model, provider)
  },
})
```

Register an external provider before loading workspace settings that select its
name. Provider-specific request serialization remains inside its `Model`
implementation. Generic `apiKey`, `apiKeyEnv`, and `host` connection fields are
available through the supplied `Provider`.

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
