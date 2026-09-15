# Orbit

Orbit is a TypeScript agent runtime for building assistant applications. It also
includes an `orbit` command-line interface and a local web GUI. Use it for the
model/tool execution, persistent conversations and run lifecycle beneath your
own desktop assistant, messaging bot or content workflow.

**0.6 is an early application-development release.** Orbit supplies the runtime;
your application supplies channel integrations, scheduling, memory policy,
authentication and notification delivery. See [capabilities and boundaries](docs/building-assistants.md).

## Install

Requires Node.js **20.19 or newer** and npm. The library uses native ESM and runs
in a trusted Node.js process, not a browser renderer.

As an application dependency:

```sh
npm install --save-exact @cybergarage/orbit@0.6.0
```

Or as a command-line application:

```sh
npm install --global @cybergarage/orbit@0.6.0
orbit --help
```

## Build your first assistant

Start with the [persistent assistant example](examples/assistant/README.md).
It runs against the npm package, includes an API-key-free demo, and demonstrates:

- creating, saving and resuming conversations;
- starting a Run and waiting for its actual result;
- presenting operation previews and replying to approvals;
- requesting cancellation and closing owned resources;
- switching from a deterministic demo adapter to a real model.

For an existing application, use `OrbitApplicationService` as the main
integration boundary and import it from `@cybergarage/orbit`. Follow the
example's setup and lifetime handling: persistent storage must be initialized,
Run admission is not completion, and the host must handle approvals and close
its resources after execution settles.

Use the [application guide](docs/building-assistants.md) for conversation routing,
request deduplication, reconnects, background triggers and extension points.
Use [GUI Integration](docs/gui-integration.md) for the service and event APIs.

## Try the CLI and local GUI

Configure a tool-capable model through [workspace settings](docs/settings.md),
or select your provider/model explicitly. For example, set `OPENAI_API_KEY`
through your environment, then replace `YOUR_MODEL` with an available model:

```sh
orbit exec --provider openai --model YOUR_MODEL --openai-api-key-env OPENAI_API_KEY "Describe this workspace"
```

`exec` uses an ephemeral Session. Persistent interactive and GUI sessions first
need storage initialization. On a fresh installation, with all Orbit writers
stopped, restarters disabled and exclusive control of the storage:

```sh
orbit storage initialize --writers-stopped --restarters-disabled --exclusive-storage-control
orbit gui --provider openai --model YOUR_MODEL --openai-api-key-env OPENAI_API_KEY
```

Open the exact loopback URL printed by `orbit gui`; it includes a startup token.
For existing or interrupted storage, follow [Session Storage](docs/session-storage.md)
instead of assuming a new installation. Writes, commands and MCP operations
normally require approval. Noninteractive `exec` cannot answer those prompts.
See [Managed Execution](docs/execution.md) before changing execution policy.

## Documentation

| I want to… | Start here |
| --- | --- |
| Build an application from scratch | [Assistant guide](docs/building-assistants.md) and [runnable example](examples/assistant/README.md) |
| Integrate a desktop/web frontend | [GUI Integration](docs/gui-integration.md) |
| Configure models, tools and MCP | [Settings](docs/settings.md) and [Tools](docs/tools.md) |
| Understand approval, budgets and failures | [Managed Execution](docs/execution.md) |
| Operate persistent data | [Sessions](docs/session.md), [Storage](docs/session-storage.md) and [Logs](docs/logging.md) |
| Add explicit Skills or context budgets | [Skills](docs/skills.md) and [Compaction](docs/context-compaction.md) |
| Understand versions and planned milestones | [Versioning](docs/versioning.md) |
| Contribute or publish a release | [Development](docs/development.md) |
| Explore implementation and design evidence | [Documentation map](docs/README.md) and [Architecture](docs/architecture.md) |

## Development and license

```sh
npm ci
npm run headers:check
npm run build
npm test
npm run test:package
```

The package check builds a tarball, installs it into an independent example
application, type-checks that consumer, and tests its lifecycle without provider
credentials. Live providers and deployment-specific recovery require additional
validation. Persistent storage verification currently focuses on Linux/macOS;
Windows storage support remains subject to the limitations in the storage guide.

Orbit is licensed under [Apache-2.0](LICENSE).

