# Vibe Coding Tool Architecture

Date: 2026-08-23

## Purpose

This document investigates the model-provider and tool abstractions used by
Codex and Pi Coding Agent, compares them with Orbit, and proposes an Orbit
architecture and migration plan for coding-agent workflows.

This is a point-in-time engineering investigation. Findings about Codex, Pi,
and Orbit describe verified source behavior. The target architecture, tool
contracts, and migration phases are proposals and have not been implemented.

## Executive summary

Orbit can implement the requested `bash`, `read`, `grep`, `glob`, and `write`
tools with its current `Tool` interface, but doing so directly would preserve
several architectural defects:

- model adapters receive executable tool objects rather than provider-neutral
  tool specifications;
- tool arrays are concatenated and searched linearly, so duplicate names are
  resolved silently by array order;
- all calls from one model response run concurrently, including shell commands
  and file mutations;
- MCP tools are adapted directly into the agent-specific interface rather than
  entering a common registry;
- tool results, updates, cancellation, source identity, and output truncation
  have no explicit common contract;
- model providers are selected by a closed union and a hard-coded factory.

Codex and Pi suggest complementary design choices. Codex has a strongly typed
tool specification, registry, router, runtime, and exposure model. Pi has a
small provider-neutral model protocol, a replaceable provider registry, and a
practical local coding-tool set. Orbit should adopt the same separation of
responsibilities without copying either implementation.

The recommended Orbit coding profile contains seven tools:

| Tool    | Responsibility                                   | Default scheduling |
| ------- | ------------------------------------------------ | ------------------ |
| `bash`  | Execute a command with the configured Bash shell | serial             |
| `read`  | Read a text file by line range                   | parallel           |
| `list`  | List one directory                               | parallel           |
| `grep`  | Search file contents with a regular expression   | parallel           |
| `glob`  | Find paths by glob pattern                       | parallel           |
| `edit`  | Make a validated exact-text replacement          | serial             |
| `write` | Create or completely overwrite a file            | serial             |

The five requested tools remain necessary and feasible. `edit` is also a
minimum practical coding tool because rewriting an entire file for every small
change is token-heavy and error-prone. `list` keeps file reading and directory
enumeration as separate, stable schemas. If compatibility with a five-tool
prompt is required, `read` may temporarily dispatch directories to `list`, but
that should be an alias at the runtime boundary rather than the canonical
contract.

This phase should provide full local filesystem, process, and inherited network
access. It should not implement sandboxing, path allowlists, command approvals,
or network policy. The runtime context and middleware boundary should still be
introduced now so a later policy layer does not require changing every tool.

## Investigation scope and source versions

| System          | Snapshot                                                                                                    | Primary files                                                                                                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex           | commit `7b5b3bd5a2418a5e142449c9ab95e057d14bc98a` from 2026-08-23                                           | `codex-rs/tools/src/tool_executor.rs`, `tool_spec.rs`, `tool_output.rs`; `codex-rs/core/src/tools/registry.rs`, `router.rs`, `spec_plan.rs`; `model-provider/src/provider.rs`; `core/src/client.rs` |
| Pi Coding Agent | `@earendil-works/pi-coding-agent` 0.84.2, commit `a1f955e9f47fd3379b44f4aace65ab916c80519a` from 2026-08-22 | `packages/ai/src/types.ts`, `models.ts`, `compat.ts`; `packages/agent/src/types.ts`, `agent-loop.ts`; `packages/coding-agent/src/core/tools/*`, `sdk.ts`, `system-prompt.ts`                        |
| Orbit           | commit `36dca19d8e5ec575577d970810ce9ba5d5b60c6e`                                                           | `src/core/agent.ts`, `tools/tool.ts`, `mcp.ts`, `models/model.ts`, `models/provider.ts`, `models/factory.ts`, `models/adapters/*`, `settings.ts`, and corresponding tests                           |

Pi's repository was formerly published as `badlogic/pi-mono`; the inspected
endpoint redirects to `earendil-works/pi`. The exact commit above fixes the
source identity independently of the repository rename.

