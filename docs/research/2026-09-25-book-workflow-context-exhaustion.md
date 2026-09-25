---
status: current
investigation-date: 2026-09-25
orbit-commit: 03753d8c9e26b0c3632bda3fe9659eef8288f6c4
related-adrs:
  - docs/adr/2026-09-08-budgeted-session-compaction.md
  - docs/adr/2026-09-25-unlimited-run-budgets.md
superseded-by: []
---

# Book Workflow Failures at Context Exhaustion

## Purpose and research questions

Determine which failures in the unlimited Vibe, SDD and Loop rerun can be
addressed by Orbit, rather than attributing every failure to model capability.
Distinguish prevention of runtime interruption from successful completion of
the memory-game task. This investigation proposes no accepted implementation.

## Findings

**Context exhaustion is the first issue to address.** All three implementations
reached the effective 32,768-token context window. Vibe returned a truncated
response that Orbit treated as completed. SDD and Loop failed while Ollama
parsed incomplete tool arguments. Replaying the failed requests with a larger
context tests the latter explanation independently of task completion.

| Case | Recorded evidence near termination                                                                | Runtime result | Task result                                          |
| ---- | ------------------------------------------------------------------------------------------------- | -------------- | ---------------------------------------------------- |
| Vibe | Final response: 32,706 input + 62 output = 32,768 tokens; `done_reason: length`; no tool calls    | `completed`    | Type-check passed, Vitest failed; no browser grading |
| SDD  | Last successful response: 32,620 input + 82 output; next request failed parsing `bash` arguments  | `failed`       | Independent type-check failed; no browser grading    |
| Loop | Last successful response: 32,456 input + 53 output; next request failed parsing `write` arguments | `failed`       | Unchanged `progress.md` blocked grading              |

Vibe's final text diagnoses eight cards instead of sixteen but does not fix it.
The earlier interpretation of that answer as a natural completion is corrected
by its recorded `length` stop. Neither a tool-free response nor a runtime
`completed` result proves the task succeeded.

## Orbit baseline and evidence

Inspected revision: `03753d8c9e26b0c3632bda3fe9659eef8288f6c4`. The live matrix
recorded parent `c06a7603c1e9994955075018d44901247a21e519` plus the harness diff
subsequently committed in that inspected revision. The ignored local evidence
is under `tmp/e2e/runs/2026-09-25T11-41-35.068Z-book/`: `environment.json`,
`working-tree.patch`, per-case `implementation/input/config.json`,
`implementation/output/events.jsonl`, `implementation/output/result.json`,
and grader logs. These local artifacts are not included in Git.

The model was `ornith-1.5:9b`, digest
`e5df7dcdd8a263994df62d610317e07be0d6af23f96fcbd8543273058fce575e`, served by
Ollama 0.34.3. Implementation settings were `num_ctx: 32768`,
`num_predict: 4096`, `seed: 42`, `temperature: 0.6`, `top_p: 0.95`,
and `think: false`. Unlimited aggregate budgets did not change those settings.
The SDD review used a separate session and completed successfully.

### Verified runtime gaps

1. **No context preparation in these trials.**
   `src/core/agent.ts` defaults `contextPolicy` to `disabled`.
   `e2e/worker.mjs` does not enable a budgeted profile. Ordinary tool iterations
   therefore send growing conversation history without reserving output space
   through Orbit's context policy. The provider-reported effective usage is
   stronger evidence here than an approximate token count from another tokenizer.
2. **Existing compaction is insufficient for this shape of task.**
   `src/core/session/context-policy.ts:prepareSessionContext` protects the latest
   user turn, or the current Graph turn boundary. Its cut is before that turn,
   not between completed tool rounds within it. Each book implementation is one
   long turn. Enabling the existing policy alone eventually refuses with
   `protected-context-exceeds-budget` rather than compacting those tool rounds.
3. **Truncation is not a completion gate.**
   `src/core/models/adapters/ollama.ts` preserves `done_reason` as `stopReason`.
   `src/core/agent.ts:runAgentStage` nevertheless completes a tool-free response
   without checking that reason. A deterministic fake-model probe returning
   `stopReason: length` reproduced `outcome: completed`.
