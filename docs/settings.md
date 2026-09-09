# Settings

Orbit loads workspace settings from `settings.json`.

## File locations

Orbit checks workspace directories from the shallowest parent to the current workspace. In each workspace, it prefers:

1. `.orbit/settings.json`
2. `settings.json`

If both files exist in the same workspace, `.orbit/settings.json` is used.

Orbit discovers workspaces by walking from the current directory to the filesystem root and treating each directory that contains an `.orbit` directory as a workspace. As a result, when the current directory is below the user's home directory and `~/.orbit` exists, `~/.orbit/settings.json` is loaded as the shallowest workspace setting. The home directory is not searched separately, so this file is not loaded when the current directory is outside the home directory hierarchy.

Workspace discovery requires `.orbit` to resolve to a directory. A regular file
with that name, including a symbolic link to a regular file, is not a workspace
marker. Directory links retain their existing behavior. Both synchronous and
asynchronous loaders use this condition and continue searching ancestors.

## Example

```json
{
  "provider": "openai",
  "model": "gpt-4o",
  "tools": {
    "profile": "coding",
    "exclude": [],
    "include": []
  },
  "providers": {
    "openai": {
      "apiKey": "sk-..."
    },
    "anthropic": {
      "apiKeyEnv": "ANTHROPIC_API_KEY"
    },
    "ollama": {
      "host": "http://localhost:11434"
    }
  },
  "mcp": {
    "servers": {
      "filesystem": {
        "command": "mcp-filesystem",
        "args": ["--root", "."],
        "env": {
          "DEBUG": "1"
        }
      }
    }
  }
}
```

## Top-level fields

- `provider`: LLM provider. Valid values are `anthropic`, `ollama`, and `openai`.
- `model`: Model name.
- `providers`: Provider-specific connection settings.
- `mcp`: MCP server settings.
- `tools`: Built-in coding-tool profile and per-tool additions or exclusions.

## Provider settings

OpenAI and Anthropic support direct API keys and API key environment variables:

```json
{
  "providers": {
    "openai": {
      "apiKey": "sk-...",
      "apiKeyEnv": "OPENAI_API_KEY"
    },
    "anthropic": {
      "apiKey": "...",
      "apiKeyEnv": "ANTHROPIC_API_KEY"
    }
  }
}
```

If both `apiKeyEnv` and `apiKey` are set, `apiKeyEnv` takes precedence. Orbit reads the named environment variable and uses that value as the API key. If `apiKeyEnv` is set but the environment variable is missing, Orbit raises an error.

Ollama supports a host setting:

```json
{
  "providers": {
    "ollama": {
      "host": "http://localhost:11434"
    }
  }
}
```

CLI, interactive, resume, and GUI startup query the configured Ollama host for
its installed models. Selection uses this order:

1. An explicit CLI or workspace model, if it is installed.
2. When no model is specified, the first installed model returned by Ollama
   whose model metadata reports the `tools` capability.

Orbit does not pull models automatically. An explicit model that is not
installed produces an error instead of silently selecting another model. If
there is no explicit model, startup fails when Ollama has no models or no
installed model reports tool support. Ollama has no hard-coded default model.
This discovery applies to the CLI and GUI startup paths; callers that construct
`Agent` or a model adapter directly remain responsible for choosing a model.

The reusable library can register another provider through
`registerModelProvider()`. Register it before loading settings that use its
name. Custom providers can use the same `apiKey`, `apiKeyEnv`, and `host`
connection fields; their adapter defines the provider-specific wire protocol.

## MCP settings

MCP servers are configured under `mcp.servers`. Each server name is user-defined.

```json
{
  "mcp": {
    "servers": {
      "filesystem": {
        "command": "mcp-filesystem",
        "args": ["--root", "."],
        "env": {
          "DEBUG": "1"
        }
      }
    }
  }
}
```

- `command`: Required command to start the MCP server.
- `args`: Optional array of string arguments.
- `env`: Optional object of string environment variables.

## Tool settings

Built-in tools are configured under `tools`:

```json
{
  "tools": {
    "profile": "coding",
    "exclude": ["bash"],
    "include": ["read"]
  }
}
```

- `profile`: `coding` enables all built-ins; `none` starts with none.
- `include`: Optional built-in names to add after selecting the profile.
- `exclude`: Optional built-in names to remove after additions.

Valid names are `bash`, `edit`, `glob`, `grep`, `list`, `read`, and `write`.
CLI, interactive, and GUI entry points use `coding` when no profile is set. The
reusable `Agent` library retains an empty default unless its caller selects a
profile. See [Coding Tools](tools.md) for schemas and managed operation policies.

## Merge behavior

Settings are loaded from the shallowest parent workspace to the deepest workspace. A deeper workspace overrides only the properties it defines; properties it omits remain inherited from shallower workspaces. Nested provider and MCP server settings are merged by provider or server name. Tool settings are merged by `profile`, `include`, and `exclude` field.

For example, given these settings in `~/.orbit/settings.json`:

```json
{
  "provider": "openai",
  "model": "gpt-5",
  "providers": {
    "openai": {
      "apiKeyEnv": "OPENAI_API_KEY"
    }
  }
}
```

and these settings in the current workspace's `.orbit/settings.json`:

```json
{
  "model": "gpt-5-mini"
}
```

the effective settings use `openai` with `gpt-5-mini` and retain the `OPENAI_API_KEY` environment variable setting from the home directory.

Within a single workspace, `.orbit/settings.json` and `settings.json` are not merged. If `.orbit/settings.json` exists, it takes precedence and `settings.json` is ignored.

CLI flags are applied on top of workspace settings when supported by the command.

## Connection flags

The `--ollama-host`, `--openai-api-key-env`, and `--anthropic-api-key-env`
flags override the corresponding provider settings for the current command.
API-key flags take an environment variable **name**, never the secret value.
For example, after building the source checkout:

```sh
./bin/run.js exec --provider ollama --model example-model --ollama-host http://127.0.0.1:11435 "Inspect this workspace"
```

`example-model` must name a tool-capable model installed on that Ollama server.
Connection flags also work when the launcher chooses the default command:
interactive mode for a terminal, or `exec` for piped input. The values of
`--execution-policy` and `--journal-level` are likewise kept with their flags;
they are not treated as command names. Omitting the command does not bypass
operation approval, execution budgets, or recording requirements.

## Input budgeting

`contextPolicy` selects disabled compatibility mode or a complete budgeted model
profile. A nearer setting replaces this policy rather than merging individual
counts. Model identity, window, reserves and estimator assumptions are explicit;
see [Input budgets and compaction](context-compaction.md). CLI, GUI and Service
use this same setting. Programmatic Agent/Service options can override it.
