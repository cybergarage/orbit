# Additional SWE-bench Verified runs — 2026-09-26

This is a three-instance local diagnostic on Apple Silicon, not a Verified
leaderboard score. The cases add one new instance each from Django, pytest and
Sphinx; their repository versions match the existing Verified preflight
profiles. The selected IDs were not used in the earlier three-instance run.

## Results

| Instance | Agent outcome | Official patch result | Independent deliverable check |
| --- | --- | --- | --- |
| `django__django-15732` | Incomplete at the 900-second Run deadline after 66 model calls and 65 tool calls | Unresolved: FAIL_TO_PASS 0/1; PASS_TO_PASS 125/125 | Not measured |
| `pytest-dev__pytest-10356` | Runtime failed after 69 completed model calls and 69 tool calls; Ollama returned an incomplete JSON argument for `bash` | Unresolved: FAIL_TO_PASS 0/1; PASS_TO_PASS 79/79 | Not measured |
| `sphinx-doc__sphinx-10466` | Incomplete at the 900-second Run deadline after 75 completed model calls and 75 tool calls | Resolved: FAIL_TO_PASS 1/1; PASS_TO_PASS 6/6 | Failed: the changed local test `tests/test_build_gettext.py` failed and six `.pytest_cache` files were included |

All three reference-patch controls passed before model solving, so the official
grader images and pinned harness were usable. The new evaluation agent image was
built from the current Orbit checkout. Three initial attempts made with the
older cached agent image failed before any model call because that image rejected
the `unlimited` Run limit; they are excluded from the rows above.

## Conditions

The dataset is `princeton-nlp/SWE-bench_Verified`, test split, revision
`c104f840cc67f8b6eec6f759ebc8b2693d585d4a`. The official harness is SWE-bench
4.1.0 at `726c5461e2ef52d83cf1ea2107870a8bb3328d57`. The solver image is
`sha256:a7d1f5a227c14f638d59a56ee170c045523faffb26e0a21e6136858c2af15818`.
The per-case base commits and official amd64 image digests are pinned in the
[case manifests](../swebench/README.md). Official images ran through Docker's
amd64 emulation on ARM64.

All runs used `ornith-1.5:9b`, digest
`e5df7dcdd8a263994df62d610317e07be0d6af23f96fcbd8543273058fce575e`, Q4_K_M,
with Ollama 0.34.3. Generation used context 32768, `num_predict` 4096, seed 42,
temperature 0.6, top-p 0.95 and thinking disabled. The SWE round count was
unlimited. `ORBIT_SWE_ROUNDS=1` was deliberately set for each invocation to
verify that the removed override cannot restore a round ceiling. The separate
900-second elapsed-time deadline remained active.

Orbit production source was at commit
`39a0cdfe24785af81c53b31fd8b17b047142396a`. The host evaluation script was
locally changed to force unlimited rounds; this working-tree change was included
in the recorded evaluation inputs. Token accounting is incomplete for all
attempts: input/output tokens were 905723/16955 for Django, 1376272/11840 for
pytest and 1345563/10273 for Sphinx. The detailed per-attempt settings, scores,
quality results and usage completeness are in the companion JSON.

## Orbit findings

The current-source solver image accepted unlimited model-call, tool-request and
tool-round budgets. Run histories recorded `rounds: unlimited`, and the agent
continued well beyond the deliberately supplied value of one. No repeat-count
ceiling stopped these three runs.

The observed stops came from the elapsed-time deadline or a malformed tool call
returned by the model. The Django patch did not resolve its failing test. The
pytest Run ended on `invalid-tool-arguments` after the model emitted incomplete
JSON for a Bash call. Sphinx produced an officially resolved patch before the
deadline, but its added test failed the independent local check and the patch
included pytest cache files. These results do not identify a reproducible defect
in Orbit's Run or tool executor; they do show that unlimited iterations can
consume the full deadline without a clean final response, and that patch
resolution does not guarantee a clean deliverable.

## Artifacts and reproduction

The exact unfiltered submitted patches are in
[`2026-09-26-verified-additional-predictions.jsonl`](2026-09-26-verified-additional-predictions.jsonl).
The companion
[`2026-09-26-verified-additional.json`](2026-09-26-verified-additional.json)
contains compact per-case execution and official grading records. Raw source
snapshots, private dataset rows, logs and full Session data remain under ignored
`tmp/e2e/verified/<instance_id>/`.

Install the documented SWE-bench 4.1.0 host environment, build the agent image
from the current source, prepare each pinned case, then run and grade each
manifest:

```sh
docker build -f e2e/Dockerfile -t orbit-e2e:swe .
docker build -f e2e/VerifiedAgent.Dockerfile -t orbit-e2e:verified-unlimited .
for case in django__django-15732 pytest-dev__pytest-10356 sphinx-doc__sphinx-10466; do
  ORBIT_SWE_CASE="e2e/swebench/${case}.json" npm run eval:swebench -- prepare
  ORBIT_E2E_IMAGE=orbit-e2e:verified-unlimited ORBIT_SWE_CASE="e2e/swebench/${case}.json" npm run eval:swebench -- gold
  ORBIT_E2E_IMAGE=orbit-e2e:verified-unlimited ORBIT_SWE_CASE="e2e/swebench/${case}.json" npm run eval:swebench -- solve ornith-1.5:9b
done
```

For grading, pass each printed `predictions.jsonl` path to
`npm run eval:swebench -- grade <path>`. Each command creates a new Session and
workspace. A fresh run may produce a different trajectory, even with the same
seed.