## Usage
<!-- usage -->
```sh-session
$ npm install -g @cybergarage/orbit
$ orbit COMMAND
running command...
$ orbit (--version)
@cybergarage/orbit/0.6.0 darwin-arm64 node-v26.5.0
$ orbit --help [COMMAND]
USAGE
  $ orbit COMMAND
...
```
<!-- usagestop -->
## Commands
<!-- commands -->
* [`orbit delete SESSION`](#orbit-delete-session)
* [`orbit exec [PROMPT]`](#orbit-exec-prompt)
* [`orbit gui`](#orbit-gui)
* [`orbit help [COMMAND]`](#orbit-help-command)
* [`orbit resume [SESSION]`](#orbit-resume-session)
* [`orbit session [SESSION]`](#orbit-session-session)
* [`orbit skills`](#orbit-skills)
* [`orbit storage ACTION [SESSION]`](#orbit-storage-action-session)

## `orbit delete SESSION`

Permanently delete a saved session

```
USAGE
  $ orbit delete SESSION [--force] [--journal-level file-and-directory-sync|file-sync]

ARGUMENTS
  SESSION  ID of the saved session to delete

FLAGS
  --force                   Delete without asking for confirmation
  --journal-level=<option>  Persistent journal acknowledgement level; unsupported levels fail admission
                            <options: file-and-directory-sync|file-sync>

DESCRIPTION
  Permanently delete a saved session

EXAMPLES
  $ orbit delete <SESSION_ID>

  $ orbit delete <SESSION_ID> --force
```

_See code: [src/cli/delete.ts](https://github.com/cybergarage/orbit/blob/v0.6.0/src/apps/cli/delete.ts)_

## `orbit exec [PROMPT]`

Send a prompt to the agent and print the response

```
USAGE
  $ orbit exec [PROMPT] [--anthropic-api-key-env <value>] [--debug] [--execution-policy
    workspace-confirm|unrestricted] [--journal-level file-and-directory-sync|file-sync] [--lang en|ja] [--model <value>]
    [--ollama-host <value>] [--openai-api-key-env <value>] [--provider anthropic|ollama|openai] [--skill-root
    <value>...] [--skill <value>...]

ARGUMENTS
  [PROMPT]  Prompt to send to the agent

FLAGS
  --anthropic-api-key-env=<value>  Environment variable name for the Anthropic API key
  --debug                          Enable debug logging
  --execution-policy=<option>      Operation policy; unrestricted still enforces budgets and recording
                                   <options: workspace-confirm|unrestricted>
  --journal-level=<option>         Persistent journal acknowledgement level; unsupported levels fail admission
                                   <options: file-and-directory-sync|file-sync>
  --lang=<option>                  Output language
                                   <options: en|ja>
  --model=<value>                  Model name (overrides workspace setting and provider default)
  --ollama-host=<value>            Ollama host URL
  --openai-api-key-env=<value>     Environment variable name for the OpenAI API key
  --provider=<option>              LLM provider (overrides workspace setting)
                                   <options: anthropic|ollama|openai>
  --skill=<value>...               Select Skill ID@DIGEST for this Run (repeatable)
  --skill-root=<value>...          Explicit Skill root ID=DIRECTORY (repeatable); replaces the workspace default

DESCRIPTION
  Send a prompt to the agent and print the response

EXAMPLES
  $ orbit exec "Write a haiku about TypeScript"

  echo "Write a haiku about TypeScript" | orbit exec
```

_See code: [src/cli/exec.ts](https://github.com/cybergarage/orbit/blob/v0.6.0/src/apps/cli/exec.ts)_

## `orbit gui`

Start the local Orbit graphical interface

```
USAGE
  $ orbit gui [--anthropic-api-key-env <value>] [--debug] [--execution-policy
    workspace-confirm|unrestricted] [--journal-level file-and-directory-sync|file-sync] [--lang en|ja] [--model <value>]
    [--ollama-host <value>] [--openai-api-key-env <value>] [--provider anthropic|ollama|openai] [--skill-root
    <value>...] [--port <value>]

FLAGS
  --anthropic-api-key-env=<value>  Environment variable name for the Anthropic API key
  --debug                          Enable debug logging
  --execution-policy=<option>      Operation policy; unrestricted still enforces budgets and recording
                                   <options: workspace-confirm|unrestricted>
  --journal-level=<option>         Persistent journal acknowledgement level; unsupported levels fail admission
                                   <options: file-and-directory-sync|file-sync>
  --lang=<option>                  Output language
                                   <options: en|ja>
  --model=<value>                  Model name (overrides workspace setting and provider default)
  --ollama-host=<value>            Ollama host URL
  --openai-api-key-env=<value>     Environment variable name for the OpenAI API key
  --port=<value>                   Loopback port (uses an available port by default)
  --provider=<option>              LLM provider (overrides workspace setting)
                                   <options: anthropic|ollama|openai>
  --skill-root=<value>...          Explicit Skill root ID=DIRECTORY (repeatable); replaces the workspace default

DESCRIPTION
  Start the local Orbit graphical interface
```

_See code: [src/cli/gui.ts](https://github.com/cybergarage/orbit/blob/v0.6.0/src/apps/cli/gui.ts)_

## `orbit help [COMMAND]`

Display help for orbit.

```
USAGE
  $ orbit help [COMMAND...] [-n]

ARGUMENTS
  [COMMAND...]  Command to show help for.

FLAGS
  -n, --nested-commands  Include all nested commands in the output.

DESCRIPTION
  Display help for orbit.
```

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/v6.2.37/src/commands/help.ts)_

## `orbit resume [SESSION]`

Resume a saved interactive session

```
USAGE
  $ orbit resume [SESSION] [--anthropic-api-key-env <value>] [--debug] [--execution-policy
    workspace-confirm|unrestricted] [--journal-level file-and-directory-sync|file-sync] [--lang en|ja] [--model <value>]
    [--ollama-host <value>] [--openai-api-key-env <value>] [--provider anthropic|ollama|openai] [--skill-root
    <value>...] [--all] [--last]

ARGUMENTS
  [SESSION]  Exact ID of the saved session to resume

FLAGS
  --all                            Search all working directories (requires --last)
  --anthropic-api-key-env=<value>  Environment variable name for the Anthropic API key
  --debug                          Enable debug logging
  --execution-policy=<option>      Operation policy; unrestricted still enforces budgets and recording
                                   <options: workspace-confirm|unrestricted>
  --journal-level=<option>         Persistent journal acknowledgement level; unsupported levels fail admission
                                   <options: file-and-directory-sync|file-sync>
  --lang=<option>                  Output language
                                   <options: en|ja>
  --last                           Resume the most recently updated eligible session
  --model=<value>                  Model name (overrides workspace setting and provider default)
  --ollama-host=<value>            Ollama host URL
  --openai-api-key-env=<value>     Environment variable name for the OpenAI API key
  --provider=<option>              LLM provider (overrides workspace setting)
                                   <options: anthropic|ollama|openai>
  --skill-root=<value>...          Explicit Skill root ID=DIRECTORY (repeatable); replaces the workspace default

DESCRIPTION
  Resume a saved interactive session

EXAMPLES
  $ orbit resume --last

  $ orbit resume <SESSION_ID>

  $ orbit resume --last --all
```

_See code: [src/cli/resume.ts](https://github.com/cybergarage/orbit/blob/v0.6.0/src/apps/cli/resume.ts)_

## `orbit session [SESSION]`

Show saved session information

```
USAGE
  $ orbit session [SESSION] [--all] [--id-only] [--json] [--last]

ARGUMENTS
  [SESSION]  Exact ID of the saved session to inspect

FLAGS
  --all      Search all working directories (requires --last)
  --id-only  Print only the full session ID
  --json     Print the session summary as JSON
  --last     Inspect the most recently updated eligible session

DESCRIPTION
  Show saved session information

EXAMPLES
  $ orbit session <SESSION_ID>

  $ orbit session --last

  $ orbit session --last --all --id-only

  $ orbit session <SESSION_ID> --json
```

_See code: [src/cli/session.ts](https://github.com/cybergarage/orbit/blob/v0.6.0/src/apps/cli/session.ts)_

## `orbit skills`

List bounded Skill metadata and source digests without running a model

```
USAGE
  $ orbit skills [--json] [--skill-root <value>...]

FLAGS
  --json                   Print JSON metadata
  --skill-root=<value>...  Explicit root ID=DIRECTORY; replaces the workspace default

DESCRIPTION
  List bounded Skill metadata and source digests without running a model
```

_See code: [src/cli/skills.ts](https://github.com/cybergarage/orbit/blob/v0.6.0/src/apps/cli/skills.ts)_

## `orbit storage ACTION [SESSION]`

Inspect storage or initialize, resume and recover it under external offline exclusion

```
USAGE
  $ orbit storage ACTION [SESSION] [--exclusive-storage-control] [--journal-root <value>]
    [--restarters-disabled] [--reviewed-artifacts <value>] [--session-root <value>] [--writers-stopped]

ARGUMENTS
  ACTION     (initialize|inspect|recover|resume|migrate-transcript|resume-transcript)
  [SESSION]  Exact session ID for inspection, recovery or transcript migration

FLAGS
  --exclusive-storage-control   Confirm external exclusive administration of both roots
  --journal-root=<value>        Matching execution journal root
  --restarters-disabled         Confirm automatic restarters remain disabled through interruption
  --reviewed-artifacts=<value>  JSON file mapping reviewed artifact absolute paths to SHA-256 values; resume only
  --session-root=<value>        Session repository root
  --writers-stopped             Confirm all current and old writer processes are stopped

DESCRIPTION
  Inspect storage or initialize, resume and recover it under external offline exclusion
```

_See code: [src/cli/storage.ts](https://github.com/cybergarage/orbit/blob/v0.6.0/src/apps/cli/storage.ts)_
<!-- commandsstop -->
