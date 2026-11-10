---
status: current
investigation-date: 2026-11-11
orbit-commit: 69f7bbdd94a190ea80f3d2113be2debfbbe7fbff
related-adrs: []
superseded-by: []
---

# OpenCode and an Orbit-based Development Application

## Purpose and Research Questions

Assess whether Orbit can power a dedicated application for developers who increasingly delegate implementation instead of working primarily in an editor or terminal:

1. What does OpenCode currently provide?
2. Which capabilities already exist in Orbit, and which require core or application work?
3. Which product propositions could differentiate an Orbit application?

The baseline is the clean Orbit checkout identified above. Evidence was gathered on 2026-11-11 JST. This is source and documentation research, not a comparative hands-on trial, architecture approval, or implementation authorization.

## Findings

**Assessment:** Orbit is a credible foundation for a bounded, single-user development application. It is not yet a complete substitute for OpenCode's development environment. Reuse its execution and persistence machinery; add an application layer for isolated changes, verification, preview, and delivery. Separately evaluate improvements to interaction and execution isolation in core.

The strongest initial proposition is a **development change with explicit acceptance evidence**: an accepted requirement, an isolated patch, checks against that exact patch, an executable demonstration when applicable, and a human adoption decision. This is a product hypothesis, not a demonstrated market gap. Competitors already provide previews, artifacts, worktrees, and review individually.

### OpenCode capability inventory

The public default documentation now describes V2. The `/docs/sdk/` URL redirects to V1. Do not combine the V1 SDK or LSP descriptions with V2 behavior.