## Codex findings

### Model abstraction

Codex separates configured provider metadata from a session-scoped model
client. `ModelProviderInfo` describes the base URL, authentication environment,
headers, query parameters, retry and timeout values, and supported transport
behavior. The current wire protocol is the OpenAI Responses API.

`ModelProvider` owns provider capabilities, authentication, account behavior,
error mapping, model metadata, and provider-specific adaptation. `ModelClient`
and `ModelClientSession` own actual Responses API HTTP or WebSocket requests and
stream model events for a turn. A provider is therefore more than a credential
lookup, while the request client remains scoped to an active model session.

### Tool abstraction and registration

Codex's `ToolExecutor` ties a runtime executor to its model-visible `ToolSpec`.
The specification can represent a function tool, namespace, deferred tool
search, web search, or free-form tool. An executor reports whether calls can be
parallelized and returns a common `ToolOutput`.

`ToolRegistry` resolves names to a runtime and exposure policy. It rejects
invalid duplicates rather than depending on array order. `ToolRouter` parses
model response items and dispatches them through the registry. A per-turn tool
specification plan combines built-ins, MCP tools, extension tools, dynamic
tools, and hosted model tools through the same routing boundary. Exposure can
be direct, deferred, model-only, code-mode-only, or hidden.

This is the most relevant Codex lesson for Orbit: tool discovery, model
serialization, name resolution, execution, and result projection are separate
stages, even though one registered definition keeps the model specification and
executor from drifting apart.

### Default coding tools

Codex does not normally expose dedicated `read`, `grep`, `glob`, or whole-file
`write` function tools. Its core coding surface is conditional but centers on:

- `exec_command` for shell execution;
- `write_stdin` for continuing an interactive command session;
- `apply_patch` for structured file creation, update, and deletion;
- `view_image` where image inspection is available.

The Codex instructions direct the model to use shell commands such as `rg`,
`rg --files`, and `sed` for exploration. Optional tools include planning,
permission requests, MCP resources, web search, tool search, multi-agent
coordination, plugins, and other host capabilities.

Codex therefore favors a small number of powerful tools. The user's requested
Orbit set is more granular than Codex's default surface, but it can produce
more portable model calls, simpler auditing, and less shell quoting.

## Pi Coding Agent findings

### Model abstraction

Pi defines a provider-neutral protocol in its `ai` package:

- `Model` is model metadata including provider, API protocol, endpoint, token
  limits, modalities, cost, and compatibility data;
- `Context` contains the system prompt, messages, and model-visible tools;
- `Tool` contains a name, description, and TypeBox input schema;
- tool calls and tool-result messages preserve call ID, tool name, content,
  details, usage, and error state;
- streaming emits normalized start, text, thinking, tool-call, completion, and
  error events.

A `Provider` owns its model catalog, authentication, filtering, and streaming
implementation. `Models` is a mutable registry that can add and remove
providers and delegate requests without changing the agent loop. This is more
open than Orbit's current provider union and factory switch.

### Tool abstraction and execution

Pi's agent package extends the protocol-level tool specification with an
executor. An `AgentTool` validates arguments and executes with a call ID,
`AbortSignal`, and partial-result update callback. The agent loop supports
before- and after-call hooks, turns thrown failures into tool-result messages,
and can schedule tool calls sequentially or concurrently.

Pi Coding Agent adds `ToolDefinition`, which includes rendering and prompt
metadata around the runtime tool. Local operations such as file access and
process execution are injectable, allowing the same model-facing tool to use a
local, container, SSH, or test backend.

### Default and available coding tools

Pi's default coding tools are:

- `read`;
- `bash`;
- `edit`;
- `write`.

It also implements `grep`, `find`, and `ls`. Its `find` is the semantic
equivalent of the requested `glob`, while `ls` is responsible for directory
enumeration. Pi's read-only profile is `read`, `grep`, `find`, and `ls`.

