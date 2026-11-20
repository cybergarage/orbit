# Offline Project Memory Quality Evaluation

This procedure exports existing pilot answers for the official LongMemEval grader.
It does not regenerate answers, call a model, read credentials, enable runtime
features, or grade quality itself. Core functional tests and the session memory
attachment change in #43 are separate from this quality audit.

## Pinned evaluation inputs

- Cleaned dataset: `xiaowu0162/longmemeval-cleaned`, revision
  `98d7416c24c778c2fee6e6f3006e7a073259d48f`, file
  `longmemeval_s_cleaned.json`, SHA-256
  `d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442`.
- Official evaluation code: LongMemEval commit
  `9e0b455f4ef0e2ab8f2e582289761153549043fc`.
- Paper-compatible judge snapshot: `gpt-4o-2024-08-06`. The upstream command calls
  this `gpt-4o`; the output must record the full snapshot.

Keep upstream scripts outside the repository. The reviewed
[evaluate_qa.py](https://github.com/xiaowu0162/LongMemEval/blob/9e0b455f4ef0e2ab8f2e582289761153549043fc/src/evaluation/evaluate_qa.py)
and [print_qa_metrics.py](https://github.com/xiaowu0162/LongMemEval/blob/9e0b455f4ef0e2ab8f2e582289761153549043fc/src/evaluation/print_qa_metrics.py)
are authoritative for CLI behavior, rather than examples with different argument
counts. Their respective SHA-256 values are
`ecce9c4c79dc89d99534ac17b383a5cbb5b9f0c69ee98adaf0684742e3d95251`
and `e9283933a0cefb7a0ded7365e436ae3d1be5aac41853325e6155d83bf07607f0`.

## Offline export and validation

Use a completed local pilot report and the pinned dataset. The output directory
must be new and its parent must already exist. All paths below are placeholders.

```sh
node bin/project-memory-official-input.mjs export tmp/pilot.json tmp/longmemeval_s_cleaned.json tmp/official-input-new
npx mocha --forbid-only test/evaluation/project-memory-official-input.test.mjs
```

The tool checks dataset provenance, 30 unique planned IDs against reference IDs,
exactly one completed record per planned ID per arm, no execution errors, and
nonempty string answers. It writes `none.jsonl`, `pre.jsonl`, and `tool.jsonl`, each
with exactly 30 records containing only `question_id` and `hypothesis`. Whitespace,
Unicode and multiline answers survive JSONL roundtrips unchanged. No reference
answer, question, evidence label or prior judgment enters these files. The tool
never feeds evaluation data into answering Sessions.

An existing output directory, file or symlink is rejected. Files use exclusive
creation and restrictive permissions; failure may leave a partial new directory,
which must not be mistaken for a completed export. A successful exit confirms all
three files were written and read back. Existing reports/results are never edited.
Hypothesis files and datasets are local evaluation artifacts: do not commit them,
attach them to a PR, or publish raw grader stdout.

Only after separately authorizing paid evaluation, the upstream commands would be:

```sh
python evaluate_qa.py gpt-4o HYP REF
node bin/project-memory-official-input.mjs validate HYP HYP.eval-results-gpt-4o
python print_qa_metrics.py HYP.eval-results-gpt-4o REF
```

Repeat independently for each arm. `REF` is the pinned reference JSON file and
`HYP` is one exported JSONL file. The grader output is
`HYP.eval-results-gpt-4o`; the metrics script takes two arguments, with no model
argument. The grader loops over hypothesis rows and can skip unknown IDs. Before
running it, verify predictions with this exporter. Afterward, validation requires
exactly the same 30 unique IDs, identical hypotheses, a boolean `label`, and the
exact judge snapshot under `autoeval_label`. Order may differ. Validate before
aggregating; metrics alone do not establish completeness or valid label types.
The official script turns its response into a boolean using a substring check;
this validator checks its output contract, not the semantic correctness of a judge.

The upstream grader opens output with overwrite mode, prints raw questions,
answers and hypotheses, and includes API backoff retries without a project budget
cap. Any future paid runner must use fresh result paths, keep stdout private,
and bound attempts/cost. This exporter does not execute or wrap that paid runner.

## Read-only audit of the existing 30-case pilot

A 2026-11-20 local audit recovered all 90 answers from the recorded 2026-11-19
pilot: 30 per arm, no duplicate/missing IDs or generation execution errors. The
offline export roundtripped all answers exactly. Original artifacts were preserved;
only reviewed aggregates are recorded here. This is not a new benchmark run.

The historical ingestion saves the first 1,200 JavaScript UTF-16 code units from
each chronological source-session text. Of 26 answerable cases, only 15 retain at
least one entire annotated answer turn. Across selected cases there are 47
annotated turns: 25 fully retained and two partially retained. Recomputed whole-turn
retention agrees with every recorded `retainedEvidence` flag. A partial turn can
still contain sufficient evidence; a retained turn alone need not answer a
multi-session question.

| Category (five selected cases each) | Cases with an entire annotated turn retained |
| --- | ---: |
| Knowledge update | 3 |
| Multi-session | 4 |
| Assistant information | 1 |
| Preference | 3 |
| User information | 0 |
| Temporal reasoning | 4 |

Four selected cases are unanswerable and are excluded from the 26-case answerable
denominator. Two assistant-information cases have only partial annotated turns.

| Diagnostic | No retrieval | Host pre-retrieval | Model search |
| --- | ---: | ---: | ---: |
| Completed answers | 30 | 30 | 30 |
| Empty retrieved-entry set | 30 | 0 | 5 |
| Search dispatches absent | 30 | 30 (host query is not a tool dispatch) | 5 |
| Dispatched search with empty union | Not applicable | Not applicable | 0 |
| Nonempty retrieval, zero expected source sessions (answerable only) | Not applicable | 13 | 4 |
| All expected source sessions retrieved, old local judge incorrect (answerable only) | 0 | 3 | 3 |
| Explicit abstention marker | 23 | 18 | 14 |

All five model-search cases without dispatch are preference questions. These
observations distinguish no call from an empty result. They do not prove a query
was wrong or an answer failed after receiving the answer passage. The report
retains Core entry/source IDs and source-session recall counts, but not query
strings, returned text or the original-session-to-Core-entry mapping needed for
independent passage attribution. The union is not an individual-call trace.
Source recall uses the first six distinct retrieved entries. A prefix from a gold
source can count even when its answer text was discarded. The last diagnostic
row involving incorrect answers uses the fallible historical local judge and is
not an official quality result. The old failure classification additionally
prioritizes ingestion omissions; the table above does not apply that priority.

The old generic local judge does not implement official category-specific rules:
preference requires correct use of relevant personal information without covering
every rubric point; temporal durations allow off-by-one errors; knowledge updates
allow old information alongside the required updated answer; unanswerable grading
checks recognition that information is insufficient. Ordinary information tasks
require the necessary answer information. No historical accuracy value was updated
by this audit, and the five preference questions were not officially regraded.

## Next steps and cost inputs

1. Officially grade the existing answers, retaining snapshot and completeness
   checks, then inspect disagreements by category. Keep this separate from
   functional permission/call tests.
2. Add local evaluation-only query/result tracing and reversible entry-to-source
   mapping before attributing passage retrieval and answering failures. Do not
   return gold labels to ingestion, query selection or generation.
3. Preserve the prefix baseline and compare an independently specified ingestion
   condition in a small pilot before expanding. Do not select excerpts using the
   reference answer or `has_answer` labels.
4. Consider 500 cases only after measurement and cost controls are validated.

Using only the pinned pure prompt function offline, the existing 90 hypotheses
produce 75,448 prompt characters (24,985 / 24,354 / 26,109 by arm), with a maximum
single prompt of 1,657 characters. The official cap is ten output tokens per
request: 900 output tokens for 90 grading requests, before retries. These are
character counts, not token estimates; price estimation needs the correct
model tokenizer, message overhead, current input/output rates, retry budget and
provider access constraints. No tokenizer/model downloads or reachability probes
were used. The older four malformed local-judge calls have unknown usage; they
must not be silently assigned zero cost.

A 500-case comparison across three arms would require 1,500 grading requests and
at most 15,000 nominal output tokens before retries, plus separately budgeted
answer generation and ingestion. Its input volume cannot be extrapolated exactly
from these 30 cases. No official grading API, full 500-case run, generation rerun
or new model inference was performed for this audit.

OpenAI lists `gpt-4o-2024-08-06` for shutdown on 2027-01-14 in its
[deprecation schedule](https://developers.openai.com/api/docs/deprecations).
Availability was not probed. A replacement judge changes the evaluation condition
and must be reported explicitly, not presented as the paper snapshot.
