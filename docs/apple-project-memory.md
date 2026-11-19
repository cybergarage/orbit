# Apple Project Memory Search

This explicitly selected adapter bridges exactly one native Foundation Models
Tool, `project_memory_search`, to the ordinary Core ToolRuntime. It is not general
Apple tool support. The original Apple adapter and v1 helper remain text-only.
Nothing is registered automatically; Nest and App paths are unchanged.

## Dependencies and selection

This change targets main with Project memory search PR #40 merged. Capability contract PR
#41 supplies the optional API. The common resolver preserves `namedTools`, and the adapter returns `tools: 'unsupported'` plus
`namedTools: ['project_memory_search']`. The common arbitrary-tool helper therefore
excludes this adapter. A host must explicitly select this named route and register
only `createProjectMemorySearchTool(memory, {projectId, sessionId})` with an Agent
using `toolProfile: 'none'`. Supply the adapter through `deps.createModel`.

```ts
const native = new AppleProjectMemoryAgent(createProvider('apple'), {
  helperPath: explicitlyCompiledHelper,
})
try {
  // Agent owns the ordinary operation authorization and tool dispatch.
  // Register only the host-bound search factory; no executable handlers go to Swift.
  // Use native as deps.createModel's result, and close the Agent in finally.
} finally {
  native.close()
}
```

The host must close the adapter when abandoning a generation between tool rounds.
A generation also has a maximum 120-second deadline, four calls, and one owned
subprocess. No inference probes, provider fallback or automatic model downloads
occur. Apple silicon, macOS 26+, the Foundation Models SDK, and a locally available
Apple Intelligence model are required. Availability is not inferred from OS alone.

## Wire boundary

The separate helper uses version 2 JSON lines on stdin/stdout. Initialization
contains a fresh nonce, bounded text messages, output cap and call count. Ready
announces only the fixed name. Each native call supplies its generated `query`
(up to 512 characters) and `limit` (1–16), a unique call ID and the generation
nonce. No Project ID, Session ID, path or executable handler is sent in arguments.

Core returns a normalized assistant tool call, executes through the existing
ToolRuntime/OperationExecutor and registered permissions, then sends the matching
result back to the paused native Tool. The adapter validates the unchanged
conversation prefix, call ID, name and input. Native parallel calls may queue;
Core rounds serialize them. Swift maintains separate pending continuations and
can correlate results delivered in either order. Unknown names, malformed inputs,
duplicates, foreign nonces and denied/error results fail closed.

The existing search service rechecks the host-bound Project/Session membership,
source eligibility, corrections, deletion and whole-entry/token limits. Swift
never reads a database or Project file. The bridge limits total input/output to
1 MiB per direction, each tool result/final text to 64 KiB, stderr to 16 KiB,
messages to 256, output tokens to 4,096 and handshake to three seconds. Cancellation
terminates the owned process, discards queued frames and rejects late results.
The old EOF-only helper times out instead of silently switching protocols.

No raw stderr, native exceptions, query or memory text is included in bridge
errors. Normal Core session/tool records still contain authorized arguments and
results under the existing application retention policy. Final provider metadata
contains only SDK transcript call/output counts and argument-correlation status;
it does not retain the SDK transcript. Continuations cannot survive restart. Changes to the conversation prefix, including
context compaction between native rounds, fail closed rather than replaying a
partially completed native generation.

## Reproduction

From the checkout, build and run deterministic TypeScript tests first:

```sh
npm run build
TS_NODE_PROJECT=tsconfig.test.json npx mocha --forbid-only \
  test/core/apple-project-memory.test.ts test/core/apple-memory-ipc.test.ts \
  test/core/projects/memory-search.test.ts
```

Compile the native actor protocol-test variant. This invokes no model and verifies
two distinct concurrent calls whose results arrive in reverse order:

```sh
xcrun swiftc -parse-as-library -O -D ORBIT_PROTOCOL_TEST \
  -target arm64-apple-macosx26.0 native/apple-project-memory/main.swift \
  -o /tmp/orbit-apple-memory-protocol
ORBIT_APPLE_MEMORY_PROTOCOL_HELPER_PATH=/tmp/orbit-apple-memory-protocol \
  node bin/test-apple-memory-protocol.mjs
```

Compile the production helper separately, then opt in to real local inference:

```sh
xcrun swiftc -parse-as-library -O -target arm64-apple-macosx26.0 \
  native/apple-project-memory/main.swift -o /tmp/orbit-apple-memory-helper
ORBIT_APPLE_MEMORY_HELPER_PATH=/tmp/orbit-apple-memory-helper \
  node bin/test-apple-project-memory.mjs
```

The real E2E creates isolated temporary Session A, saves one synthetic excerpt in
the canonical Project store, and asks in new Session B without prior messages,
summary, answer or memory pre-retrieval. It requires an actual native Tool call,
Core dispatch, matching source IDs, transcript counts/argument correspondence and
a grounded answer. It prints only safe booleans/counts and removes its temporary
root. A failure is a failure, never an automatic cloud retry or mock substitution.

## Local evidence

On 2026-11-19, Swift 6.4.2 compiled the macOS 26 target on macOS 27.2.1/Apple
silicon. The production native E2E passed with one actual SDK Tool call, one Core
dispatch, matching source-backed memory, one transcript tool output and the
expected synthetic answer. This is one integration check, not a quality benchmark
or qualification of arbitrary tools. The distinct native actor protocol check is
mock evidence and must not be counted as model execution.

See the [decision](adr/2026-11-19-apple-project-memory-bridge.md) and
[Apple's tool-calling contract](https://developer.apple.com/documentation/foundationmodels/expanding-generation-with-tool-calling.md).

The initial implementation checkout also passed 1,421 repository tests, header checks, build,
and the 526-file independent package consumer, including public adapter types and
named capability without inference.

The current main-based implementation tests named capability
normalization through the common resolver and installed-package API. Historical
real-device evidence above is separate; this metadata-only update performs no new
model inference and changes no native Tool/search/authorization behavior.

The previous integration validation passed 1,455 full-suite tests, headers, build and the 531-file
installed-package consumer, including common resolver visibility of the Apple
named observation while general tool inclusion stays disabled.