Pi's Bash tool supports streamed updates, cancellation, optional timeout, output
truncation, process-tree cleanup, an injectable execution operation, and a
configurable shell. On Windows it locates Git Bash or another `bash.exe`; on
Unix it prefers Bash and can fall back to `sh`.

## Default-tool comparison

| Required capability | Codex default approach             | Pi available tool | Proposed Orbit tool |
| ------------------- | ---------------------------------- | ----------------- | ------------------- |
| shell execution     | `exec_command` and `write_stdin`   | `bash`            | `bash`              |
| file read           | shell commands                     | `read`            | `read`              |
| directory list      | shell commands                     | `ls`              | `list`              |
| regex search        | shell, normally `rg`               | `grep`            | `grep`              |
| glob search         | shell, normally `rg --files`       | `find`            | `glob`              |
| exact edit          | `apply_patch`                      | `edit`            | `edit`              |
| complete overwrite  | `apply_patch` or shell redirection | `write`           | `write`             |

The names differ less than the execution philosophy. Codex uses shell and patch
as a compact general-purpose surface. Pi offers provider-neutral JSON-schema
tools that can be individually enabled. Orbit should begin with explicit tools
because its three current providers already support ordinary function calling.
A free-form patch tool can be added later only for providers that support it
well.

## Current Orbit architecture

### What already works

Orbit already has useful foundations:

- `Tool<Input, Output>` stores a name, description, Zod schema, and asynchronous
  handler;
- `Tool.invoke()` validates local input through Zod;
- `Agent` accepts constructor tools and per-invocation tools;
- every model adapter converts the same `AgentTool` metadata into its provider
  tool schema;
- model tool calls use a provider-neutral ID, name, and input shape;
- MCP tools are namespaced as `server__tool` and adapted into `AgentTool`;
- tool-call and tool-result messages preserve call correlation;
- cancellation and diagnostic events are already present at the agent level.

The requested five tools could therefore be implemented as ordinary `Tool`
instances without changing a model adapter.

### Architectural gaps

That direct implementation is not sufficient for a durable coding-agent API.

1. **Specification and execution are coupled at the model boundary.**
   `ModelInvokeOptions.tools` contains executable `AgentTool` values. Model
   adapters need only the specification and should not depend on runtime
   handlers.
2. **There is no registry.** Constructor, MCP, and invocation tools are
   concatenated. `find()` returns the first duplicate name silently.
3. **Execution semantics are implicit.** All tool calls from one response use
   `Promise.all()`. Two writes, an edit and a write, or concurrent Bash commands
   can race.
4. **The context is untyped.** `ToolContext` is
   `Record<string, unknown>`, while the handler receives the complete agent
   option object. Call ID, working directory, cancellation, and progress have no
   stable contract.
5. **Results are unstructured.** Output is `unknown`; adapters stringify it
   independently. There is no common text/image content, details, truncation,
   or partial update shape.
6. **MCP is only a special adapter.** Stdio discovery works, but source
   identity, annotations, enable/disable rules, timeouts, and output
   normalization are not represented by the core tool type.
7. **Providers are closed.** `ProviderName` is a three-value union and
   `getModel()` is a switch over three adapter classes. The current `Provider`
   interface is primarily a settings and credential accessor, not a model
   transport abstraction.
8. **Adapters duplicate protocol work.** OpenAI Chat Completions, Anthropic
   Messages, and Ollama each serialize tools, parse calls, and project results.
   There is no shared normalized streaming event contract.
9. **Orbit has no built-in coding tools.** CLI, GUI, and library construction
   provide an empty first-party tool set unless a caller injects tools or MCP
   settings discover them.

## Target model and tool architecture

### Responsibility boundaries

The target flow should be:

```text
built-in factories ----+
custom tools ----------+--> ToolRegistry --> immutable ToolSnapshot
MCP discovery ---------+                         |          |
turn-scoped tools -----+                         |          +--> ToolRuntime
                                                 +--> ModelToolSpec[]
                                                           |
                                                     model adapter
```

