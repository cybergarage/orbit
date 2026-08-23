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

On Unix, Orbit prefers `/bin/bash`, then Bash on `PATH`, and finally `sh`. On
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

The coding tools currently have full host access:

- relative paths resolve against the agent working directory;
- absolute paths and paths outside that directory are accepted;
- Bash inherits the Orbit process environment and network access;
- Orbit does not apply a sandbox, command approval, path allowlist, or network
  policy.

Run Orbit only in an environment where model-directed file and command access
is acceptable. Cancellation, timeouts, output limits, ignore rules, and process
cleanup are resource-management behavior, not security boundaries.

## Custom and MCP tools

Constructor tools, per-turn tools, built-ins, and discovered MCP tools enter the
same registry. Orbit sends only name, description, and JSON Schema to the model;
executors stay in the runtime. MCP tools keep their server schema and use names
such as `filesystem__read_file`.

Every active tool name must be unique. Orbit fails registration when a built-in,
custom, turn-scoped, or MCP tool collides instead of choosing one by array
order. Custom and MCP tools are serial unless their definition explicitly
declares parallel scheduling.

Tool execution returns normalized text or image content, optional details, and
an error marker. Validation failures, unknown names, and thrown errors become
tool-result messages so the model can recover within the same turn.
