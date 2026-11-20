# Host-Permitted Session Memory Search

Core can attach `project_memory_search` to an ordinary managed Session run without
host tool definitions or handlers. The default is no automatic search permission.
The host configures the existing Project memory service/store and supplies a
trusted JavaScript callback for that run:

```ts
const permission: ProjectMemorySearchPermission = ({projectId, sessionId}) =>
  hostPermissions.canReadProjectMemory(projectId, sessionId)

await application.startRun(threadId, question, {memorySearch: permission})
// The same option works on ThreadManager.startRun and Agent.startRun.
```

`application` is the Core `OrbitApplicationService` configured with a Project
store. A direct Agent needs its existing `projectMemory` service and registered
Session state. This feature adds no UI, HTTP permission field, Nest connection,
workspace setting, automatic extraction or persisted grant. JSON booleans/strings are
rejected; permission callbacks are trusted host behavior and are never sent to a
model. Callback exceptions deny permission without exposing their details.

## Binding and authorization

Core derives immutable Project/Session IDs from the leased live Session, its file
in the configured registered repository, active membership and membership revision.
The host callback receives those IDs; it cannot choose a different scope. An
unassigned Session gets no automatic tool. Unregistered/foreign/closed Sessions,
missing services, archived/unavailable state and changed admitted bindings fail
closed. A new run resolves everything afresh rather than keeping an old registry.

The callback must return exactly true. It can close over revocable application
state. Core rechecks permission, actual model object/identity, current capability
and membership before declarations, before and after generation, and around tool
preparation/execution and retrieval. Changed scope stops the run rather than
switching Projects mid-conversation. Revocation after a settled read discards its
result and returns a known failure, never an unknown external-write outcome.
Unknown *general model capability* is explicitly allowed by the common policy;
unknown scope or permission is not.

The actual read still goes through the ordinary ToolRuntime/OperationExecutor,
including host execution policy/approval decisions. The existing canonical search
rechecks membership around retrieval and retains source validation, corrections,
retirement/deletion, query/result count and whole-entry/token limits. Model
arguments remain only query and limit. There is no pre-retrieval memory/answer
injection and no new persistence format or context capture. Previously authorized
tool messages remain ordinary Session history under existing retention rules;
revocation stops new reads rather than erasing earlier transcript data.

## Model and catalog selection

General `supported` and `unknown` allow attachment when all other conditions hold;
explicit `unsupported` excludes it. Apple additionally requires the concrete
`AppleProjectMemoryAgent` and its `project_memory_search` named observation. A
provider label, arbitrary named claim or the legacy text-only Apple adapter does
not qualify. The dedicated Apple run catalog contains only this fixed tool,
excluding generic defaults from that run. Core closes its automatically attached native generation on run exit, including
revocation/failure, so a paused Tool cannot retain its continuation. Existing native
process-local/history-replay limits still apply; this API does not repair or bypass
unsupported persisted native tool history. No adapter switching, general native
Tool support or implicit cloud fallback is introduced.

Automatic attachment is run-local. It never mutates constructor tools or later
runs. An explicit tool with the same name conflicts whenever automatic search is
requested; Core rejects the run instead of shadowing a handler. Without this
option, existing explicit registrations keep their previous behavior. Reuse the
same callback object for idempotent retries; a different permission identity with
the same request ID is rejected. Use a new request ID for a new grant/run.

This API is limited to ordinary unselected Agent runs. Graph/selected execution
needs a separate catalog-binding design. Existing memory snapshot selection is
independent; automatic search does not enable it or alter compaction.

## Reproduction and evidence

Deterministic synthetic tests exercise Session A source-backed notes retrieved in
Session B, no answer injection, Project isolation/scope injection, missing/denied
permissions, revocation, execution policy denial, corrections/retirement,
capabilities and model switches, collisions, foreign repository identities,
Apple named-only protocol and the ordinary Core Application/Thread passthrough:

```sh
npm run build
TS_NODE_PROJECT=tsconfig.test.json npx mocha --forbid-only \
  test/core/projects/session-memory-tool.test.ts
```

The [Apple protocol test](apple-project-memory.md#reproduction) independently checks
native concurrent requests with reversed results without invoking a model. Mock
protocol/fixture success is not real-model evidence or a benchmark result.
No real memories, paid inference or full benchmark rerun is needed for these tests.

See the [decision](adr/2026-11-20-session-memory-search.md),
[explicit search](projects.md#opt-in-model-callable-search) and
[capability contract](model-capabilities.md).
