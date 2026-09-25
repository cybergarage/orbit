---
status: current
investigation-date: 2026-09-25
orbit-commit: 86a597ca0ae4f91e43b079b07965491e69d6d1f0
related-adrs:
  - docs/adr/2026-09-07-managed-run-lifecycle.md
  - docs/adr/2026-09-07-required-execution-journal.md
  - docs/adr/2026-09-14-verified-interrupted-tool-context.md
superseded-by: []
---

# Agent Execution Limits and GUI Continuation

## Purpose and research questions

Investigate whether Orbit's default five tool rounds match interactive coding
agents, and whether users can continue after budget exhaustion. This is
non-binding research, not approval to change runtime contracts or saved history.
The baseline is the Orbit commit above; existing unrelated E2E working-tree
changes were excluded from the investigation.

Questions:

1. Do Codex and Claude Code impose a comparable default tool-round limit?
2. How do iteration limits differ from context, usage, retry and spending limits?
3. Does Orbit provide both usable continuation input and a GUI recovery action?

## Findings

| System          | Ordinary execution loop                                                                                                      | Limits and continuation                                                                                                                                                                                                      |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Orbit           | Five tool rounds, six model calls and 32 requested calls by default; a separate Agent iteration limit also defaults to five. | Stops with `budget-exceeded`; GUI exposes the result and an ordinary composer, without a budget adjustment or continuation action.                                                                                           |
| Codex CLI/core  | The inspected main turn loop follows model/tool continuation and pending input, without a fixed five-round counter.          | Context compaction, errors/cancellation and configurable token budgets are distinct controls. Saved conversations can be resumed. This is not proof of unlimited service usage or of every desktop/cloud implementation.     |
| Claude Code     | Official documentation describes repeated investigation, action and verification.                                            | `--max-turns` is print-mode-only, opt-in, with no limit by default. `--max-budget-usd` is a separate print-mode control. `--continue` and `--resume` reuse conversations. Runtime internals were not independently verified. |
| Pi Coding Agent | The inspected loop continues while tool calls or steering messages remain and then checks follow-ups.                        | Extension termination, cancellation/errors, context management and bounded retry are separate concerns; no fixed five-round cap was found in the inspected loop.                                                             |

**Assessment:** Orbit's small compulsory defaults are unsuitable for the reported
coding workload. Raising one constant would not fix the separate history and GUI
continuation gaps. Neither comparison establishes an optimal replacement number.

## Orbit baseline and observed failure

Source evidence:

- `src/core/agent.ts`: `DEFAULT_MAX_TOOL_ITERATIONS`, `runAgentStage`, the stored
  model message preceding the iteration check, and `run.consume` calls.
- `src/core/execution/run.ts`: `DEFAULT_RUN_LIMITS`, `RunContext.consume`,
  `RunExecutionError`, and immutable terminal results.
- `src/core/thread.ts`: `executeRun` constructs invocation options without a
  per-request iteration/limit override and maps non-completed outcomes to errors.
- `src/apps/gui/client.tsx`: terminal status, composer and `submit` handling.
- `src/apps/gui/run-presentation.ts`: generic failure/cancellation presentation.
- `src/core/session/compaction.ts`, `context-policy.ts`, `verified-context.ts`,
  `interrupted-context.ts`: tool-group validation and interruption eligibility.

A user-reported local coding session was inspected read-only. Private paths,
identifiers, prompts and transcript contents are deliberately not reproduced.
It used Ollama and completed five tool rounds containing nine successful read or
search calls. Its sixth model response requested another tool. Orbit persisted
that assistant message, then stopped before dispatch because the Agent iteration
limit was reached. Elapsed time was approximately 26 seconds, below the ten-minute
deadline. The journal recorded `budget-exceeded`, acknowledged recording,
quiescence, no unresolved operations and no cleanup errors. No editing or test
execution occurred in that Run.

This demonstrates a workload failure, not a provider/network failure or a
measurement of general model quality. It also demonstrates why a tool-round count
is not the same as a tool-call count.

### GUI gap

The current client renders:

```text
Run: budget-exceeded. Recording: acknowledged.
```