`ToolRegistry` owns identity and registration. `ToolSnapshot` freezes the
active definitions for one model iteration. A model adapter sees only
`ModelToolSpec[]`. `ToolRuntime` validates, schedules, executes, observes, and
normalizes results by resolving the same snapshot.

### Proposed core contracts

The following shape is illustrative but sufficiently precise to guide the
implementation:

```ts
export type JsonSchema = Record<string, unknown>

export interface ToolInputCodec<Input> {
  jsonSchema: JsonSchema
  parse(value: unknown): Input
}

export interface ModelToolSpec {
  description: string
  inputSchema: JsonSchema
  name: string
}

export type ToolContent = {text: string; type: 'text'} | {data: string; mediaType: string; type: 'image'}

export interface ToolResult<Details = unknown> {
  content: ToolContent[]
  details?: Details
  isError?: boolean
}

export interface ToolExecutionContext {
  callId: string
  cwd: string
  emitUpdate(update: ToolResult): void
  signal: AbortSignal
}

export type ToolScheduling = 'parallel' | 'serial'
export type ToolSource = {kind: 'builtin'} | {id: string; kind: 'custom'} | {server: string; kind: 'mcp'}

export interface ToolDefinition<Input = unknown, Details = unknown> {
  execute(input: Input, context: ToolExecutionContext): Promise<ToolResult<Details>>
  input: ToolInputCodec<Input>
  scheduling: ToolScheduling
  source: ToolSource
  spec: ModelToolSpec
}
```

Zod-backed local tools can produce both `parse()` and JSON Schema from one
codec. MCP tools retain the server's JSON Schema and use a record-preserving
codec; the server remains authoritative for deeper MCP validation. This avoids
schema drift while preserving MCP schemas that cannot be represented exactly
by Zod.

`ToolRuntime.execute(call, context)` should be the only component that turns a
model call into a model-visible result. It must:

1. resolve the exact registered name;
2. validate input;
3. emit start diagnostics;
4. schedule parallel reads or serialize process and mutation calls;
5. pass call ID, working directory, signal, and update callback;
6. normalize returned content;
7. convert validation and execution failures into `isError` results;
8. truncate model-visible output while retaining details for diagnostics;
9. emit completion diagnostics with source and duration.

The registry must reject invalid names and duplicate names. There must be no
source precedence. MCP names remain `server__tool`; custom tools that collide
with a built-in or another custom tool fail during snapshot construction.

### Model-provider migration

Tool work does not require replacing all model adapters first. The smallest
safe model change is to make `ModelInvokeOptions.tools` contain
`ModelToolSpec[]`, not executable `AgentTool` values. Existing adapters can
serialize that neutral type immediately.

The subsequent provider refactor should:

1. rename the current settings-oriented `Provider` to `ProviderConfig` or
   equivalent;
2. introduce `ModelProvider` with provider ID, model creation, authentication,
   and request/stream behavior;
3. add a `ModelRegistry` that registers OpenAI, Anthropic, and Ollama without a
   switch statement;
4. keep provider-specific wire serialization inside each adapter;
5. define normalized streaming events before adding streaming to the agent
   loop.

This follows Pi's open provider registry and Codex's separation between
provider information, provider behavior, and session-scoped clients.

## Proposed built-in tool contracts

All paths resolve against `ToolExecutionContext.cwd`. In this phase, absolute
paths and paths outside the working directory are accepted. Output limits are
context-management limits, not access controls.

### `bash`

Input:

```ts
{
  command: string
  timeoutSeconds?: number
}
```

Behavior:

- execute through a configured Bash path;
- on Unix, prefer `/bin/bash`, then Bash on `PATH`, then `sh` with an explicit
  compatibility diagnostic;
- on Windows, use configured Bash, Git Bash, or Bash on `PATH`; fail with an
  actionable message if none exists;
- inherit the host environment and network access;
- merge stdout and stderr in arrival order for model-visible text while keeping
  separate captured fields in result details;
