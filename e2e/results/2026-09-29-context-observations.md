# Structured observations: fixed-history comparison

Source-derived observations recovered omitted edit and selection facts in one
checkpoint, but did not make model interpretation reliable across both checkpoints.
This is an evaluation-only prototype. Orbit core and its compaction prompt remain
unchanged. No new SWE-bench problem was solved or officially graded in this trial.

## Results

Both checkpoints refer to the same completed public pytest-10356 solver history.
Each condition ran three times with the same seed. The consumer answers three
fixed questions: was the edit saved at the operation, what did the latest bar-only
selection report, and does this history verify both inherited markers?

| Frozen checkpoint | Summary only | Summary + observations | Interpretation |
| --- | --- | --- | --- |
| Stale saved state, from `context-work-state.json` | 0/3 | 3/3 | Additional records recover the saved edit and latest zero-test selection with correct source IDs. |
| Overclaimed verification, from the earlier semantic replay's candidate summary | 0/3 | 0/3 | Both conditions classify the zero-test selection too broadly as `failed`; all three observation-condition answers also misspell the `latestBarSelection` key. |

All 12 requests completed without environment errors or truncation. All 12 answers
correctly classified behavior as unverified. Consequently this comparison shows
**no improvement on unsupported verification claims**. `failed` does not satisfy
the fixed grader's exact `no-tests-selected` category; it is a loss of detail,
not a claim that tests passed. Grader rules were not relaxed after seeing outputs.
The malformed key is valid JSON but does not match the requested answer structure.

This is a downstream consumer diagnostic: the faulty summary is frozen, not
regenerated. Baseline and candidate share instructions and settings, but the
candidate receives extra information and roughly twice the input tokens
(1,735 vs 3,455 in the first comparison; 1,729 vs 3,449 in the second).
It does not isolate the benefit of structure from the benefit of extra evidence.
Identical-seed repetitions are not independent statistical samples, and these
numbers are not SWE-bench solve rates or published model benchmarks.

## What the prototype preserves

`e2e/context_observations.py` correlates completed results with their requesting
message and call ID, including chained multi-call results and reused call IDs.
It preserves source IDs, result hashes, ordering, successful/failed saves, exact
command status, timeout and truncation flags. A request without a result does not
become a confirmed edit. Absence of acknowledgement does not prove absence of a
physical side effect.

The bounded view keeps the latest successful write and any later failed write,
plus the last three commands. Original history remains intact. Old test results
are not attached to a later edit, and arbitrary Bash output never establishes
behavioral coverage. A 16,000-byte prototype ceiling refuses oversized views
instead of silently truncating them. This is not Orbit's production token policy.
Known built-in provenance is assumed only for the controlled fixture; a tool
named `edit` in an arbitrary imported session is insufficient authentication.

The model receives checkpoint prose and, in the candidate condition, the view.
It receives neither the grader's expected answers nor hidden SWE-bench information.
The [JSON record](2026-09-29-context-observations.json) includes both checkpoints,
views, model metadata, request hashes, individual answers, tokens, durations and
grades. Full requests/responses remain in ignored `tmp/e2e/` directories.

## Independent command-report smoke checks

The evaluation runner's optional `--pytest-junit` requests a machine-readable
report outside the editable workspace. Three disposable Docker runs used the
mounted new runner, a read-only tiny test fixture, and networking disabled.

| Selection | Exit | Reported cases | Passed | Failed |
| --- | --- | --- | --- | --- |
| `-k test_empty` | 0 | 1 | 1 | 0 |
| `-k test_failure` | 1 | 1 | 0 | 1 |
| `-m bar` | 5 | 0 | 0 | 0 |

The zero-test selection is not success. The adapter records process-reported
counts and a report hash; it does not infer deselection totals, assertion
coverage, honest test contents, or an exact workspace revision. It preserves the
original exit code. These are adapter smoke checks, not official SWE-bench grading.

## Environment and verification

