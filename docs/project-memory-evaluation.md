# Core Project Memory Evaluation

This harness uses isolated temporary SessionRepository and MemoryProjectStore
instances. It never enables automatic extraction or changes Nest. Run from the
Orbit checkout after building. No provider is called by the deterministic tests.

```sh
npm run build
TS_NODE_PROJECT=tsconfig.test.json npx mocha --forbid-only test/core/projects/memory-search.test.ts
npx mocha --forbid-only test/evaluation/project-memory-pilot.test.mjs
node bin/project-memory-pilot.mjs --smoke --mock
node bin/project-memory-pilot.mjs --smoke --model gemma4:12b
```

The synthetic live check explicitly saves a decision from Session A, creates B,
and gives B only a generic question, instructions and the search definition. It
asserts actual dispatch, retrieved entry/source IDs and the answer. Citation
presence is reported independently. The deterministic Agent checks additionally
cover disabled tools, Project isolation, scope injection, corrections, retirement,
source deletion, no matches, Japanese queries, invalid bounds and cancellation.
Mock results demonstrate plumbing, not model quality.

## Pinned public-data pilot

The official original dataset README deprecates the old dataset in favor of the
cleaned dataset. This pilot uses the author's cleaned LongMemEval-S at revision
`98d7416c24c778c2fee6e6f3006e7a073259d48f`, file
`longmemeval_s_cleaned.json`, SHA-256
`d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442`.
The harness verifies that checksum before selecting cases.

```sh
mkdir -p tmp
curl -fL https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/98d7416c24c778c2fee6e6f3006e7a073259d48f/longmemeval_s_cleaned.json -o tmp/longmemeval_s_cleaned.json
node bin/project-memory-pilot.mjs --dataset tmp/longmemeval_s_cleaned.json --output tmp/orbit-memory-mock.json --commit "$(git rev-parse HEAD)" --mock
node bin/project-memory-pilot.mjs --dataset tmp/longmemeval_s_cleaned.json --output tmp/orbit-memory-live.json --commit "$(git rev-parse HEAD)" --model gemma4:12b
```

Use an already installed, explicitly authorized local Ollama model. The harness
uses only `http://127.0.0.1:11434`, never downloads models and has no cloud fallback.
The output path is explicit. Generated reports contain per-case data and must stay in the ignored local `tmp/` directory. Publish only reviewed aggregates. Reports are checkpointed after each complete case;
an interrupted report includes selected IDs so missing planned cases are visible.
The full 500-case benchmark is outside scope.

Selection takes five cases from each of six official question categories, ordered
by SHA-256 of `orbit-pilot-v1:<question_id>`. An available `_abs` case is selected
first within each category, ensuring abstention coverage. Selection annotations
never reach ingestion or generation. The same stored entries are reused across
no-retrieval, host pre-retrieval and model-invoked search arms. Each arm gets a fresh
Session with no other arm's transcript. Generic instructions are identical. Only
the tool arm has the search definition. The pre arm receives the query's Core
results; no arm receives the reference answer or answer-source labels.

## Deliberately limited ingestion

History is sorted chronologically. Each original session becomes a registered
source containing role/content text, stripped of `has_answer`. A single canonical
memory saves its first 1,200 JS characters via `saveExcerpt`, with a neutral date
title. Dataset source IDs can contain `answer_`, so they remain evaluation-only;
model-visible sources use Core IDs. This question-blind prefix policy requires
no extraction-model calls and respects the 128-entry catalog limit. It discards
much history and is expected to miss facts. It is an evaluation baseline, not a
new production ingestion/extraction policy. Ingestion cost has zero model tokens;
its memory/source retention and omissions are distinct from retrieval quality.

## Measurement and limitations

All generation calls use the same model, temperature 0, `think:false`, 8,192 context
and 512 output cap, with at most three model calls/two tool rounds per arm. Provider
input/output token counts include all model rounds; elapsed time includes host
retrieval for the pre arm. Tool dispatch and available source IDs are recorded.
Evidence recall at six uses the first six distinct retrieved entries, mapped back
to official answer-session IDs only after generation. For multi-query tool rounds,
this is first-six union recall, not an oracle best query. Abstention uses the
explicit INSUFFICIENT_EVIDENCE marker. Unanswerable cases are excluded from evidence
recall's denominator.

A separate evaluation-only call to the same local model grades all three answers
against the reference. This is a fallible local judge, not the official LongMemEval
grading pipeline; report its accuracy by category alongside the stricter normalized
reference-containment proxy. Judge calls/tokens/latency are separate from generation.
The generic judge does not implement the official category-specific preference,
temporal or knowledge-update rules. Historical preference labels require a separate
rubric-aligned review; a syntax retry repairs JSON shape rather than grading policy.
Missing judgments are null and excluded from measured accuracy, with gradedN
reported. This does not establish benchmark-comparable accuracy. A separate judge
or human audit is needed before drawing quality conclusions.

On judged errors, classification first checks whether any full `has_answer` message
survived the prefix policy, then whether all expected source sessions were in the
first-six retrieval, otherwise attributes an answer error. This strict retention
check is conservative: partial messages can contain sufficient evidence. Attribution
is diagnostic, not causal proof. Provider/execution failures and missing judgments
remain explicit; answerable and unanswerable outcomes must be inspected separately.

Local provider billing is USD 0; electricity and hardware costs are unknown, not
zero. Reports preserve token counts rather than inventing token prices. Model
weights/digest, environment and baseline must accompany any published measurement.

Official sources: [dataset](https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned),
[original dataset deprecation notice](https://huggingface.co/datasets/xiaowu0162/longmemeval),
[LongMemEval](https://github.com/xiaowu0162/LongMemEval).

The host pre-query uses the first 512 characters of the supplied current
question/date string; the tool arm chooses its own bounded query. Recall is at
the source-session level: retrieving a prefix from an annotated session can count
even when that prefix omits the answer. Inspect the separate retainedEvidence
flag and error classification rather than interpreting source recall as answer
passage recall. Case selection is reproducible; generated UUIDs and model outputs
are not promised to be bit-for-bit identical across machines or runs.

## Recorded pilot and syntax retries

The [2026-11-19 report](../test/evaluation/results/README.md) separates actual local
measurements from mock runs. To retry only malformed judgments in a completed
90-arm report, preserving initial errors and all generated answers:

```sh
node bin/project-memory-regrade.mjs tmp/orbit-memory-live.json tmp/longmemeval_s_cleaned.json tmp/orbit-memory-live-graded.json
```

This performs at most one additional local evaluation call per missing judgment
case. It never retries an unfavorable valid score and never reruns answering,
ingestion or retrieval. The current grader constrains its output to exactly three
booleans and retains usage even when parsing fails. The recorded initial run
predates that telemetry fix; its four invalid initial calls have unknown usage.

Commit provenance is supplied explicitly with optional `--commit <full-sha>`.
Without it, `baselineCommit` is null; implementation file hashes remain recorded.
The harness never launches Git or any executable resolved through PATH. Historical
reports and grading/ingestion limitations are unchanged.

For the independent read-only pilot audit, pinned official grading CLI, offline
prediction exporter and result-completeness checks, see
[Offline Project Memory Quality Evaluation](project-memory-official-evaluation.md).
It does not convert the historical local-judge scores into official results.