- stream throttled partial updates;
- kill the process tree on cancellation or timeout;
- use no timeout by default in the low-level operation, while allowing product
  settings to provide one;
- truncate returned text by configured line and byte limits and retain a
  recoverable full-output path when feasible.

Details include `exitCode`, `durationMs`, `timedOut`, truncation metadata,
`stdout`, and `stderr`. A non-zero exit code is a completed command, not a tool
transport failure.

Version one is a one-shot call. Interactive terminal sessions analogous to
Codex `write_stdin` are a separate extension after the base runtime supports
partial updates and resource cleanup.

### `read`

Input:

```ts
{
  path: string
  offset?: number
  limit?: number
}
```

`offset` is a one-based line number and `limit` is a line count. The result
contains the selected text and details with normalized path, total lines,
returned range, encoding, and truncation state. Version one supports UTF-8 text
and returns a clear binary-file error. Image content can be added through the
existing `ToolContent` union without changing the interface.

The canonical `read` tool rejects directories and directs the model to `list`.
A temporary compatibility adapter may dispatch a directory path to `list`.

### `list`

Input:

```ts
{
  path?: string
  includeHidden?: boolean
  limit?: number
}
```

The default path is the current working directory. Results are deterministic,
sorted entries with path, kind, and symbolic-link information. Listing is
non-recursive; `glob` owns recursive path discovery. Details report omitted
entry count and truncation.

### `grep`

Input:

```ts
{
  pattern: string
  path?: string
  glob?: string
  literal?: boolean
  ignoreCase?: boolean
  contextLines?: number
  limit?: number
}
```

Results contain deterministic matches with path, one-based line and column,
line text, and optional context. Invalid regular expressions are input errors.
The implementation must work on supported Node platforms without downloading a
binary at runtime. A pure Node implementation is the portability baseline;
installed `rg` may be an optional accelerator only if parity tests guarantee
the same contract. Generated directories and binary files are skipped by
default, and repository ignore rules are honored.

### `glob`

Input:

```ts
{
  pattern: string | string[]
  path?: string
  includeDirectories?: boolean
  includeHidden?: boolean
  limit?: number
}
```

Results are unique, lexically sorted paths relative to `cwd`, unless an
absolute base path was requested. Repository ignore rules are honored. The
implementation should use a maintained cross-platform Node glob library plus
ignore-file handling rather than shelling out or downloading tools.

### `edit`

Input:

```ts
{
  path: string
  oldText: string
  newText: string
  replaceAll?: boolean
}
```

By default, `oldText` must occur exactly once. Zero or multiple matches are
errors and do not modify the file. `replaceAll: true` permits multiple matches
and reports the replacement count. The implementation preserves the existing
encoding marker and line endings, uses an atomic temporary-file replacement
where the platform permits it, and participates in a per-path mutation queue.
An unchanged result is rejected so the model cannot mistake a no-op for a
successful edit.

This exact-replacement contract works with all current function-calling
providers. A separate free-form `apply_patch` tool can be evaluated later.

### `write`

Input:

```ts
{
  path: string
  content: string
  createDirectories?: boolean
}
```

The tool creates a file or completely overwrites an existing file, as requested.
`createDirectories` defaults to `true`. It uses the same atomic replacement and
per-path mutation queue as `edit`. Details include normalized path, byte count,
whether the file previously existed, and whether parent directories were
created.

## Full-access execution boundary

The implementation in this phase deliberately provides full access:

- no workspace containment check;
- no read/write path allowlist;
- no command approval or denylist;
- no sandbox process wrapper;
- no Orbit-level network restriction;
- no special treatment for credentials visible to the host process.

The tools still need cancellation, timeouts, output limits, deterministic path
resolution, and process cleanup. Those are correctness and resource-lifecycle
requirements, not permission controls.

Introduce a no-op `ToolExecutionMiddleware` chain or equivalent internal hook,
but do not expose a misleading permission setting until policy is implemented.
A future sandbox or approval component can then inspect a definition, call,
source, and context before delegating to the next executor.

