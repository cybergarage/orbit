orbit
=================

An agentic CLI for crafting and publishing content workflows.


[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![Version](https://img.shields.io/npm/v/orbit.svg)](https://npmjs.org/package/orbit)
[![Downloads/week](https://img.shields.io/npm/dw/orbit.svg)](https://npmjs.org/package/orbit)


# Documentation

* [Development](docs/development.md)
* [Settings](docs/settings.md)
* [Interactive Commands](docs/interactive.md)
* [Local GUI](docs/gui.md)
* [GUI Integration](docs/gui-integration.md)

<!-- toc -->
* [Documentation](#documentation)
* [Usage](#usage)
* [Commands](#commands)
<!-- tocstop -->
# Usage
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
# Commands
<!-- commands -->
* [`orbit exec [PROMPT]`](#orbit-exec-prompt)
* [`orbit gui`](#orbit-gui)
* [`orbit help [COMMAND]`](#orbit-help-command)
* [`orbit plugins`](#orbit-plugins)
* [`orbit plugins add PLUGIN`](#orbit-plugins-add-plugin)
* [`orbit plugins:inspect PLUGIN...`](#orbit-pluginsinspect-plugin)
* [`orbit plugins install PLUGIN`](#orbit-plugins-install-plugin)
* [`orbit plugins link PATH`](#orbit-plugins-link-path)
* [`orbit plugins remove [PLUGIN]`](#orbit-plugins-remove-plugin)
* [`orbit plugins reset`](#orbit-plugins-reset)
* [`orbit plugins uninstall [PLUGIN]`](#orbit-plugins-uninstall-plugin)
* [`orbit plugins unlink [PLUGIN]`](#orbit-plugins-unlink-plugin)
* [`orbit plugins update`](#orbit-plugins-update)

## `orbit exec [PROMPT]`

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

## `orbit gui`

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

## `orbit plugins`

List installed plugins.

```
USAGE
  $ orbit plugins [--json] [--core]

FLAGS
  --core  Show core plugins.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List installed plugins.

EXAMPLES
  $ orbit plugins
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.56/src/commands/plugins/index.ts)_

## `orbit plugins add PLUGIN`

Installs a plugin into orbit.

```
USAGE
  $ orbit plugins add PLUGIN... [--json] [-f] [-h] [-s | -v]

ARGUMENTS
  PLUGIN...  Plugin to install.

FLAGS
  -f, --force    Force npm to fetch remote resources even if a local copy exists on disk.
  -h, --help     Show CLI help.
  -s, --silent   Silences npm output.
  -v, --verbose  Show verbose npm output.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Installs a plugin into orbit.

  Uses npm to install plugins.

  Installation of a user-installed plugin will override a core plugin.

  Use the ORBIT_NPM_LOG_LEVEL environment variable to set the npm loglevel.
  Use the ORBIT_NPM_REGISTRY environment variable to set the npm registry.

ALIASES
  $ orbit plugins add

EXAMPLES
  Install a plugin from npm registry.

    $ orbit plugins add myplugin

  Install a plugin from a github url.

    $ orbit plugins add https://github.com/someuser/someplugin

  Install a plugin from a github slug.

    $ orbit plugins add someuser/someplugin
```

## `orbit plugins:inspect PLUGIN...`

Displays installation properties of a plugin.

```
USAGE
  $ orbit plugins inspect PLUGIN...

ARGUMENTS
  PLUGIN...  [default: .] Plugin to inspect.

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Displays installation properties of a plugin.

EXAMPLES
  $ orbit plugins inspect myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.56/src/commands/plugins/inspect.ts)_

## `orbit plugins install PLUGIN`

Installs a plugin into orbit.

```
USAGE
  $ orbit plugins install PLUGIN... [--json] [-f] [-h] [-s | -v]

ARGUMENTS
  PLUGIN...  Plugin to install.

FLAGS
  -f, --force    Force npm to fetch remote resources even if a local copy exists on disk.
  -h, --help     Show CLI help.
  -s, --silent   Silences npm output.
  -v, --verbose  Show verbose npm output.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Installs a plugin into orbit.

  Uses npm to install plugins.

  Installation of a user-installed plugin will override a core plugin.

  Use the ORBIT_NPM_LOG_LEVEL environment variable to set the npm loglevel.
  Use the ORBIT_NPM_REGISTRY environment variable to set the npm registry.

ALIASES
  $ orbit plugins add

EXAMPLES
  Install a plugin from npm registry.

    $ orbit plugins install myplugin

  Install a plugin from a github url.

    $ orbit plugins install https://github.com/someuser/someplugin

  Install a plugin from a github slug.

    $ orbit plugins install someuser/someplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.56/src/commands/plugins/install.ts)_

## `orbit plugins link PATH`

Links a plugin into the CLI for development.

```
USAGE
  $ orbit plugins link PATH [-h] [--install] [-v]

ARGUMENTS
  PATH  [default: .] path to plugin

FLAGS
  -h, --help          Show CLI help.
  -v, --verbose
      --[no-]install  Install dependencies after linking the plugin.

DESCRIPTION
  Links a plugin into the CLI for development.

  Installation of a linked plugin will override a user-installed or core plugin.

  e.g. If you have a user-installed or core plugin that has a 'hello' command, installing a linked plugin with a 'hello'
  command will override the user-installed or core plugin implementation. This is useful for development work.


EXAMPLES
  $ orbit plugins link myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.56/src/commands/plugins/link.ts)_

## `orbit plugins remove [PLUGIN]`

Removes a plugin from the CLI.

```
USAGE
  $ orbit plugins remove [PLUGIN...] [-h] [-v]

ARGUMENTS
  [PLUGIN...]  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ orbit plugins unlink
  $ orbit plugins remove

EXAMPLES
  $ orbit plugins remove myplugin
```

## `orbit plugins reset`

Remove all user-installed and linked plugins.

```
USAGE
  $ orbit plugins reset [--hard] [--reinstall]

FLAGS
  --hard       Delete node_modules and package manager related files in addition to uninstalling plugins.
  --reinstall  Reinstall all plugins after uninstalling.
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.56/src/commands/plugins/reset.ts)_

## `orbit plugins uninstall [PLUGIN]`

Removes a plugin from the CLI.

```
USAGE
  $ orbit plugins uninstall [PLUGIN...] [-h] [-v]

ARGUMENTS
  [PLUGIN...]  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ orbit plugins unlink
  $ orbit plugins remove

EXAMPLES
  $ orbit plugins uninstall myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.56/src/commands/plugins/uninstall.ts)_

## `orbit plugins unlink [PLUGIN]`

Removes a plugin from the CLI.

```
USAGE
  $ orbit plugins unlink [PLUGIN...] [-h] [-v]

ARGUMENTS
  [PLUGIN...]  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ orbit plugins unlink
  $ orbit plugins remove

EXAMPLES
  $ orbit plugins unlink myplugin
```

## `orbit plugins update`

Update installed plugins.

```
USAGE
  $ orbit plugins update [-h] [-v]

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Update installed plugins.
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.56/src/commands/plugins/update.ts)_
<!-- commandsstop -->