| Area                     | Observed capability                                                                                | Evidence and boundary                                                                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Interfaces               | Terminal, desktop, and web; desktop downloads for macOS, Windows, and Linux                        | [Official introduction](https://opencode.ai/docs/). Distribution availability is documented, not installation-tested here.                                         |
| Models and configuration | Multiple providers, configurable agents, project instructions and commands                         | [Introduction](https://opencode.ai/docs/) and [agents](https://opencode.ai/docs/agents/). No provider-quality parity claim.                                        |
| Coding                   | File discovery, reading, editing, writing, patches, and command execution                          | [Tools](https://opencode.ai/docs/tools/). Patch exposure depends on model support.                                                                                 |
| Long work                | Background shell processes and foreground/background child sessions                                | Tools documentation; child sessions can be continued.                                                                                                              |
| User interaction         | Named agent profiles, planning/build workflows, questions, and permission decisions                | Agents, tools, and [permissions](https://opencode.ai/docs/permissions/). Permissions are distinct from OS isolation.                                               |
| Extensibility            | Skills, plugins, MCP, and JavaScript Code Mode for tool composition                                | Tools and [migration guide](https://opencode.ai/docs/migrate-v1). V1 plugins need porting.                                                                         |
| Workspace lifecycle      | Worktree creation/list/removal, session movement, and UI workspace selection                       | Pinned worktree service and new-session UI below; tools documentation.                                                                                             |
| Recovery and review      | Filesystem snapshots, structured file diffs, restore, conversation undo/redo                       | Pinned snapshot implementation and [snapshots](https://opencode.ai/docs/snapshots/). Capture is best effort, not a backup or universal transaction rollback.       |
| Long conversations       | Automatic/manual compaction and recent-context retention                                           | [Compaction](https://opencode.ai/docs/compaction/); summaries are lossy.                                                                                           |
| Beyond source code       | Web retrieval/search, attachments, experimental image generation, desktop-attached browser control | Tools documentation. Experimental and client-dependent features are not universal capabilities.                                                                    |
| Application integration  | V2 server API and `@opencode/client`                                                               | Migration guide. V1 SDK examples do not establish V2 compatibility.                                                                                                |
| Language intelligence    | V2 accepts LSP configuration but does not run LSP servers/tools/diagnostics                        | Explicit V2 migration statement; lint/typecheck/compiler commands are recommended instead. Older LSP pages are contrary version evidence, not proof of V2 support. |

### Orbit readiness

“Present” below means inspected source with relevant tests where noted, not validation of live model quality. “Missing” means no first-class implementation found in the inspected core, GUI, and public application surface; shell commands or third-party tools could supply lower-level actions.

| Capability                      | Baseline evidence                                                                                                                                                 | Assessment                                                                                                                                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model abstraction and tool loop | [Agent](../../src/core/agent.ts), [provider registry](../../src/core/models/factory.ts), [OpenAI adapter](../../src/core/models/adapters/openai.ts)               | Present. OpenAI uses non-streaming Chat Completions in the inspected path; do not assume Responses features.                                                                                       |
| Coding primitives               | [Built-in catalog](../../src/core/tools/builtins/index.ts), [coding tests](../../test/core/coding-tools.test.ts)                                                  | Present: read, list, glob, grep, edit, write, bash. Git/test commands can run through Bash; that is not a typed Git or test-result service.                                                        |
| Application integration         | [Application service](../../src/core/application.ts), [ThreadManager](../../src/core/thread.ts), [thread tests](../../test/core/thread.test.ts)                   | Present: create/resume/list, event subscription, run start/cancel, approval reply, model selection. Recommended host boundary already exists.                                                      |
| Durable execution               | [Run](../../src/core/execution/run.ts), [authorization](../../src/core/execution/authorization.ts), [contract tests](../../test/core/execution/contracts.test.ts) | Present: admission, required recording, bound approvals, revalidation, limits, cancellation, and explicit unknown outcomes. A completed Run does not prove a feature works.                        |
| Sessions and context            | [Session](../../src/core/session/session.ts), [context builder](../../src/core/session/context-builder.ts), [compaction](../../src/core/session/compaction.ts)    | Present; long-history semantic fidelity still needs realistic evaluation.                                                                                                                          |
| Projects and memory             | [Application service](../../src/core/application.ts), [memory service](../../src/core/projects/memory-service.ts)                                                 | Present, including curated selection and automatic extraction machinery. Not a versioned acceptance-specification system.                                                                          |
| Scheduled work and evaluation   | [Work store](../../src/core/execution/scheduled-work.ts), [evaluation evidence](../../src/core/evaluation/evidence.ts)                                            | Present foundations. The store is single-owner; evaluation distinguishes pass/fail/missing/not-run/indeterminate. Neither is a distributed worker platform or a ready-made product test dashboard. |
| Controlled workflow composition | [Graph executor](../../src/core/processor/graph-execution.ts)                                                                                                     | Present bounded managed composition. Not evidence of an OpenCode-style autonomous child-session supervisor with parallel isolated workspaces.                                                      |
| Existing GUI security           | [GUI server](../../src/apps/gui/server.ts)                                                                                                                        | Loopback, startup token, origin checks and request validation exist. This is a local host boundary, not remote multi-user authentication.                                                          |
| Live interaction                | Thread event union and active-run admission; OpenAI adapter                                                                                                       | Lifecycle/tool updates exist. No first-class token-delta stream, steering queue, or conversation-fork API was found. Same-thread concurrent runs are rejected.                                     |
| Development workspace           | Core tool catalog, application API, and GUI source inventory                                                                                                      | Missing first-class worktree lifecycle, baseline/patch ownership, change review/apply, safe file undo, and conflict resolution.                                                                    |
| Running product                 | Bash implementation and GUI inventory                                                                                                                             | Missing managed dev-server/preview lifecycle, browser evidence capture, and a typed artifact-to-revision binding. Command execution alone does not supply them.                                    |
| Isolation                       | Authorization preview warnings and MCP startup                                                                                                                    | No supplied OS sandbox. Approvals and workspace ownership do not contain arbitrary shell or MCP effects. A worktree also does not isolate processes, secrets, or networks.                         |

The [GUI integration guide](../gui-integration.md) already recommends keeping `OrbitApplicationService` in a trusted host process behind validated transport. This makes a new interface practical without rebuilding the agent loop.

## External Systems Investigated

All revisions are source baselines, not assertions that an installed release matches them. Only selected files were inspected; no external test suites or desktop applications were run.

| System          | Full revision                              | Inspected source and result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenCode        | `6c5d38d90a8cf1dfed1b72dbfeefaa8a2719e110` | [README](https://github.com/anomalyco/opencode/blob/6c5d38d90a8cf1dfed1b72dbfeefaa8a2719e110/README.md); [worktree service](https://github.com/anomalyco/opencode/blob/6c5d38d90a8cf1dfed1b72dbfeefaa8a2719e110/packages/core/src/worktree.ts) persists project ownership and delegates creation/removal to strategies; [snapshot service](https://github.com/anomalyco/opencode/blob/6c5d38d90a8cf1dfed1b72dbfeefaa8a2719e110/packages/core/src/snapshot.ts) exposes capture/files/diff/restore; [new-session view](https://github.com/anomalyco/opencode/blob/6c5d38d90a8cf1dfed1b72dbfeefaa8a2719e110/packages/app/src/new-session/view.tsx) exposes workspace selection. |
| Codex           | `37103d7f01e82162472c6fba7b4088d5a1303321` | [App-server documentation at revision](https://github.com/openai/codex/blob/37103d7f01e82162472c6fba7b4088d5a1303321/codex-rs/app-server/README.md) documents reconnectable approvals and application lifecycle details; [ThreadForkParams](https://github.com/openai/codex/blob/37103d7f01e82162472c6fba7b4088d5a1303321/codex-rs/app-server-protocol/schema/typescript/v2/ThreadForkParams.ts) defines a fork boundary including a last turn. Protocol presence does not verify every desktop behavior.                                                                                                                                                                    |
| Pi Coding Agent | `65c43bb520edf53f11923f7a927aefd05475c6af` | [SessionManager](https://github.com/earendil-works/pi/blob/65c43bb520edf53f11923f7a927aefd05475c6af/packages/coding-agent/src/core/session-manager.ts) implements append-only session branching; [AgentSession](https://github.com/earendil-works/pi/blob/65c43bb520edf53f11923f7a927aefd05475c6af/packages/coding-agent/src/core/agent-session.ts) exposes steering and follow-up queues. The former `badlogic/pi-mono` URL redirects to `earendil-works/pi`; the current source was fetched there.                                                                                                                                                                         |

Codex and Pi are relevant because Orbit needs an application lifecycle and an interruptible, persistent runtime, not only model calls. Pi demonstrates that a reusable harness can support multiple interfaces; Codex demonstrates that conversation forks and reconnect behavior need explicit integration contracts. Neither comparison establishes which harness solves more tasks.

## Differentiation Analysis

### Existing competition limits the proposition

- OpenCode already offers desktop/web interfaces, worktrees, browser tooling, and undo. These are table stakes for this direction, not differentiators by themselves.
- [Official OpenAI documentation on remote engineering](https://developers.openai.com/blog/mastering-codex-remote-for-engineering) describes worktrees, goals, steering, side chats, and inline review away from an editor. An editor-free workflow is already an explicit competitor proposition.
- [Cursor's dated product announcement](https://cursor.com/changelog/02-24-26) reports isolated cloud environments and demonstrations with videos, screenshots, and logs. “Shows proof that it works” alone is also insufficient differentiation. This is a vendor product claim, not an independently measured reliability result.
- Model choice, local operation, MCP, and skills help adoption but are not unique. Local execution does not imply offline inference or absence of network traffic.

### Ranked product hypotheses

| Priority | Hypothesis and concrete experience                                                                                                                       | Orbit fit                                                                                                | Contrary evidence and validation                                                                                                                                  |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1        | Acceptance-driven changes: each requested behavior links to the exact patch, checks, demo, unmet conditions, and an adoption decision                    | Run identity, operation outcomes, evaluation dispositions, and project memory offer reusable foundations | Competitors already expose artifacts and plans. Measure whether the explicit requirement-to-current-revision linkage reduces review time and overlooked failures. |
| 2        | Continuing maintenance for existing repositories: recurring checks create bounded proposed changes with project-specific compatibility and release rules | Scheduling, persisted conversations, skills, and project memory fit this workflow                        | Automations and memory are common. Differentiate through reliable project setup, policy reuse, and review quality for a narrow customer group.                    |
| 3        | Model-independent, locally controlled development with visible evidence and cost                                                                         | Provider-neutral core and local host are useful                                                          | OpenCode and Pi overlap strongly. Compare accepted-change cost and reliability; do not equate a cheap model with a cheap successful change.                       |
| 4        | Multiple agents working on separate tasks                                                                                                                | Thread/runtime machinery can be extended                                                                 | Competitors already support this; workspace isolation and integration conflicts make it expensive. Defer until the single-change loop is reliable.                |

Suggested initial audience: individual developers and small teams maintaining existing TypeScript web applications who can review requirements and changes but want to avoid routine terminal/editor operation. This is a proposed beachhead, not established demand. Web applications make an in-app demonstration practical; native applications, libraries, and infrastructure need different validation surfaces.

### Proposed user journey

1. Select an existing project and describe a change, such as adding CSV export to an orders screen.
2. Confirm observable acceptance conditions: selected rows, encoding, permissions, empty data, and compatibility constraints.
3. The application prepares an isolated working copy and runs the implementation through Orbit.
4. A change view shows affected behavior, source diff, automated checks, and an interactive preview when available.
5. Each acceptance condition is marked verified, failed, not run, or requiring human judgment. Evidence identifies the tested revision; edits invalidate affected results.
6. The user requests corrections or adopts the change through a reviewed commit/PR operation.

The primary screen could show a task list, the current specification and working result, and a verification/adoption panel. Conversation remains available for direction and explanation. Code inspection and terminal logs remain accessible for exceptions; eliminating every manual tool is not a credible initial promise.

## Non-binding Implementation Implications

### Responsibility boundaries

| Layer                            | Proposed responsibility                                                                                                                                         |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing Orbit core              | Model/tool execution, session/context persistence, Run identity, approvals, cancellation, recording, project memory, and bounded composition                    |
| Potential core extensions        | Model deltas, steering/follow-up lifecycle, conversation branching, and an execution-backend contract if containment must apply uniformly to managed tools      |
| Development application services | Worktree ownership, baseline/diff tracking, managed processes, preview routing, check adapters, artifact storage, acceptance records, and commit/PR integration |
| Desktop UI and host              | Task navigation, specification/preview/review views, notifications, credential onboarding, updates, validated IPC, and application lifecycle                    |

Avoid putting every Git or UI concern into the framework. Keep secret-bearing runtime services out of the renderer. Do not expose the existing loopback server remotely without designing a separate authentication/authorization boundary.

### Smallest useful prototype

Prioritize one repository type, one active change per worktree, and one supported host OS. First deliver project setup, requirement capture, isolated edits, build/typecheck/test execution, preview, diff review, and an explicit adoption operation. Preserve existing uncommitted work. Treat repository setup hooks and preview content as code/content with their own trust boundaries.

Before unattended execution, choose and test an isolation policy. A supervised local prototype can make its host privileges explicit, but a general unattended product needs enforced filesystem/process/network boundaries. Approval UX cannot substitute for this.

Token streaming improves responsiveness but need not block a basic prototype with honest lifecycle progress. Steering and forks become important when tasks run long. Native LSP is not an initial requirement: project test/typecheck commands can provide feedback, consistent with the OpenCode V2 migration guidance.

Defer a full source editor, debugger, remote fleet, autonomous multi-agent merging, and broad language support. A strong single-change workflow is a better test of the proposition than matching every competitor feature.

## Evaluation and Limitations

Architecture readiness and coding effectiveness are different questions. The existing [SWE-bench results index](../../e2e/results/README.md) contains small, selected, historical trials and unsuccessful context-heavy runs. It explicitly warns against treating repeated convenience samples as a representative benchmark. Those runs neither validate nor invalidate this checkout as a production coding application.

For a next evaluation, use the same repository revisions, tasks, model where feasible, budget, and acceptance criteria across Orbit and OpenCode. Record version-specific setup differences. Include a feature, regression repair, test failure, dependency update, long-history continuation, user interruption, restart, dirty worktree, and stale approval. Repeat trials instead of trusting one successful demo.

Measure accepted-change rate, false completion claims, review time, human interventions, time to a verified result, total model/execution cost, stale-evidence detection, and recovery without unrelated data loss. Distinguish command exit success, test success, visible behavior, human acceptance, and publication. A screenshot or a journal entry alone proves none of the others.

Conduct user observation with existing maintainers: which steps still force them into an editor or shell, which results they distrust, and whether an acceptance-linked view changes their decisions. Product differentiation, willingness to switch, willingness to pay, and implementation effort remain unmeasured. No schedule or competitive performance advantage is established by this investigation.

## Related Work and Open Questions

- [Public Execution API Review](2026-10-02-public-execution-api.md) provides earlier boundary analysis; its older revisions are not this note's external baselines.
- [Workflow Evaluation](2026-09-12-workflow-evaluation-evidence.md) provides background on evidence distinctions, not product acceptance semantics.
- Which initial users and repository type should be optimized first?
- Is the first product local and supervised, or expected to continue safely without the user present?
- Which artifacts and checks establish acceptance for that audience, and who can override a failed or missing check?
- Is a development application a separate package/repository, or a second first-party Orbit host?

No ADR is accepted or proposed by this note. Significant runtime, persistence, or isolation choices require their own researched decision before implementation.
