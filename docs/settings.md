# Settings

Orbit loads workspace settings from `settings.json`.

## File locations

Orbit checks workspace directories from the shallowest parent to the current workspace. In each workspace, it prefers:

1. `.orbit/settings.json`
2. `settings.json`

If both files exist in the same workspace, `.orbit/settings.json` is used.

Orbit discovers workspaces by walking from the current directory to the filesystem root and treating each directory that contains an `.orbit` directory as a workspace. As a result, when the current directory is below the user's home directory and `~/.orbit` exists, `~/.orbit/settings.json` is loaded as the shallowest workspace setting. The home directory is not searched separately, so this file is not loaded when the current directory is outside the home directory hierarchy.

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
2. The Orbit default model (`llama3.1`), if it is installed. An installed
   `:latest` tag matches the untagged default.
3. The first installed model returned by Ollama whose model metadata reports
   the `tools` capability.

Orbit does not pull models automatically. An explicit model that is not
installed produces an error instead of silently selecting another model. If
there is no explicit model, startup also fails when Ollama has no models or no
installed fallback model reports tool support. This discovery applies to the
CLI and GUI startup paths; callers that construct `Agent` or a model adapter
directly remain responsible for choosing a model.

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
profile. See [Coding Tools](tools.md) for schemas and full-access behavior.

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