- Model: `ornith-1.5:9b`, Q4_K_M, digest `e5df7dcdd8a263994df62d610317e07be0d6af23f96fcbd8543273058fce575e`; Ollama 0.34.4.
- Generation: context 32,768; output 2,048; seed 42; temperature 0.6; top-p 0.95; `think: false`; JSON output. Advertised model context is not the configured request window.
- Runtime baseline: `1be53b4effb0f4b1c10849660f1d6c40f9340e97`. Prototype: `a86f1b60d8b095dc6c95f8bca92df543260d5b77`, then `36832127a3a957e1f39fb1ffc93d0ce378eec153`.
- The first replay ran at `a86f1b6`; the second at `3683212`. Re-extraction after the chained-result fix produced exactly the same recorded views for this source.
- Docker: ARM64, 4,107,141,120 available VM bytes; image `orbit-e2e:verified`, ID `sha256:f07b3d626f42c929315e988ceea4d49590214e0dda6e4a4fd8b2c2e3bfb836a9`; pytest 7.2.0. Ollama ran on the Mac.
- Observation tests: 18 passed; existing semantic tests: 11 passed; E2E host tests: 19 passed. `headers:check`, `build`, and `npm test` passed (1,038 tests). The three final Python cases ran after the full suite; no TypeScript changed.

## Reproduction

From the Orbit repository, start local Ollama with the recorded model, then use a
new output directory for every invocation:

```sh
npm run test:e2e:observations
npm run eval:context-observations -- --output tmp/e2e/observations-new
```

For the second checkpoint, generate a fixture from committed evidence. Expected
answers remain runner-side; the replay never includes them in the model request.

```sh
python3 - <<'PY'
import json
from pathlib import Path
fixture = json.loads(Path('e2e/fixtures/context-work-state.json').read_text())
prior = json.loads(Path('e2e/results/2026-09-28-context-semantic-evaluation.json').read_text())
fixture['source']['previous'] = next(row['generatedSummary'] for row in prior['rows'] if row['condition'] == 'candidate')
Path('tmp/e2e').mkdir(parents=True, exist_ok=True)
Path('tmp/e2e/overclaim-new.json').write_text(json.dumps(fixture, indent=2) + '\n')
PY
npm run eval:context-observations -- --fixture tmp/e2e/overclaim-new.json --output tmp/e2e/observations-overclaim-new
```

To repeat the command-report smoke checks, create the tiny read-only fixture:

```sh
mkdir -p tmp/e2e/observation-smoke/input tmp/e2e/observation-smoke/output
cat > tmp/e2e/observation-smoke/input/test_observed.py <<'PY'
import pytest
@pytest.mark.foo
def test_empty():
    pass

def test_failure():
    assert False
PY
docker run --rm --network none --user root -w /workspace --entrypoint python3 \
  -v "$PWD/e2e/orbit-test.py:/runner.py:ro" \
  -v "$PWD/tmp/e2e/observation-smoke/input:/workspace:ro" \
  -v "$PWD/tmp/e2e/observation-smoke/output:/output" \
  orbit-e2e:verified /runner.py --log-dir /output \
  --pytest-junit -- python3 -m pytest /workspace/test_observed.py -q -p no:cacheprovider -m bar
```

Repeat with `-k test_empty` or `-k test_failure` replacing `-m bar`. The container
returns the test's exit status; inspect its new output subdirectory for the report.
Image construction and prerequisites are in [E2E evaluation](../../docs/e2e-evaluation.md).

## Next step and unverified scope

Use runtime-owned operation provenance and deterministic records independently
of model prose. Test selection counts belong to a dedicated adapter; core generic
commands must retain unknown coverage. A model's final explanation can still be
wrong even when its input records are accurate. Core integration needs an ADR
because it changes persisted provenance and model-input assembly. Reopen/migration,
Agent/Graph integration, production token budgets and a new official SWE-bench
rerun have not been tested by this evaluation-only prototype.
