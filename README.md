# Orbit

Orbit is a TypeScript agent framework for building agent applications. It
provides model and tool execution, persistent conversations, and Run lifecycle
management for desktop agents, messaging agents, and automated workflows.
The included `orbit` CLI and local web GUI use the same reusable framework.

**0.6 is an early application-development release.** Orbit supplies the runtime;
your application supplies channel integrations, scheduling, memory policy,
authentication and notification delivery. See [capabilities and boundaries](docs/building-agents.md).

## Install

Requires Node.js **20.19 or newer** and npm. The library uses native ESM and runs
in a trusted Node.js process, not a browser renderer.

As an application dependency:

```sh
npm install --save-exact @cybergarage/orbit@0.6.1
```

Or as a command-line application:

```sh
npm install --global @cybergarage/orbit@0.6.1
orbit --help
```

## Build your first agent

Start with the [persistent agent example](examples/agent/README.md).
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

Use the [application guide](docs/building-agents.md) for conversation routing,
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
| Build an application from scratch | [Agent application guide](docs/building-agents.md) and [runnable example](examples/agent/README.md) |
| Use the CLI | [CLI Reference](docs/cli.md) |
| Integrate a desktop/web frontend | [GUI Integration](docs/gui-integration.md) |
| Configure models, tools and MCP | [Settings](docs/settings.md) and [Tools](docs/tools.md) |
| Understand approval, budgets and failures | [Managed Execution](docs/execution.md) |
| Operate persistent data | [Sessions](docs/session.md), [Storage](docs/session-storage.md) and [Logs](docs/logging.md) |
| Add explicit Skills or context budgets | [Skills](docs/skills.md) and [Compaction](docs/context-compaction.md) |
| Understand versions and planned milestones | [Versioning](docs/versioning.md) |
| Contribute or publish a release | [Development](docs/development.md) |
| Explore implementation and design evidence | [Documentation map](docs/README.md) and [Architecture](docs/architecture.md) |

Licensed under [Apache-2.0](LICENSE).