## Default activation and compatibility

Product entry points and the reusable library have different compatibility
needs.

- Orbit CLI, interactive mode, and GUI should select the `coding` profile,
  which enables all seven built-ins by default.
- The low-level `Agent` constructor should accept an explicit registry or
  profile. During migration, omission preserves the current no-built-in
  behavior for library callers.
- A later documented breaking release may make `coding` the library default if
  that is still desirable.
- Workspace settings should support a profile plus explicit additions and
  exclusions, for example `tools.profile`, `tools.include`, and
  `tools.exclude`.
- Constructor and per-turn `tools` arrays remain supported through a
  compatibility adapter, but are normalized into scoped registry entries.
- Existing `tool()` and `Tool` exports remain during the first migration stage.
  They should implement or adapt to `ToolDefinition`, then be deprecated only
  after downstream callers can migrate.

MCP discovery should register definitions into the same scoped registry. It
should preserve raw input schemas and source metadata, namespace names, and use
serial scheduling unless trustworthy MCP annotations declare a call read-only.
Adding HTTP MCP transports, authentication, and approval settings is outside
the coding-tool phase but no longer requires another agent interface.

## Migration plan

### Phase 0: Characterize existing behavior

- Add tests for the current constructor, MCP, and per-turn merge order.
- Add an explicit regression test demonstrating the current duplicate-name
  first-match behavior before replacing it.
- Add adapter contract tests proving identical model-visible specifications for
  local and MCP tools.
- Record the public exports that must remain source-compatible.

Exit condition: the existing behavior and intended breaking changes are
visible in tests.

### Phase 1: Introduce neutral tool primitives

- Add `ModelToolSpec`, `ToolInputCodec`, `ToolDefinition`, `ToolResult`,
  `ToolExecutionContext`, `ToolSource`, and scheduling types under
  `src/core/tools/`.
- Add Zod and raw-JSON-Schema codec factories.
- Adapt existing `Tool` instances and structural `AgentTool` objects to the new
  definition.
- Change adapter helpers to consume only `ModelToolSpec`.

Exit condition: model adapters no longer import executable agent tools, while
existing caller code still compiles.

### Phase 2: Add registry and runtime

- Implement scoped `ToolRegistry` registration and immutable snapshots.
- Reject invalid and duplicate names with source-aware errors.
- Implement `ToolRuntime` validation, scheduling, cancellation, updates,
  diagnostics, truncation, and error normalization.
- Refactor `Agent` to obtain model specifications and runtime executors from one
  snapshot.
- Replace unconditional `Promise.all()` with deterministic scheduling: parallel
  batches for read-only calls and ordered execution for serial calls.

Exit condition: no tool lookup or execution logic remains in `Agent` beyond
orchestration.

### Phase 3: Migrate MCP and custom tools

- Register MCP tools as source-aware definitions using raw schema codecs.
- Keep `server__tool` naming and make collisions fatal.
- Normalize MCP text and image content into `ToolResult`.
- Route constructor and turn-scoped tools through compatibility registration.
- Ensure all owned MCP clients close through the existing `finally` boundaries.

Exit condition: built-in, custom, and MCP tools share one registry and runtime.

### Phase 4: Implement the coding profile

- Implement shared path, ignore, truncation, mutation queue, atomic write, and
  process-runner utilities.
- Implement and export `read`, `list`, `grep`, `glob`, `edit`, `write`, then
  `bash`.
- Add `coding` and `none` profiles and workspace validation.
- Enable `coding` in CLI, interactive, and GUI entry points.
- Add the coding-tool prompt contribution with concise usage guidance.

Exit condition: Orbit can inspect, modify, build, and test a temporary project
using only the coding profile.

### Phase 5: Open the model-provider boundary

- Introduce `ModelProvider` and `ModelRegistry` while retaining `getModel()` as
  a compatibility facade.
