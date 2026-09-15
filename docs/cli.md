# CLI Reference

Orbit includes a CLI built with oclif. For application development, start with
[Building an agent application](building-agents.md). For interactive slash
commands, see [Interactive Commands](interactive.md).

The Usage and Commands sections below are generated from command metadata.
Run `npm run build` followed by `npm run docs:commands` to update them.

## Usage
<!-- usage -->
```sh-session
$ npm install -g @cybergarage/orbit
$ orbit COMMAND
running command...
$ orbit (--version)
@cybergarage/orbit/0.6.1 darwin-arm64 node-v26.5.0
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

_See code: [src/cli/delete.ts](https://github.com/cybergarage/orbit/blob/v0.6.1/src/apps/cli/delete.ts)_

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

_See code: [src/cli/exec.ts](https://github.com/cybergarage/orbit/blob/v0.6.1/src/apps/cli/exec.ts)_

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

_See code: [src/cli/gui.ts](https://github.com/cybergarage/orbit/blob/v0.6.1/src/apps/cli/gui.ts)_

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

_See code: [src/cli/resume.ts](https://github.com/cybergarage/orbit/blob/v0.6.1/src/apps/cli/resume.ts)_

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

_See code: [src/cli/session.ts](https://github.com/cybergarage/orbit/blob/v0.6.1/src/apps/cli/session.ts)_

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

_See code: [src/cli/skills.ts](https://github.com/cybergarage/orbit/blob/v0.6.1/src/apps/cli/skills.ts)_

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

_See code: [src/cli/storage.ts](https://github.com/cybergarage/orbit/blob/v0.6.1/src/apps/cli/storage.ts)_
<!-- commandsstop -->
