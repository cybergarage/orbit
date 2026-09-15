# Development

This document explains how to set up the Orbit repository, run the CLI from
source, and validate changes. It is intended for contributors and maintainers
working on the agent framework or its CLI and GUI applications.

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
import {registerModelProvider} from '@cybergarage/orbit'

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

### Managed execution surface fixtures

After building, run these isolated fixtures from the repository root:

```sh
node test/apps/cli/fixtures/managed-interactive.mjs
node test/apps/gui/fixtures/transport-faults.mjs
```

The first needs a real terminal. Type `edit`, answer `y`, `n`, or Ctrl+C at
confirmation, then type `/exit`. It prints the outcome and whether the temporary
file changed. Use separate sessions for approval and denial/cancellation checks.
It deliberately selects `file-sync`; this does not verify the stronger default.

The GUI fixture prints a loopback URL. Create a session, send `edit`, wait for
the preview, and approve once. Its local proxy disconnects SSE, delays an old
snapshot, returns HTTP 503 once, and replays duplicate/out-of-order snapshots.
Verify completion and disappearance of the reconnect notice. Terminate the
fixture with SIGTERM to print counters and remove its temporary data. Both
fixtures inject models and avoid provider credentials and real user sessions.

The separate diagnostic probe below tests simultaneous reclamation of a stale
SessionRecorder lock. **It currently exits 1 because both writers acquire the
same session.** This is an unresolved concurrency defect, not a passing regression
test; see the [journal ADR](adr/2026-09-07-required-execution-journal.md).

```sh
node test/core/execution/fixtures/stale-lock-race.mjs
```

It synchronizes two child processes after both read the dead owner's lock,
then lets them reclaim it in order. It kills only its own children and removes
its temporary directory. Keep this evidence distinct from `npm test` results.

## Releases and npm packages

See [Versioning](versioning.md) for milestone and compatibility policy.
The npm package is `@cybergarage/orbit`; the executable stays `orbit`.
Pushes do not create releases or publish packages automatically; both publication
workflows require an explicit manual dispatch.

1. Update `package.json` and the root metadata in `package-lock.json` together.
   Update the example's exact dependency and the relevant release documentation.
2. Run `npm run headers:check`, `npm run build`, `npm test` and
   `npm run test:package`. The latter packs a real tarball and installs it into
   an independent TypeScript consumer with no source-path aliases. It checks
   imports, CLI help, durable sessions, run retries, approval/denial, cancellation,
   logs and restart/resume without provider credentials. It needs registry access
   to install dependencies. It does not test live models or production storage.
3. Run `npm run docs:commands` after building to regenerate the oclif
   sections in `docs/cli.md`. Review all generated changes and run `git diff --check`.
4. Commit the reviewed change and create/push `v<package-version>` for that
   commit. Run the `Create GitHub release` workflow with that existing tag.
5. Run `Publish npm package` with the same released tag and the exact confirmation
   `publish`. Configure the repository's `NPM_TOKEN` with current npm publishing
   permissions. The workflow checks the version, tag, release, test suite and
   independent package consumer before publishing.

`prepack` always builds the runtime and GUI and generates the CLI manifest.
It does not regenerate tracked documentation. `files` limits the tarball to
runtime outputs, launchers, maintained Markdown guides and example source.
`publishConfig` specifies public access and the npm registry.

For a maintainer publishing locally after the same release checks:

```sh
ORBIT_RELEASE_DIR=/path/to/release-artifacts npm run test:package
npm publish /path/to/release-artifacts/cybergarage-orbit-VERSION.tgz --access public
```

Inspect the packed file list before publishing; verify the registry version and
GitHub tag afterward. A version that has been published must not be reused.
`ORBIT_RELEASE_DIR` retains the exact tested tarball; without it the temporary
consumer and tarball are removed. On Windows, set that environment variable
using your shell's syntax before running the check.
The package's first publication may require interactive npm authentication/2FA.
Never put credentials in repository files or release logs.

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

The CLI reference in [CLI Reference](cli.md) is generated by oclif from the
command definitions in `src/apps/cli/`. After changing command metadata, run:

```sh
npm run build
npm run docs:commands
```

`docs:commands` refreshes the manifest, then runs
`oclif readme --readme-path docs/cli.md`. It replaces the `usage` and `commands`
marker sections in that file; edit command definitions rather than generated
sections. `make oclif-docs` uses the same npm script. The root README is maintained
by hand as the framework introduction. Review generated differences before
committing them.
