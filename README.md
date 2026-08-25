![](https://img.shields.io/badge/status-Work%20In%20Progress-8A2BE2)

# orbit

Orbit is an experimental project for exploring and understanding how AI agents
work.

## Documentation

* [Development](docs/development.md)
* [Architecture Decisions](docs/adr/README.md)
* [Settings](docs/settings.md)
* [Coding Tools](docs/tools.md)
* [Sessions](docs/session.md)
* [Session logs](docs/logging.md)
* [Interactive Commands](docs/interactive.md)
* [Local GUI](docs/gui.md)
* [GUI Integration](docs/gui-integration.md)

<!-- toc -->
* [Documentation](#documentation)
* [Usage](#usage)
* [Commands](#commands)
<!-- tocstop -->
## Usage
<!-- usage -->
```sh-session
$ npm install -g orbit
$ orbit COMMAND
running command...
$ orbit (--version)
orbit/0.0.0 darwin-arm64 node-v26.5.0
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

### `orbit delete SESSION`

Permanently delete a saved session

```
USAGE
  $ orbit delete SESSION [--force]

ARGUMENTS
  SESSION  ID of the saved session to delete

FLAGS
  --force  Delete without asking for confirmation

DESCRIPTION
  Permanently delete a saved session

EXAMPLES
  $ orbit delete <SESSION_ID>

  $ orbit delete <SESSION_ID> --force
```

_See code: [src/cli/delete.ts](https://github.com/cybergarage/orbit/blob/v0.0.0/src/cli/delete.ts)_

### `orbit exec [PROMPT]`

Send a prompt to the agent and print the response

```
USAGE
  $ orbit exec [PROMPT] [--anthropic-api-key-env <value>] [--debug] [--lang en|ja] [--model <value>]
    [--ollama-host <value>] [--openai-api-key-env <value>] [--provider anthropic|ollama|openai]

ARGUMENTS
  [PROMPT]  Prompt to send to the agent

FLAGS
  --anthropic-api-key-env=<value>  Environment variable name for the Anthropic API key
  --debug                          Enable debug logging
  --lang=<option>                  Output language
                                   <options: en|ja>
  --model=<value>                  Model name (overrides workspace setting and provider default)
  --ollama-host=<value>            Ollama host URL
  --openai-api-key-env=<value>     Environment variable name for the OpenAI API key
  --provider=<option>              LLM provider (overrides workspace setting)
                                   <options: anthropic|ollama|openai>

DESCRIPTION
  Send a prompt to the agent and print the response

EXAMPLES
  $ orbit exec "Write a haiku about TypeScript"

  echo "Write a haiku about TypeScript" | orbit exec
```

_See code: [src/cli/exec.ts](https://github.com/cybergarage/orbit/blob/v0.0.0/src/cli/exec.ts)_

### `orbit gui`

Start the local Orbit graphical interface

```
USAGE
  $ orbit gui [--anthropic-api-key-env <value>] [--debug] [--lang en|ja] [--model <value>] [--ollama-host
    <value>] [--openai-api-key-env <value>] [--provider anthropic|ollama|openai] [--port <value>]

FLAGS
  --anthropic-api-key-env=<value>  Environment variable name for the Anthropic API key
  --debug                          Enable debug logging
  --lang=<option>                  Output language
                                   <options: en|ja>
  --model=<value>                  Model name (overrides workspace setting and provider default)
  --ollama-host=<value>            Ollama host URL
  --openai-api-key-env=<value>     Environment variable name for the OpenAI API key
  --port=<value>                   Loopback port (uses an available port by default)
  --provider=<option>              LLM provider (overrides workspace setting)
                                   <options: anthropic|ollama|openai>

DESCRIPTION
  Start the local Orbit graphical interface
```

_See code: [src/cli/gui.ts](https://github.com/cybergarage/orbit/blob/v0.0.0/src/cli/gui.ts)_

### `orbit help [COMMAND]`

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

### `orbit resume [SESSION]`

Resume a saved interactive session

```
USAGE
  $ orbit resume [SESSION] [--anthropic-api-key-env <value>] [--debug] [--lang en|ja] [--model <value>]
    [--ollama-host <value>] [--openai-api-key-env <value>] [--provider anthropic|ollama|openai] [--all] [--last]

ARGUMENTS
  [SESSION]  Exact ID of the saved session to resume

FLAGS
  --all                            Search all working directories (requires --last)
  --anthropic-api-key-env=<value>  Environment variable name for the Anthropic API key
  --debug                          Enable debug logging
  --lang=<option>                  Output language
                                   <options: en|ja>
  --last                           Resume the most recently updated eligible session
  --model=<value>                  Model name (overrides workspace setting and provider default)
  --ollama-host=<value>            Ollama host URL
  --openai-api-key-env=<value>     Environment variable name for the OpenAI API key
  --provider=<option>              LLM provider (overrides workspace setting)
                                   <options: anthropic|ollama|openai>

DESCRIPTION
  Resume a saved interactive session

EXAMPLES
  $ orbit resume --last

  $ orbit resume <SESSION_ID>

  $ orbit resume --last --all
```

_See code: [src/cli/resume.ts](https://github.com/cybergarage/orbit/blob/v0.0.0/src/cli/resume.ts)_
<!-- commandsstop -->
