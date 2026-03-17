scribemuse
=================

An agentic CLI for crafting and publishing content workflows.


[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![Version](https://img.shields.io/npm/v/scribemuse.svg)](https://npmjs.org/package/scribemuse)
[![Downloads/week](https://img.shields.io/npm/dw/scribemuse.svg)](https://npmjs.org/package/scribemuse)


<!-- toc -->
* [Usage](#usage)
* [Commands](#commands)
<!-- tocstop -->
# Usage
<!-- usage -->
```sh-session
$ npm install -g scribemuse
$ scribemuse COMMAND
running command...
$ scribemuse (--version)
scribemuse/0.0.0 darwin-arm64 node-v25.6.1
$ scribemuse --help [COMMAND]
USAGE
  $ scribemuse COMMAND
...
```
<!-- usagestop -->
# Commands
<!-- commands -->
* [`scribemuse hello PERSON`](#scribemuse-hello-person)
* [`scribemuse hello world`](#scribemuse-hello-world)
* [`scribemuse help [COMMAND]`](#scribemuse-help-command)
* [`scribemuse plugins`](#scribemuse-plugins)
* [`scribemuse plugins add PLUGIN`](#scribemuse-plugins-add-plugin)
* [`scribemuse plugins:inspect PLUGIN...`](#scribemuse-pluginsinspect-plugin)
* [`scribemuse plugins install PLUGIN`](#scribemuse-plugins-install-plugin)
* [`scribemuse plugins link PATH`](#scribemuse-plugins-link-path)
* [`scribemuse plugins remove [PLUGIN]`](#scribemuse-plugins-remove-plugin)
* [`scribemuse plugins reset`](#scribemuse-plugins-reset)
* [`scribemuse plugins uninstall [PLUGIN]`](#scribemuse-plugins-uninstall-plugin)
* [`scribemuse plugins unlink [PLUGIN]`](#scribemuse-plugins-unlink-plugin)
* [`scribemuse plugins update`](#scribemuse-plugins-update)

## `scribemuse hello PERSON`

Say hello

```
USAGE
  $ scribemuse hello PERSON -f <value>

ARGUMENTS
  PERSON  Person to say hello to

FLAGS
  -f, --from=<value>  (required) Who is saying hello

DESCRIPTION
  Say hello

EXAMPLES
  $ scribemuse hello friend --from oclif
  hello friend from oclif! (./src/apps/cli/hello/index.ts)
```

_See code: [src/apps/cli/hello/index.ts](https://github.com/cybergarage/scribemuse/blob/v0.0.0/src/apps/cli/hello/index.ts)_

## `scribemuse hello world`

Say hello world

```
USAGE
  $ scribemuse hello world

DESCRIPTION
  Say hello world

EXAMPLES
  $ scribemuse hello world
  hello world! (./src/apps/cli/hello/world.ts)
```

_See code: [src/apps/cli/hello/world.ts](https://github.com/cybergarage/scribemuse/blob/v0.0.0/src/apps/cli/hello/world.ts)_

## `scribemuse help [COMMAND]`

Display help for scribemuse.

```
USAGE
  $ scribemuse help [COMMAND...] [-n]

ARGUMENTS
  [COMMAND...]  Command to show help for.

FLAGS
  -n, --nested-commands  Include all nested commands in the output.

DESCRIPTION
  Display help for scribemuse.
```

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/v6.2.37/src/commands/help.ts)_

## `scribemuse plugins`

List installed plugins.

```
USAGE
  $ scribemuse plugins [--json] [--core]

FLAGS
  --core  Show core plugins.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List installed plugins.

EXAMPLES
  $ scribemuse plugins
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.56/src/commands/plugins/index.ts)_

## `scribemuse plugins add PLUGIN`

Installs a plugin into scribemuse.

```
USAGE
  $ scribemuse plugins add PLUGIN... [--json] [-f] [-h] [-s | -v]

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
  Installs a plugin into scribemuse.

  Uses npm to install plugins.

  Installation of a user-installed plugin will override a core plugin.

  Use the SCRIBEMUSE_NPM_LOG_LEVEL environment variable to set the npm loglevel.
  Use the SCRIBEMUSE_NPM_REGISTRY environment variable to set the npm registry.

ALIASES
  $ scribemuse plugins add

EXAMPLES
  Install a plugin from npm registry.

    $ scribemuse plugins add myplugin

  Install a plugin from a github url.

    $ scribemuse plugins add https://github.com/someuser/someplugin

  Install a plugin from a github slug.

    $ scribemuse plugins add someuser/someplugin
```

## `scribemuse plugins:inspect PLUGIN...`

Displays installation properties of a plugin.

```
USAGE
  $ scribemuse plugins inspect PLUGIN...

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
  $ scribemuse plugins inspect myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.56/src/commands/plugins/inspect.ts)_

## `scribemuse plugins install PLUGIN`

Installs a plugin into scribemuse.

```
USAGE
  $ scribemuse plugins install PLUGIN... [--json] [-f] [-h] [-s | -v]

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
  Installs a plugin into scribemuse.

  Uses npm to install plugins.

  Installation of a user-installed plugin will override a core plugin.

  Use the SCRIBEMUSE_NPM_LOG_LEVEL environment variable to set the npm loglevel.
  Use the SCRIBEMUSE_NPM_REGISTRY environment variable to set the npm registry.

ALIASES
  $ scribemuse plugins add

EXAMPLES
  Install a plugin from npm registry.

    $ scribemuse plugins install myplugin

  Install a plugin from a github url.

    $ scribemuse plugins install https://github.com/someuser/someplugin

  Install a plugin from a github slug.

    $ scribemuse plugins install someuser/someplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.56/src/commands/plugins/install.ts)_

## `scribemuse plugins link PATH`

Links a plugin into the CLI for development.

```
USAGE
  $ scribemuse plugins link PATH [-h] [--install] [-v]

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
  $ scribemuse plugins link myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.56/src/commands/plugins/link.ts)_

## `scribemuse plugins remove [PLUGIN]`

Removes a plugin from the CLI.

```
USAGE
  $ scribemuse plugins remove [PLUGIN...] [-h] [-v]

ARGUMENTS
  [PLUGIN...]  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ scribemuse plugins unlink
  $ scribemuse plugins remove

EXAMPLES
  $ scribemuse plugins remove myplugin
```

## `scribemuse plugins reset`

Remove all user-installed and linked plugins.

```
USAGE
  $ scribemuse plugins reset [--hard] [--reinstall]

FLAGS
  --hard       Delete node_modules and package manager related files in addition to uninstalling plugins.
  --reinstall  Reinstall all plugins after uninstalling.
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.56/src/commands/plugins/reset.ts)_

## `scribemuse plugins uninstall [PLUGIN]`

Removes a plugin from the CLI.

```
USAGE
  $ scribemuse plugins uninstall [PLUGIN...] [-h] [-v]

ARGUMENTS
  [PLUGIN...]  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ scribemuse plugins unlink
  $ scribemuse plugins remove

EXAMPLES
  $ scribemuse plugins uninstall myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.56/src/commands/plugins/uninstall.ts)_

## `scribemuse plugins unlink [PLUGIN]`

Removes a plugin from the CLI.

```
USAGE
  $ scribemuse plugins unlink [PLUGIN...] [-h] [-v]

ARGUMENTS
  [PLUGIN...]  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ scribemuse plugins unlink
  $ scribemuse plugins remove

EXAMPLES
  $ scribemuse plugins unlink myplugin
```

## `scribemuse plugins update`

Update installed plugins.

```
USAGE
  $ scribemuse plugins update [-h] [-v]

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Update installed plugins.
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.56/src/commands/plugins/update.ts)_
<!-- commandsstop -->
