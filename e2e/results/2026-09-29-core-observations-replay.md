# Observation replay after core integration

The implemented Orbit revision preserves acknowledged operation facts separately
from checkpoint prose. The fixed model-consumer diagnostic reproduces the earlier
mixed result: extra observations recover omitted facts in one checkpoint but do
not make model interpretation reliable in the second.

| Checkpoint | Summary only | Summary + observations |
| --- | --- | --- |
| Stale saved state | 0/3 | 3/3 |
| Overclaimed verification | 0/3 | 0/3 |

All twelve requests completed. All twelve answers retain unverified behavior;
that criterion shows no improvement. The second comparison still reports the
zero-test selection too broadly as `failed`, and observation-assisted answers
misspell the required `latestBarSelection` key. The grader was not loosened.
See [individual answers and metadata](2026-09-29-core-observations-replay.json).

## What changed in Orbit

Runtime-origin metadata now binds real built-in edit/write/Bash completions to
existing journal intent/result digests. A deterministic view is reconstructed
from canonical results, measured as part of input, and projected separately from
summary prose. Existing persistence versions remain unchanged. The reader codec
is byte-identical to its pre-implementation version; durable v2 save/reopen and
journal-backed projection after reopen are tested.

Twelve core tests cover journal correspondence, changed input/output, reused
call IDs, cross-Session copying, custom tool names, latest saves, later failures,
stale command revisions, shell mutations, budget refusal, command omissions and
memory/persistent checkpoint projection. The complete suite passes 1,050 tests;
headers and build pass. The evaluation extractor's 18 tests and the direct
runtime diagnostic checker's 4 tests also pass.

The direct checker reads `context.observations.prepared` records against solver
entries, independently of model answers. An absent projection is `not-exercised`,
not success. Its provenance premise is a controlled runtime artifact; it does
not independently authenticate journal HMACs or prove behavioral correctness.

## Scope and reproducibility

Runtime source: `7f979eb` (full hash in JSON). Core commits: `ee3c5f5`, `291f9f0`;
direct checker: `7f979eb`. Model: `ornith-1.5:9b`, Q4_K_M, Ollama 0.34.4;
digest `e5df7dcdd8a263994df62d610317e07be0d6af23f96fcbd8543273058fce575e`.
Settings remain context 32,768, output 2,048, seed 42, temperature 0.6, top-p
0.95, thinking disabled, JSON output.

The historical fixture predates runtime provenance. These consumer replays
continue to use the evaluation-only known-trace extractor; they do not silently
authenticate old core messages. The actual core path is checked separately by
runtime tests and live solver diagnostics. This report is neither a summarizer
rerun nor an official SWE-bench solve rate. Extra input information and repeated
identical seeds limit inference; overlapping test/build activity prevents an
isolated timing comparison.

Use the two-checkpoint [reproduction commands](2026-09-29-context-observations.md#reproduction)
with new output directories. Run `npm run test:e2e:core-observations`, then follow
[direct-checker instructions](../../docs/e2e-evaluation.md#check-core-observations-independently-of-model-answers)
for actual solver artifacts. Official solver/grader results are recorded
separately in the [results index](README.md).

The adopted [ADR](../../docs/adr/2026-09-29-source-derived-tool-observations.md)
distinguishes acknowledged operations from current workspace contents and
verified behavior. Reliable framework-specific test counts and model-consumer
interpretation remain separate concerns; this implementation does not infer
assertion coverage from generic Bash success.