`acknowledged` describes required recording; it does not establish task completion
or eligibility for another model request. The textarea remains available when a
thread exists. On a terminal failure, the ordinary Send control is displayed,
with no special continuation action, budget editor, exhausted-counter explanation
or history-eligibility check. `submit` sends a new user request rather than
resuming the old Run. Its request-ID reuse handles uncertain submission delivery,
not an extension of an exhausted Run.

The problem is therefore not that an input field exists: the field implies a
usable next action while the UI does not explain what can actually continue.

### History gap and read-only verification

Using the current TypeScript source loader, the saved transcript was decoded with
`parseSessionFile`; message entries were converted to `Message` instances without
opening a writer or invoking a provider. Two direct checks returned:

| Check                                                            | Result                       |
| ---------------------------------------------------------------- | ---------------------------- |
| `validateToolGroups(messages)`                                   | `Unresolved tool call group` |
| `verifyInterruptedCorrespondence({entries, records, sessionId})` | `ineligible-interrupted-run` |

The first check explains the failure of the budgeted context-preparation path:
the final stored assistant call has no matching result. The second check explains
why enabling the existing interruption feature is insufficient. Its verifier
requires a journal terminal outcome of `cancelled`, whereas this Run is
`budget-exceeded`. An old v2 transcript additionally requires explicit migration
before enabling that feature; migration alone does not change eligibility.

These are direct helper checks against retained evidence, not a live GUI replay
or a full model continuation test. With context budgeting and interruption
projection both disabled, this particular validator is bypassed; provider
acceptance and useful continuation of the incomplete group remain unverified.
Thus it would be inaccurate to claim every new prompt necessarily fails, or to
recommend ordinary resubmission as a reliable recovery procedure.

## External systems investigated

All sources were inspected on 2026-09-25. Public repository HEADs were resolved to
the full commits below before fetching files. These are inspection pins, not
claims about the user's installed versions. No external agent was built or run.

### Codex

Pin: `aa380897f67b91e1a47d530d7286d497b6726d3f`.

