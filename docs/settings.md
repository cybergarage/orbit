# Settings

Orbit loads workspace settings from `settings.json`.

## File locations

Orbit checks workspace directories from the shallowest parent to the current workspace. In each workspace, it prefers:

1. `.orbit/settings.json`
2. `settings.json`

If both files exist in the same workspace, `.orbit/settings.json` is used.

## Example

```json
{
  "provider": "openai",
  "model": "gpt-4o",
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

## Merge behavior

Settings are merged from parent workspaces to deeper workspaces. Deeper workspace settings override shallower settings. Nested provider and MCP server settings are merged by provider or server name.

CLI flags are applied on top of workspace settings when supported by the command.
