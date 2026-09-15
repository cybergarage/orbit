# Building an agent application with Orbit

This guide is for an application developer using `@cybergarage/orbit` as the
agent framework for a desktop agent, messaging agent or automated workflow.
Orbit 0.6 provides reusable execution machinery. You provide the product's
identity, transport, scheduling, memory policy and delivery behavior.

Start with the [runnable agent example](../examples/agent/README.md).
It uses only the installed package and includes a model-free development mode.
After that works, replace the terminal with one channel or UI at a time.

## Choose the integration boundary

| API | Use when | You own |
| --- | --- | --- |
| `OrbitApplicationService` | Building a complete local agent or GUI | Workspace/storage setup, transport, authentication, input queue, approvals and delivery |
| `ThreadManager` | Building a host with its own settings and application services | Agent construction, settings, optional SessionRepository, logs and client transport |
| `Agent` | Embedding a single managed model/tool loop | Messages/Session, run handles, policies, approval responder and lifetime |
| Model/tool/MCP primitives | Implementing adapters or lower-level infrastructure | All execution management; direct calls are outside the managed Agent contract |

Use the package root import:

```ts
import {OrbitApplicationService, SessionRepository} from '@cybergarage/orbit'
```

The runtime needs Node.js and native ESM. Keep it in a trusted server process
or Electron main process. A browser renderer should receive validated,
application-specific messages. Importing the runtime into a browser bundle is
not a supported integration. See [GUI Integration](gui-integration.md).

## A practical application layout

```text
Desktop UI / messaging adapter / scheduled trigger
                    |
       Host: authenticate, route, queue, deduplicate
                    |
          OrbitApplicationService
                    |
        ThreadManager -> Agent -> Model / Tools / MCP
                    |
       Sessions + required journals + optional logs

Host services: conversation mapping, memory retrieval, schedules,
notification delivery, application database and process supervision
```

This is a suggested host composition using existing APIs, not a claim that
Orbit implements the host services shown here.

### 1. Define workspace and storage ownership

Give the application explicit Session and journal roots using
`SessionRepository({rootDir, journalRoot})`. Use a separate
`FileSessionLogStore({rootDir})` for its logs. Initialize persistent storage
once under offline exclusive control before admitting users. The
[example setup](../examples/agent/src/setup.ts) demonstrates the call;
[Session Storage](session-storage.md) owns the complete maintenance contract.

Associate each external conversation with a Session ID in your own database.
Store the workspace and owner with that mapping. Never treat an incoming
Session ID as proof that a client may read it, resume it, approve its actions,
or delete it. Explicit paths avoid relying on process-global `configureApp()`
when hosting more than one application.

Workspace configuration is inherited from ancestor directories containing
`.orbit`. `Agent` also loads those settings during construction; supplying
Service `settings` or `settingsSources: []` is not a general isolation switch.
Review [Settings](settings.md) and use application-controlled workspaces.

### 2. Create or resume a conversation

Create the service after initializing storage, then call `createThread()`.
On restart, resolve the authenticated conversation mapping and call
`await service.resumeSession(sessionId)`. Resume reads saved conversation
state; it does not restart interrupted external actions. Handle a missing,
locked, quarantined or invalid Session explicitly.

The Session ID and Thread ID refer to the same conversation in this service.
One Thread accepts one active Run at a time; different Threads can run
concurrently. Add per-conversation serialization in the host, plus a global
limit for provider costs and concurrent work. Orbit's run budgets are not a
shared application spending limit.

### 3. Admit input and retain delivery identity

Record a unique `requestId` for each logical user submission before dispatch.
Retries must reuse that ID and the same content in the same conversation:

```ts
const started = await service.startRun(threadId, content, requestId)
if (started.kind === 'command') {
  // Local slash command: deliver started.response; there is no Run ID.
} else {
  // Persist started.runId with the host's submission record.
}
```

`startRun()` returns after admission, before completion. On transport failure,
reconcile the retained submission and query the Run. Do not assign a new
request ID and blindly repeat an operation. Request deduplication is not a
durable scheduler, a cross-conversation inbox, or exactly-once external delivery.
Recovered results provide evidence, not an automatically reconstructed response
object. See [Managed Execution](execution.md).

### 4. Observe, authorize and finish

Subscribe to `subscribeRunSnapshots()` before dispatch, and call `queryRun()`
after admission and whenever your transport reconnects or misses an event.
Compare `sequence` per Run; do not replace newer state with older events.
Use `getThread()` to refresh conversation messages. Model response
text currently arrives as completed messages, not token-by-token deltas.