4. **Provider parse failure is terminal.**
   The Ollama adapter records and rethrows SDK errors. Agent propagates them to
   Run failure; there is no context-aware recovery at that boundary. The error
   is raised before Orbit receives a complete tool call, so this is not a
   failure of Orbit's tool-input JSON parsing or an executed tool operation.
5. **The E2E wrapper overrides prepared output budgets.**
   `e2e/worker.mjs` merges `request.options` before `config.options`. Its fixed
   `num_predict: 4096` would override `maxOutputTokens` selected by ordinary or
   summary context preparation. A future budgeted trial must make the counted
   request and the actual provider request agree, including summary reserves.

### Additional verification weakness

The Bash tool uses `bash -c` and reports the shell's exit status. The runs often
used pipelines such as `npm test | tail`, and sometimes appended an `echo`.
Recorded check output contained failures while the reported exit code was zero.
For example, Vibe diagnostic sequence 186 records ten failed tests but a
successful tool result. The error text was still available to the model; it
was not erased. This is therefore a misleading machine-readable signal, not
proof that it caused the coding errors.

A local shell probe reproduced exit 0 for a failing command piped to `cat` and
exit 1 with `pipefail`. `pipefail` alone does not fix `test; echo ...`, deliberate
error masking, or every SIGPIPE interaction. An explicit verification runner
that retains the actual command's status is more reliable than searching output
for words such as "error". The independent grader correctly rejected failures;
its summary `browser` field is misleading when a preceding check fails before
Chromium runs.

## Controlled probes

The local `diagnosis/` artifact directory records probe scripts, raw provider
responses and summarized output. No returned tool was dispatched, no solver
file was repaired, and no probe was counted as a successful book run.

- A fake `length` response reproduced erroneous runtime completion.
- A budgeted single-current-turn fixture reproduced
  `protected-context-exceeds-budget` with zero model invocations.
- A shell fixture reproduced pipeline exit-status masking.
- Real Ollama replays reconstructed each failed request from the recorded
  prepared request plus the worker's recorded transport overrides. The only
  varied generation setting was `num_ctx`; `num_predict` remained 4096.

| Request                   | Context | Result                                                                        |
| ------------------------- | ------- | ----------------------------------------------------------------------------- |
| SDD final failed request  | 32,768  | HTTP 500; same incomplete `bash` argument JSON                                |
| SDD final failed request  | 65,536  | HTTP 200, `stop`; 36,634 input / 71 output tokens; valid `bash` arguments     |
| Loop final failed request | 32,768  | HTTP 500; same incomplete `write` argument JSON                               |
| Loop final failed request | 65,536  | HTTP 200, `stop`; 32,695 input / 3,455 output tokens; valid `write` arguments |

Both comparisons support context capacity as the trigger for these particular
interruptions, rather than exhaustion of the 4096-token generation allowance.
The Loop response requires 36,150 input-plus-output tokens, exceeding the old
window despite staying below the output allowance. These probes do not
demonstrate that the returned commands fix either task. Each condition
was sampled once; fixed seeds do not eliminate all inference variability.

## External systems investigated

Source inspection only; Codex and Pi were not run against these fixtures.

