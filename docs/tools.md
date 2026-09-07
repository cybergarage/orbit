# Coding Tools

Orbit provides a built-in coding tool profile for repository exploration,
editing, command execution, builds, and tests.

## Default profile

The CLI, interactive terminal, and local GUI enable the `coding` profile by
default. It contains:

| Tool    | Purpose                                                  | Scheduling |
| ------- | -------------------------------------------------------- | ---------- |
| `bash`  | Execute a command with Bash                              | serial     |
| `read`  | Read a UTF-8 text file by line range                     | parallel   |
| `list`  | List the immediate entries in a directory                | parallel   |
| `grep`  | Search UTF-8 file contents with a regular expression     | parallel   |
| `glob`  | Find paths with one or more glob patterns                | parallel   |
| `edit`  | Replace exact text after validating the expected matches | serial     |
| `write` | Create a file or completely overwrite an existing file   | serial     |

Read-only calls may run concurrently. Orbit treats `bash`, `edit`, `write`,
and unknown custom or MCP tools as serial barriers, so reads do not race across
a process or file mutation.

The reusable `Agent` class preserves its previous library default and does not
enable built-ins unless a profile is selected:

```ts
import {Agent, ToolProfile} from 'orbit'

const agent = new Agent({
  cwd: '/workspace/project',
  toolProfile: ToolProfile.Coding,
})
```

## Configure built-ins

Workspace settings can select a profile and adjust individual tools:

```json
{
  "tools": {
    "profile": "coding",
    "exclude": ["bash"],
    "include": ["read"]
  }
}
```

`profile` is `coding` or `none`. `include` adds tools after selecting the
profile, and `exclude` removes tools after additions. Valid names are `bash`,
`edit`, `glob`, `grep`, `list`, `read`, and `write`.

Setting `profile` to `none` disables the product default. For example, this
creates a read-only subset:

```json
{
  "tools": {
    "profile": "none",
    "include": ["read", "list", "grep", "glob"]
  }
}
```

## Tool inputs

### `bash`

```json
{
  "command": "npm test",
  "timeoutSeconds": 300
}
```

`timeoutSeconds` is optional and has no default. Orbit captures stdout and
stderr, preserves their arrival order in model-visible output, reports the exit
code, and kills the process tree when a call is cancelled or times out. A
non-zero exit code is a completed command result; a timeout is a tool error.

On Unix, Orbit resolves Bash without starting a discovery process; `sh` is not a fallback. On
Windows, it uses `ORBIT_BASH_PATH`, Git Bash, or `bash.exe` on `PATH`.

### `read`

```json
{
  "path": "src/core/agent.ts",
  "offset": 120,
  "limit": 80
}
```

`offset` is a one-based line number. `limit` is a line count and defaults to
2,000. `read` accepts UTF-8 files and rejects directories and binary files. Use
`list` for a directory.

### `list`

```json
{
  "path": "src/core",
  "includeHidden": false,
  "limit": 2000
}
```

Listing is non-recursive, sorted, and excludes dotfiles by default.

### `grep`

```json
{
  "pattern": "ToolRegistry",
  "path": "src",
  "glob": "**/*.ts",
  "literal": false,
  "ignoreCase": false,
  "contextLines": 0,
  "limit": 2000
}
```

`pattern` is a JavaScript regular expression unless `literal` is true. Search
results report path, one-based line, one-based column, and line text. Binary
files, generated directories, and paths excluded by the root `.gitignore` are
skipped.

### `glob`

```json
{
  "pattern": ["src/**/*.ts", "test/**/*.test.ts"],
  "path": ".",
  "includeDirectories": false,
  "includeHidden": false,
  "limit": 2000
}
```

Results are unique and sorted. Generated directories and paths excluded by the
base directory's `.gitignore` are skipped.

### `edit`

```json
{
  "path": "src/example.ts",
  "oldText": "const enabled = false",
  "newText": "const enabled = true",
  "replaceAll": false
}
```

By default, `oldText` must occur exactly once. Zero matches and multiple
matches fail without changing the file. Set `replaceAll` to replace every
match. Orbit serializes mutations to the same path and writes through a
temporary file in the destination directory.

### `write`

```json
{
  "path": "src/new-file.ts",
  "content": "export const value = 1\n",
  "createDirectories": true
}
```

`write` creates or completely overwrites a UTF-8 file. Parent directory
creation defaults to true.

## Access model

Managed Agent calls use the `workspace-confirm` policy by default. Reads inside
configured roots are allowed, edits/commands/MCP operations ask the application
responder, and paths outside the roots are denied. No responder means denial.
Tool selection and operation permission are separate: enabling `coding` does
not approve its writes. An application owner can explicitly select `unrestricted`;
finite limits and required recording still apply.

Prepared operations bind parsed input, canonical targets, preimages, environment,
source identity and policy. After intent storage, core rechecks targets and
permission before registering and starting the executor. Glob traversal and
symlink following are restricted. These checks provide no OS sandbox: an
approved Bash/MCP/custom operation has its process's host access, and external
filesystem races or detached descendants require operating-system isolation.
Direct low-level tool invocation also bypasses the managed Agent contract.
See [Managed Execution](execution.md) for approval and migration details.

## Custom and MCP tools

Constructor tools, per-turn tools, built-ins, and discovered MCP tools enter the
same registry. Orbit sends only name, description, and JSON Schema to the model;
executors stay in the runtime. MCP tools keep their server schema and use names
such as `filesystem__read_file`.

Every active tool name must be unique. Orbit fails registration when a built-in,
custom, turn-scoped, or MCP tool collides instead of choosing one by array
order. Managed custom and MCP operations are serial, including definitions
that previously requested parallel scheduling.

Tool execution returns normalized text or image content, optional details, and
an error marker. Invalid calls and denied operations become tool-result
messages. Arbitrary executor rejection can leave effects unknown; the run stops
and quarantines resources rather than treating that rejection as proof of no effect. OpenAI Chat
Completions and Ollama do not expose a native tool-error field, so Orbit adds a
model-visible `Tool error:` marker when projecting failed results to those
providers. Non-zero Bash exits include their exit status in model-visible
content.

Ollama tool-result messages preserve normalized image data through its native
`images` field. OpenAI Chat Completions currently receives an explicit image
placeholder because that protocol does not accept image parts in function tool
results. Rich tool-result capability negotiation remains future work.

Tools may also emit partial updates before returning their final result. Agent
and thread consumers receive these as `tool-updated` events. Updates are not
persisted as conversation messages and are not sent back to the model.

## Managed MCP schema support

Managed discovery validates inputs locally before requesting operation approval.
The initial subset accepts types, properties, required/additional properties,
items, enum/const, anyOf/oneOf/allOf, string length/pattern and numeric/array
bounds, plus the descriptive keywords listed in `validateSchemaKeywords` in
`src/core/mcp.ts`. Unsupported vocabulary (including references) fails startup;
Orbit does not silently ignore unknown constraints, including constraints inside
tuple-style `items` arrays. All enabled sources are
required for ready. Startup uses the same run budget and requires authorization
before opening a stdio client. The discovered catalog stays fixed for that run.

Custom definitions need a trusted `prepare` implementation returning the actual
executor, bound effects/targets, preview and revalidation. The legacy adapter
requires both `unrestricted` and `allowLegacyTools: true`; its effects are opaque.
