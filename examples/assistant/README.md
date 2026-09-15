# Persistent assistant example

A small Node.js host for `@cybergarage/orbit`: persistent conversations, model
execution, operation approval, cancellation, logs and restart/resume. The terminal
is one replaceable application surface. This is a starting point for your own
assistant, not a messaging gateway or a complete autonomous product.

## Install and build

Use Node.js 20.19 or newer and npm. From a checkout of the release:

```sh
git clone --branch v0.6.0 https://github.com/cybergarage/orbit.git
cd orbit/examples/assistant
npm install
npm run build
```

You can copy this directory to a separate repository. It depends on the public
package, never on Orbit's source files. Keep the generated `package-lock.json`
in your application repository and use `npm ci` thereafter.

## Initialize storage once, while offline

The defaults are `./workspace` for tool access and `./.assistant` for sessions,
execution journals and logs, relative to the directory where you run the app.
Set `ASSISTANT_WORKSPACE` and `ASSISTANT_DATA_DIR` to use other paths. Use the
same values for setup, start and resume. Exclude both directories from Git.

For a fresh installation, before starting any host:

```sh
npm run setup -- --offline
```

`--offline` asserts that **all** writers are stopped, automatic restarters are
disabled, and you control these roots exclusively. Do not run setup on every
request or while another process is using these directories. Existing or
interrupted storage needs the [storage maintenance procedure](../../docs/session-storage.md).
The example retains Orbit's default durability level and reports unsupported
filesystem synchronization rather than silently weakening it.

## Try it without an API key

```sh
npm start -- --demo
```

Try `hello`, then `write-demo`. The latter displays a real approval preview for
writing `workspace/demo-note.txt`; `n` denies it and `y` permits that operation.
`wait-demo` simulates a slow model; Ctrl+C requests cancellation and shutdown.
`/exit` closes normally. Copy the printed Session ID to resume later:

```sh
npm start -- --demo --resume SESSION_ID
```

The demo adapter is deterministic and makes no LLM requests. The host refuses
inherited MCP server configuration in demo mode. If necessary, use a workspace
in a fresh temporary directory outside configured workspace ancestors. The
storage, built-in tool, permission, Agent and Thread implementations are real.

## Connect a real model

Set `OPENAI_API_KEY` through your shell or secret manager and set `ORBIT_MODEL`
to a model available to your account. Then run:

```sh
npm start
```

Live mode enables the coding tool profile. Filesystem writes and commands need
approval. Agent settings can still inherit from ancestor `.orbit` workspaces,
including MCP configuration. Review those sources before opening a workspace.
The host uses explicit empty system contexts; see `host.ts` to enable trusted
`ORBIT.md` / `AGENTS.md` loading. Resume a demo session in demo mode; create a
new session when switching to the real model.

For Anthropic or Ollama, adapt the explicit settings in `host.ts` using the
[provider guide](../../docs/settings.md). This example does not automatically
select a model or configure a provider account.

## Files to adapt

| File | Responsibility |
| --- | --- |
| `src/host.ts` | Storage paths, provider configuration, service lifetime, run observation and bound approval replies |
| `src/chat.ts` | Local user interaction and Session selection |
| `src/setup.ts` | Explicit offline storage initialization |
| `src/demo-model.ts` | Credential-free model adapter for development |
| `src/smoke.ts` | Isolated integration test through the installed package |

Run `npm test` after building. It checks normal completion, request-ID retry,
slash commands, approval and denial, cancellation, logs, and restart/resume in
temporary storage. Automatic approvals occur only in this isolated test.

The example supports one local user and serial input. It has no delivery queue,
remote authentication, multi-tenant storage, long-term memory retrieval, or
scheduler. Add those at the host boundary described in
[Building an assistant](../../docs/building-assistants.md). Do not expose the
terminal's approval callback directly to untrusted clients. This test does not
validate live provider behavior, production recovery, or power-loss durability.