- **Codex**, `aa380897f67b91e1a47d530d7286d497b6726d3f`,
  [`codex-rs/core/src/session/turn.rs`](https://github.com/openai/codex/blob/aa380897f67b91e1a47d530d7286d497b6726d3f/codex-rs/core/src/session/turn.rs):
  the post-sampling path checks context limits and can perform mid-turn automatic
  compaction before continuing model/tool work. This supports a compaction
  boundary within a long task, but does not prove that Orbit can reuse Codex's
  persistence or restoration rules unchanged.
- **Pi Coding Agent**, `5fd446ca1843682e8da3fec4ceb71c42f56fbace`,
  [`packages/coding-agent/src/core/agent-session.ts`](https://github.com/earendil-works/pi-mono/blob/5fd446ca1843682e8da3fec4ceb71c42f56fbace/packages/coding-agent/src/core/agent-session.ts):
  `_checkCompaction` distinguishes threshold compaction, context overflow and
  recoverable length stops. It permits one compact-and-retry recovery and
  treats context overflow separately from ordinary retries. This supports
  classified recovery, not endless retries of unchanged requests.
- **Ollama**, `v0.34.3`, commit
  `6383a0fa9cbf97494b847226e189f6e36b401a08`,
  [`llm/llama_server.go`](https://github.com/ollama/ollama/blob/6383a0fa9cbf97494b847226e189f6e36b401a08/llm/llama_server.go):
  the chat path recognizes a `length` finish, then parses accumulated tool-call
  arguments. Invalid argument JSON returns an error before the final response
  and its finish reason/usage are delivered. Thus an incomplete tool generation
  can surface as a generic provider failure instead of usable `length` metadata.

## Non-binding implications for Orbit

Recommended order:

1. **Correct termination classification.** Normalize provider termination
   reasons and prevent a truncated response from being recorded as completed.
   Preserve the partial response and original cause. An honest incomplete
   result is an immediate improvement, even before recovery is available.
2. **Support compaction inside a long active turn.** Reserve output space using
   the effective provider window, and choose cuts only after complete tool
   call/result groups have settled. Preserve the task, constraints, changed
   paths, verified check results and unfinished work. Keep raw history and
   journal evidence; do not truncate arbitrary messages or split pending tool
   groups. Existing whole-turn protection is an intentional contract that needs
   a new ADR before changing it.
3. **Add classified recovery after capacity is restored.** For a truncated or
   malformed provider response that dispatched no new tools, compact or use an
   explicitly selected larger window, then regenerate. Keep retry attempts
   observable and bounded independently of unlimited aggregate task duration.
   Do not repair partial JSON by guessing closing tokens and then execute it;
   do not repeat already executed tool effects or blindly retry the same full
   request. Treat unknown provider failures separately.
4. **Strengthen verification evidence.** Consider a dedicated check runner,
   with explicit commands, actual exit status and bounded log presentation.
   Evaluate a `pipefail` option with portability and compatibility tests rather
   than changing all shell semantics without review. Record grading phases
   separately from browser results. Optional workflow completion checks can
   require `progress.md` and configured tests; the generic Agent must not infer
   arbitrary verification commands or confuse runtime completion with success.

A 64K configuration is a useful diagnostic/control and may defer interruption,
but every finite window can fill. Increasing `num_predict` alone can consume
more of the same window. Neither is a substitute for safe mid-turn compaction.
Underlying TypeScript errors, the eight-card Vibe implementation, and inadequate
progress reporting remain task-quality problems. These changes create room to
repair them; they do not guarantee the model will do so.

## Validation plan and limitations

Add deterministic coverage for text and tool-bearing length stops, current-turn
compaction at settled tool boundaries, pending/unknown operations, cancellation,
summary failure, transcript/journal recovery, request/output-budget agreement,
and no duplicate tool dispatch during provider recovery. Retain numeric and
unlimited aggregate-budget coverage. Test shell pipelines and explicit masking
separately.

Then rerun the same three workflows with pinned prompts, model digest and grader,
recording effective provider settings, compactions, retries, termination causes,
check phases and final task outcomes. Use multiple trials before claiming a
reliability improvement. This investigation changed no runtime or harness code,
ran no full-task repaired comparison and made no architecture decision.

## Related evidence and decisions

- [Input budgets and durable session compaction](2026-09-08-input-budgets-and-compaction.md)
- [Agent execution limits and GUI continuation](2026-09-25-agent-execution-limits-and-gui-continuation.md)
- [Budgeted session compaction ADR](../adr/2026-09-08-budgeted-session-compaction.md)
- [Unlimited Run budgets ADR](../adr/2026-09-25-unlimited-run-budgets.md)
- [Current compaction guide](../context-compaction.md)
