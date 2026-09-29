# Empty and incomplete summary recovery — live diagnostic, 2026-09-29

All three isolated diagnostics completed and retained **2/2 acknowledged saves**
after persistent Session reopening and real-model compaction. In the two
controlled invalid-response conditions, Orbit detected the defect and obtained
a valid replacement from actual Ollama using the original evidence.

| Condition                 | Invalid-response detection | Summary attempts           | Compaction time | Estimated request tokens | Direct source check |
| ------------------------- | -------------------------- | -------------------------- | --------------- | ------------------------ | ------------------- |
| Natural output            | None                       | 1                          | 48.84 s         | 10,066 → 1,274           | Pass, two records   |
| Injected empty summary    | `empty`                    | 2 (one injected, one real) | 38.56 s         | 10,066 → 1,106           | Pass, two records   |
| Injected missing category | `missing-fields`           | 2 (one injected, one real) | 43.69 s         | 10,066 → 1,189           | Pass, two records   |

The injection replaces only the first invoked summary response. It is **not a
naturally occurring model failure**. A fixed setup model executes two actual
built-in writes, closes the persistent Session, then reopens it. Subsequent
summary regeneration and the consumer use `ornith-1.5:9b`; the consumer has no
tools. Each condition has its own workspace, Session and container. All runtimes
were quiescent, without unresolved operations or cleanup errors.

The consumer answers reported both saves and stated that no tests/behavioral
verification occurred. The direct checker separately matched the deterministic
view with canonical tool results. Neither source-ID membership nor this checker
proves every model-written statement; current file state and verified behavior
remain separate facts.

## Implemented fix and validation

Core commit `fb63aaa` adds an explicit prompt output contract and detects empty
summaries/missing required fields. It requests one corrective generation from
the same original evidence, using deterministic feedback rather than replaying
invalid model text. A repeated recoverable defect falls back to smaller complete
tool groups; failing batches shrink until a single group remains. Invalid
summaries are never persisted, and required categories are not fabricated.

All requests are measured and charged to the Run; cancellation, deadlines,
unknown-source rejection and existing capacity fallback remain active.
`context.summary.validation-failed` distinguishes the correction reason. This
adds no agent iteration cap, public model API, provider formatting option or
transcript version. It is a local recovery fix under the existing compaction
policy; no new ADR is needed. **JSON mode plus a prompt contract is not
provider-enforced JSON Schema.** Validation remains mandatory.

Headers and build passed; the full suite passed **1,056 tests**, including
**68** focused observation/compaction/long-turn tests. New tests cover empty,
missing-category and missing-test-field regeneration, identical original source
for correction, smaller-source recovery, cancellation during correction and
model-call budget exhaustion. Host E2E checks passed 19, direct checker 4 and
semantic evaluator 11. Formatter-only changes to unrelated E2E files were
restored before image creation.

[Curated JSON](2026-09-29-summary-validation-recovery-live.json) includes full
commits, exact image/model identities, accepted summaries, answers and usage.
The model digest is
`e5df7dcdd8a263994df62d610317e07be0d6af23f96fcbd8543273058fce575e`, Q4_K_M,
Ollama 0.34.4. Context 32,768; output 2,048; seed 42; temperature 0.6; top-p 0.95;
thinking disabled. Diagnostic-only trigger/target are 3,500/2,500 and the deadline
is 300 seconds. Driver commit is `982c02c`.

Real provider usage (input/output) was 12,266/1,092, 12,092/703 and 12,226/854.
The injected response consumes one core invocation but has no actual provider
tokens. These are one-off diagnostics with different source UUIDs, not an
isolated timing or statistical reliability comparison. No SWE solve-rate claim
follows from these three controlled cases.

## Reproduction

Follow the [live diagnostic instructions](../../docs/e2e-evaluation.md#live-reopened-projection-diagnostic).
Build the current local image, then run three times with fresh container names
and output directories: no fault environment variable, `-e
ORBIT_E2E_SUMMARY_FAULT=empty`, and `-e
ORBIT_E2E_SUMMARY_FAULT=missing-fields`.
Copy `/output` before removing each container, then run
`npm run eval:core-observations` on its `observations-live/result.json` and
`events.jsonl`. The injected runs also save `injected-fault.json`.

Inspect runtime, `context.summary.validation-failed`, accepted compaction and
source correspondence independently. Raw Session/journal data stays under
ignored local `tmp/`; only curated measurements are tracked. The separate
[results index](README.md) contains official SWE-bench evaluation records.
