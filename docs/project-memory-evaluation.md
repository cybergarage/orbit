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

## Paired ingestion study and private tracing

The [paired replay report](../test/evaluation/results/2026-11-20-ingestion-replay.md)
compares two question-blind ingestion policies on the same pinned 30 cases:

- **Prefix:** the unchanged historical path. It stores the first 1,200
  JavaScript UTF-16 code units from each rendered source Session, exactly as
  before. It does not use the question or annotations.
- **Turn chunks:** pack adjacent complete rendered turns within each source
  Session into contiguous excerpts targeting 4,096 UTF-8 bytes. A larger
  single turn can occupy an entry by itself up to the Core cap of 8,192
  bytes; a turn larger than that is omitted, not silently split. Admission
  gives each chronological Session one chunk before taking its second, and
  so on; admitted excerpts are then saved in original chronological order.
  The 128-entry and 1 MiB body caps are unchanged. Record cap omissions by
  reason separately from ranking and return-budget omissions. No question,
  dataset source label, answer annotation, or reference enters ingestion.

Build the checkout and place the SHA-256-pinned dataset from the guide above in
the fixed filename below under ignored local storage. The harness prints the
new private directory it creates directly in the existing `tmp/` directory:

```sh
npm ci
npm run build
mkdir -p tmp
node bin/project-memory-ingestion-study.mjs --mode replay \
  --dataset tmp/longmemeval_s_cleaned.json \
  --commit "$(git rev-parse HEAD)"
TS_NODE_PROJECT=tsconfig.test.json npx mocha --forbid-only \
  'test/evaluation/project-memory-*.test.mjs'
```

`replay` is the default and makes no inference calls. Both policies use the
same historical host query (first 512 code units of the date and question).
It reports question and turn coverage before retrieval, at six positive-overlap
candidates, and after the existing preparation/result budgets. Fixture source
IDs and timestamps are deterministic; live ranking ties can differ. `mock`
runs synthetic requests and the real local Core search without contacting a
model. A mock wire record is not counted as provider delivery.

Only use `--mode live` when explicitly running the local model comparison. The
pinned JSON fixture uses the fixed name `tmp/longmemeval_s_cleaned.json`. Its
exact size and SHA-256 are checked. Run directories have generated names; a
resume argument only selects a known filesystem entry. Absolute paths, nested
names and symlinks are rejected. Live mode requires the historical
Ollama `gemma4:12b` digest
`4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c`
on loopback; there is no download or fallback.

Use the same 30 ordered cases, ingestion policies, search and answer budgets,
temperature zero and thinking-off. Each question has one shared no-search answer
from an empty fixture, plus two host-prefetch and two model-search answers
(one for each ingestion policy), for **150 unique answer slots**. Its no-search
label is counted identically in both comparison rows. The judge gets only the
question, reference, abstention flag and one saved hypothesis. It never sees
the arm, other answers, or traces. It uses the same local model with an output
cap of 128 and a 120-second local request timeout; this is not the official
LongMemEval grader. There are up to 450
local answer calls and 150 separate local judge calls.

### Resume a checkpointed study

Start a new `live` or `mock` run without an output argument. Keep the printed
`Run directory` name. Reissue the same arguments with
`--resume --output-dir tmp/ingestion-study-ID`, using that exact printed name.
The protocol verifies the private run identity, exact manifest and ordered
case IDs, source/build and dependency fingerprint, SDK/runtime versions,
model and dataset identity, and prompt, rubric and budget settings before
making inference calls. The optional resume is **not** available in offline
replay mode. The prior partial 24-pair comparison used a different protocol
and is not resumed, pooled or regraded here.

Each exact answer and its trace are synced and published together before
grading, without replacing a committed record. A second active writer is
refused; ambiguous ownership or invalid/mismatched records fail closed.
A completed answer is reused even if grading was interrupted. A judge failure
or invalid grade remains pending and can be retried on resume. A recorded failed
answer is explicit and is not automatically regenerated. If the process stopped
before saving an answer, that slot may run again; this is not an exactly-once
inference guarantee. Windows does not guarantee power-loss directory sync.

Checkpoint files contain exact public-benchmark hypotheses, queries, trace
metadata and identifiers. Keep them in the private, owner-only POSIX run
directory and never commit or attach them. `summary.json` is a replaceable,
aggregate-only view, not a resume input. Missing grades are never counted as
incorrect, and paired denominators require valid completed judgments on both
sides. The fully offline tests interrupt a child process after durable answer
publication but before grading and verify that a resumed run preserves the
answer and trace, grades without regenerating the answer, and matches the
uninterrupted mocked results.
