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

When Ollama is selected without a model, CLI and GUI startup inspect the local
Ollama model list and select the first installed model that reports tool
support. Orbit has no hard-coded Ollama default. See [Settings](settings.md) for
the complete selection and failure behavior.

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
- `docs/README.md`: documentation map and content ownership rules
- `docs/architecture.md`: current implemented system and module map
- `docs/concepts/`: durable terminology, mental models, and explicitly labeled
  direction
- `docs/`: user and developer feature documentation
- `docs/adr/`: research-backed Architecture Decision Records
- `docs/research/`: dated, non-binding engineering investigations
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
[Model Response and Tool Integration](adr/2026-08-23-model-response-tool-integration.md)
for the verified protocol differences and follow-up direction.

Model providers are registered through `ModelRegistry` rather than selected by
a factory switch. A provider registration supplies its name, model constructor,
and an optional default model:

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

## Documentation model

Use the [Documentation Map](README.md) to choose the authoritative home for a
change:

- concepts define durable vocabulary, mental models, and invariants;
- current architecture describes the repository as implemented today;
- feature guides describe current user and integration behavior;
- research preserves dated evidence and non-binding analysis; and
- ADRs preserve significant decisions, rationale, and lifecycle evidence.

Directional concepts must be labeled explicitly. Do not add an unimplemented
target design to `architecture.md`, and do not turn a research recommendation
or concept page into an implicit decision.

## Architecture decision records

Use `docs/adr/` for research-backed Architecture Decision Records (ADRs).
These records preserve the evidence, alternatives, rationale, consequences, and
implementation history behind architecturally significant decisions. They are
not authoritative user documentation and do not replace updates to the README,
API documentation, or feature-specific guides.

An ADR is appropriate when a choice materially affects system structure,
public or provider contracts, persistent formats, security or privacy
boundaries, cross-cutting runtime behavior, major dependencies, or something
costly to reverse. Do not create ADRs for routine fixes, local refactors,
progress reports, chat transcripts, or temporary plans.

Before adding a record, search the existing decisions and use the repository
skill at `.agents/skills/architecture-decision-record/SKILL.md`. The
[Architecture Decision Records](adr/README.md) index defines the complete
metadata schema, required sections, status values, and lifecycle.

Name a new record using its proposal date and a concise lowercase English topic
slug:

```text
docs/adr/YYYY-MM-DD-<topic>.md
```

Keep the filename while the decision advances from proposal through
implementation. Create a new dated record only for a distinct decision or a
material re-evaluation that supersedes an accepted decision.

Every ADR must separate decision status from implementation status. A proposal
can be accepted before it is implemented, rejected without implementation, or
only partially delivered. Keep `decision-date` null while the ADR is proposed
and set it to the explicit acceptance or rejection date when changing a new ADR
to either status. Do not derive it automatically from
`implementation-completed-date`; those dates match only when the events occur
on the same day. Migrated historical ADRs may retain a null `decision-date`
when the original decision date was not recorded. Use ISO 8601 dates and full
40-character commit hashes. Do not infer missing historical acceptance dates
or source revisions.

Put `Purpose`, `Decision`, and `Consequences` before detailed research. Follow
them with the problem context, decision drivers, external implementation
research, considered options, implementation and confirmation evidence,
follow-up work, and references. Keep one cohesive decision per record and
clearly distinguish verified facts, inferences, proposals, and future work.

For decisions about agent runtimes, models, tools, sessions, context assembly,
CLI or GUI agent workflows, persistence, or observability, investigate Codex
and Pi Coding Agent by default. Pin inspected source to an exact version, tag,
or full commit; list the relevant source files; and state both what Orbit should
adopt and what it should not. If either implementation is not relevant, explain
why rather than silently omitting it. Use primary source and official
documentation wherever possible.

Commit the proposed ADR before implementation. After implementation commits
exist, use a later documentation commit to record their full hashes, the
completion date, confirmation evidence, and completed implementation status. A
separate finalization commit is necessary because a commit cannot record its
own final hash in a tracked file.

Preserve the accepted context, decision, and original rationale. Metadata,
implementation evidence, confirmation results, and newly observed consequences
may be added later, but a material change requires a new ADR that marks and
links the original as superseded. Current code and maintained documentation
remain authoritative for implemented behavior.

## Documentation changes

Update the relevant documentation when changing CLI behavior, settings, public
APIs, or integration contracts. The interactive command reference is generated
from `docs/interactive.adoc` and `docs/data/interactive.csv`; update those
sources rather than editing only `docs/interactive.md`.

When runtime structure changes, update `docs/architecture.md`. When a change
affects shared terminology or invariants, update the relevant document under
`docs/concepts/` and its glossary entry. Record the decision history in an ADR
when the change is architecturally significant; keep dated investigation
evidence in `docs/research/`.

Command metadata changes may require regenerating oclif documentation with
`npm run prepack` or `make oclif-docs`. Review all generated differences before
committing them.