- Move provider credential and endpoint resolution behind registered providers.
- Add normalized model stream events and partial tool-call parsing.
- Preserve provider-specific serialization inside adapters.

Exit condition: a fourth provider can be registered without changing a union,
settings switch, or model factory switch.

### Phase 6: Documentation and acceptance evaluation

- Document tool schemas, full-access behavior, output limits, and configuration.
- Add deterministic fixture repositories and model-free end-to-end agent tests.
- Run the complete required validation: headers, build, and tests.
- Evaluate representative workflows: inspect an unfamiliar repository, make a
  focused edit, create a file, run tests, recover from a failed command, and
  handle conflicting tool calls.

Exit condition: all acceptance scenarios pass on Ubuntu and Windows CI without
network access or live model calls.

## Test contract

Every built-in requires tests for success, invalid input, missing paths,
cancellation, output truncation, diagnostics, and platform-specific path
behavior. Additional critical cases are:

- deterministic sorted `list` and `glob` output;
- ignored and binary files in `grep`;
- invalid regular expressions;
- exact-one-match and replace-all `edit` behavior;
- concurrent edits and writes to the same path;
- atomic preservation after a failed write;
- Bash stdout/stderr ordering, non-zero exit, timeout, abort, and process-tree
  cleanup;
- duplicate names across built-in, custom, MCP, and turn scopes;
- MCP raw JSON Schema preservation;
- adapter parity across OpenAI, Anthropic, and Ollama;
- no live network, credential, workspace-settings, or developer-home
  dependencies.

Use temporary directories and injected filesystem/process operations. Windows
tests should validate shell discovery and error handling without assuming Git
Bash is installed on every runner.

## Decisions and deferred work

Recommended decisions for this phase:

1. Implement the seven-tool `coding` profile rather than only the requested
   five.
2. Use `glob` as Orbit's name even though Pi uses `find`.
3. Keep `read` file-specific and add `list` for directories.
4. Use exact replacement for the first `edit`; defer free-form patch protocols.
5. Fail on every duplicate registered name.
6. Default unknown custom and MCP tools to serial execution.
7. Keep full access and do not pretend a permission model exists.
8. Refactor the tool boundary before the broader model-provider boundary.

Deferred work:

- sandboxing, approvals, path restrictions, and network policy;
- interactive terminal sessions and stdin continuation;
- remote Bash or container backends;
- HTTP MCP transports and MCP authentication;
- deferred tool search and model-specific free-form tools;
- richer image, binary, notebook, and syntax-tree editing tools;
- automatic patch conflict recovery.

## References

- [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
- [Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp)
- [Codex open-source documentation](https://learn.chatgpt.com/docs/open-source)
- [Codex `ToolExecutor` at the inspected commit](https://github.com/openai/codex/blob/7b5b3bd5a2418a5e142449c9ab95e057d14bc98a/codex-rs/tools/src/tool_executor.rs)
- [Codex tool specification](https://github.com/openai/codex/blob/7b5b3bd5a2418a5e142449c9ab95e057d14bc98a/codex-rs/tools/src/tool_spec.rs)
- [Codex tool registry](https://github.com/openai/codex/blob/7b5b3bd5a2418a5e142449c9ab95e057d14bc98a/codex-rs/core/src/tools/registry.rs)
- [Codex tool specification plan](https://github.com/openai/codex/blob/7b5b3bd5a2418a5e142449c9ab95e057d14bc98a/codex-rs/core/src/tools/spec_plan.rs)
- [Codex model provider](https://github.com/openai/codex/blob/7b5b3bd5a2418a5e142449c9ab95e057d14bc98a/codex-rs/model-provider/src/provider.rs)
- [Codex model client](https://github.com/openai/codex/blob/7b5b3bd5a2418a5e142449c9ab95e057d14bc98a/codex-rs/core/src/client.rs)
- [Pi source at the inspected commit](https://github.com/earendil-works/pi/tree/a1f955e9f47fd3379b44f4aace65ab916c80519a)