- [`session/turn.rs`](https://github.com/openai/codex/blob/aa380897f67b91e1a47d530d7286d497b6726d3f/codex-rs/core/src/session/turn.rs):
  the main `loop` uses `needs_follow_up` from model continuation and pending
  input. It can compact context mid-turn and continue; ordinary errors emit a
  lifecycle event and return control for further conversation. There is no
  comparable small fixed round counter in this loop.
- [`config/mod.rs`](https://github.com/openai/codex/blob/aa380897f67b91e1a47d530d7286d497b6726d3f/codex-rs/core/src/config/mod.rs):
  rollout token budgeting is feature-gated and requires a configured positive
  token limit when enabled. Goal budgets and context budgets are separate fields.
- [`exec/src/cli.rs`](https://github.com/openai/codex/blob/aa380897f67b91e1a47d530d7286d497b6726d3f/codex-rs/exec/src/cli.rs):
  inspected for corresponding public execution flags; no equivalent default
  five-round cap was found.
- [`context_manager/normalize.rs`](https://github.com/openai/codex/blob/aa380897f67b91e1a47d530d7286d497b6726d3f/codex-rs/core/src/context_manager/normalize.rs):
  absent function/custom call outputs can receive an `aborted` representation.
  This provides a comparison for model-input continuity, not evidence that every
  absent output proves nonexecution or permission for Orbit to rewrite history.
- [`session/turn_suspension.rs`](https://github.com/openai/codex/blob/aa380897f67b91e1a47d530d7286d497b6726d3f/codex-rs/core/src/session/turn_suspension.rs)
  was also inspected to distinguish turn suspension from a new user request.

Official [CLI documentation](https://learn.chatgpt.com/docs/codex/cli) exposes
`codex resume` for saved chats. Official [usage documentation](https://learn.chatgpt.com/docs/pricing)
describes account allowances and reset times separately from internal tool rounds.
OpenAI Agents SDK max-turn defaults are not evidence about the Codex CLI loop.

### Claude Code

The official [CLI reference](https://code.claude.com/docs/en/cli-reference)
explicitly documents no default limit for print-mode `--max-turns`; setting it
makes reaching the limit an error. It separately documents a dollar budget and
conversation continuation/resumption. The official
[execution overview](https://code.claude.com/docs/en/how-claude-code-works)
describes chaining many actions through investigation, implementation and
verification with user interruption available.

Public distribution/documentation repository pin:
`e1bb7b065bc29117ab5923f8772fee16a4630a0d`.
Inspected [`README.md`](https://github.com/anthropics/claude-code/blob/e1bb7b065bc29117ab5923f8772fee16a4630a0d/README.md)
and [`CHANGELOG.md`](https://github.com/anthropics/claude-code/blob/e1bb7b065bc29117ab5923f8772fee16a4630a0d/CHANGELOG.md).
The changelog records fixes for max-turn enforcement and for a queued message
being lost at that boundary. These are contrary evidence to treating continuation
as automatically reliable in every release. They are vendor reports, not tests
reproduced here. The public repository pin is not a pin of proprietary loop source;
the current official documentation has no immutable runtime revision.

### Pi Coding Agent

Pin: `5fd446ca1843682e8da3fec4ceb71c42f56fbace`.

- [`agent-loop.ts`](https://github.com/badlogic/pi-mono/blob/5fd446ca1843682e8da3fec4ceb71c42f56fbace/packages/agent/src/agent-loop.ts):
  continues while tools or steering require another response, then checks queued
  follow-ups. `finishTurn` may explicitly end or continue; errors/aborts end the
  loop. No fixed five-round counter appears in the inspected implementation.
- [`agent.ts`](https://github.com/badlogic/pi-mono/blob/5fd446ca1843682e8da3fec4ceb71c42f56fbace/packages/agent/src/agent.ts):
  exposes `continue`, steering and follow-up queues, with state-dependent checks.
- [`agent-session.ts`](https://github.com/badlogic/pi-mono/blob/5fd446ca1843682e8da3fec4ceb71c42f56fbace/packages/coding-agent/src/core/agent-session.ts):
  handles compaction and retry separately, including a configured maximum retry
  count. Lack of a round cap must not be generalized to lack of all limits.

## Implications for Orbit (non-binding)

1. Replace the compulsory five-round coding experience with an explicit product
   policy. Interactive coding should not stop after a small unexplained counter;
   deterministic batch/CI budgets should remain available. Whether the interactive
   cap is optional or substantially larger needs a separate architectural decision
   and representative workloads. Do not merely change five to another unmeasured
   number or disable permissions to bypass an unrelated execution budget.
2. Unify the effective Agent and Run limits and expose them through settings,
   Thread/service APIs and GUI. A larger `toolRounds` alone leaves
   `maxToolIterations` and `modelCalls` as independent stopping conditions. Time
   limits and cleanup ownership need their own product treatment.
3. Return structured exhaustion detail: which limit, configured maximum, consumed
   amount and requested increment, plus whether new conversation input is usable.
   Preserve `budget-exceeded` as its own outcome instead of asking users to infer
   it from generic cancellation/failure events.
4. Make future budget stops leave valid subsequent model context. Consider explicit
   nondispatch results at the stopping boundary and/or an evidence-verified derived
   input for known budget stops. Evaluate persistence failures and partially
   completed batches; never label unknown execution as a successful result.
   Existing cancelled-only projection contracts require an explicit follow-on
   decision before broadening eligibility.
5. Provide a GUI explanation and an intentional **Continue** action with revised
   limits when eligible. A terminal Run remains immutable: continuation should
   create a new Run/request with the old conversation and a visible relationship
   to the stopped work. It must not blindly replay the unexecuted command. If
   continuation is unavailable, explain why and provide a supported recovery or
   transfer-to-new-conversation route instead of an unexplained ordinary composer.

Suggested future validation includes a task requiring more than five rounds;
every limit independently; budget exhaustion before a tool dispatch; a mixed
tool batch; valid same-session continuation; old v2 history; and GUI state after
reload/reconnect. These are proposed acceptance cases, not completed results.

## Limitations and related work

The investigation establishes source behavior and a local history-validation
failure, not comparative task-completion rates. It does not identify the best
numerical limits for Ollama or commercial providers. The actual GUI was not
operated, and no stopped user Run or saved settings were changed.

See [managed execution](../execution.md),
[interrupted context](../interrupted-context.md),
[the original execution investigation](2026-09-07-run-execution-approval-and-recording.md)
and [cancelled-tool history research](2026-09-14-cancelled-tool-history-and-context.md).
The related accepted ADRs remain authoritative; this note does not supersede or
implement them.