Show pending `snapshot.approvals` to the authorized operator, including the
operation preview. Send `requestId`, `digest` and the actual decision to
`replyApproval(runId, reply)`. Authenticate and authorize this endpoint in
the host: the service's internal `local-gui` responder scope is not user
authentication. Requests can expire or become stale while the user responds.

`cancelRun()` acknowledges a stop request. Continue observing until the
terminal result; do not immediately release resources or report success.

| Run outcome | Host behavior |
| --- | --- |
| `completed` | Deliver the answer; inspect tool outcomes and verify any product-specific success criteria |
| `cancelled` | Report cancellation and inspect quiescence/unresolved work |
| `budget-exceeded` | Explain the exhausted budget; let the owner choose a later submission |
| `failed` | Report the known failure with an actionable diagnostic |
| `incomplete` | Preserve evidence and ownership; resolve uncertain effects before conflicting work |

The host should stop admissions and await `service.close()` during shutdown.
If it supplied the log store, close that store after successful service close.
A close error is operational evidence, not permission to erase locks or replay
commands. See the example's `waitForRun()` and `close()` implementations.

### 5. Add product capabilities incrementally

| Capability | Application work | Orbit integration |
| --- | --- | --- |
| Telegram/Slack/web UI | Authenticate users; validate events; map conversations; store delivery attempts | Submit inputs and render Run/Thread snapshots |
| Scheduled tasks and heartbeat | Persist schedules, time zones, missed-run policy, leases and retries | Turn one admitted trigger into one Run with a retained request ID |
| Long-term memory | Define source ownership, retrieval, correction, deletion and provenance | Supply selected context/instructions or a prepared retrieval tool; Session history alone is not a memory search service |
| Skills | Own catalogs, source trust and explicit user selection | `SkillCatalog`, `listSkills()` and per-Run selections; see [Skills](skills.md) |
| External actions | Define credentials, privileges, previews and reconciliation for each service | MCP or prepared custom tools; see [Tools](tools.md) |
| Multiple agents | Define identities, routing, queues and overall budgets | Separate Threads/Agents; runtime concurrency does not supply an agent roster or delegation scheduler |
| Workflow candidates | Own the candidate set, evidence and user selection | [Processor graphs](processor-graphs.md), [evaluation](workflow-evaluation.md), [selection](workflow-selection.md) |

Begin with one user, one channel and one useful workflow. Introduce a durable
queue before adding unattended triggers. Record outbound delivery independently
from Run completion so a failed network send does not rerun a successful tool.

## Tools and provider extensions

The coding profile supplies read/list/glob/grep/write/edit/bash. Under
`workspace-confirm`, in-root reads are normally allowed and writes, commands
and MCP startup/calls require approval. An unattended host must define explicit,
narrow application-owned rules for its permitted actions; model text must not
grant its own authority. Shell and MCP operations retain host privileges: the
policy is not an operating-system sandbox.

For a custom tool, provide a `ToolDefinition` with an input codec, model-facing
schema, source identity and a trusted `prepare` implementation. Preparation
returns bound targets/effects, a preview, revalidation and the actual executor.
Validate before dispatch and honor cancellation. A raw `tool()` handler is not
automatically a managed prepared tool. Legacy handlers require explicit
unrestricted configuration and are not the recommended application default.

Register a custom model with `registerModelProvider()` before loading settings
that select it. The [demo adapter](../examples/agent/src/demo-model.ts)
shows the minimum interface; a real adapter must also preserve tool calls,
response metadata, cancellation and provider continuation state. The built-in
adapters cover OpenAI, Anthropic and Ollama; see [Current Architecture](architecture.md).

## What 0.6 does not promise

- No complete OpenClaw/Hermes-style product, hosted gateway, channel ecosystem,
  scheduler, long-term memory service or automatic self-improvement loop.
- No distributed or multi-tenant isolation from the local storage protocol.
- No universal filesystem/power-loss guarantee. Storage verification focuses
  on Linux/macOS; Windows persistence and production deployments need their
  own validation even though CI includes Windows unit tests.
- No automatic replay of interrupted actions or guaranteed business success
  from a completed Run.
- No stable 1.0 API contract yet. Pin a version and review API and storage
  migration notes before upgrading. See [Versioning](versioning.md).

## Integration checks before deployment

Run the example against the installed tarball, then test your host's actual
transport disconnect/reconnect, duplicate submissions, unauthorized approval
attempts, cancellation, process restart and output-delivery failures. Exercise
live providers and the target filesystem separately. Unit and demo checks
cannot establish those deployment properties.
