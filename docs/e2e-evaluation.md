# Local coding E2E evaluation

This opt-in developer harness measures an Orbit coding agent using real Ollama
inference. It is separate from deterministic `npm test`. It does not establish a
SWE-bench leaderboard score. Local experiment records under `e2e/results/`
contain outcomes, failures, model identities and limitations; these artifacts
are not distributed with the repository.

## Prerequisites and small cases

Use Node.js 22.16 or newer for the E2E host scripts, npm dependencies installed
with `npm ci`, Docker Desktop running Linux containers, and Ollama on the Mac.
The agent image uses pinned Node.js 22; the Orbit package's minimum Node version
is unchanged. No cloud credentials or existing Orbit sessions are needed.

```sh
ollama pull gemma4:12b
ollama pull ornith-1.5:9b
npm run e2e:build
npm run test:e2e:unit
npm run test:e2e:graders
caffeinate -i npm run test:e2e:ollama
```

`caffeinate` is optional on macOS and prevents idle sleep during a measurement.
The default matrix runs four cases, three times each, for both named models,
serially. A failed case makes Mocha fail but does not skip later trials. A smaller
probe can be selected explicitly:

```sh
ORBIT_E2E_MODELS=gemma4:12b ORBIT_E2E_REPETITIONS=1 ORBIT_E2E_CASE=read npm run test:e2e:ollama
```

Case IDs are `read`, `single-file`, `test-repair`, and `multi-file`.
`OLLAMA_HOST_URL` changes host-side metadata access (default
`http://127.0.0.1:11434`); `ORBIT_E2E_OLLAMA_HOST` changes the agent's endpoint
(default `http://host.docker.internal:11434`). `ORBIT_E2E_IMAGE` selects a built
agent image. Do not expose Ollama publicly to run these tests.

Each trial receives a new container, workspace and in-memory Session. Only the
fixture and run configuration are mounted read-only. Orbit and tools execute as
the image's non-root user. The container has limited CPU, memory and process
count, no added capabilities, and no host Docker socket or home directory.
The model runs on the Mac; containers call Ollama over Docker Desktop networking.

Small cases have a 240-second Run budget, 12 tool iterations (13 model calls) and a host timeout with
30 seconds of grace. SIGINT/SIGTERM remove tracked containers. Normal and failed
runs stop the container before copying artifacts and removing it. SIGKILL or a
host crash cannot run cleanup: inspect `docker ps -a --filter name=orbit-e2e-`
and remove only the matching abandoned experiment containers. Images and logs
are retained intentionally; no global Docker prune is performed.

The host grades copied artifacts in a new network-disabled, read-only container.
Hidden checks are streamed to that grader and never mounted in the solving
container. The recovery case also requires an observed failing test followed by
a successful rerun and preserves its visible test file. Grader controls verify
that original bugs fail, correct code passes, and `process.exit(0)` cannot bypass
the completion marker. These are cooperative coding evaluations, not a hardened
sandbox against a malicious agent. Model-generated code and diagnostic files
are not trusted security attestations.

Mocha/Chai provide assertions and reporting. Docker CLI control was selected over
Testcontainers for this first implementation: it uses the existing dependencies,
permits explicit stop/copy/remove ordering, and also fits the official Python
harness. No new npm dependency or production API is introduced.

## One official SWE-bench instance

The selected Lite problem is `sympy__sympy-20590`. The dataset revision and source
commit are fixed in `e2e/prepare-swe.py`; the official evaluation image is pinned
by digest in `e2e/swebench.mjs`. Its architecture is **amd64** and Docker Desktop
emulates it on this ARM64 Mac. This is not native ARM execution. The successful
reference-patch run verifies this specific combination, not all SWE-bench images.

Prepare a host Python virtual environment using Python 3.10 or newer (the macOS
system Python 3.9 is insufficient). Set `PYTHON` to an installed compatible
interpreter. The official harness runs on the host and creates its own disposable
evaluation container. Never mount the host Docker socket inside a container.

```sh
mkdir -p tmp/e2e
# Set PYTHON to a Python >=3.10 executable before this command.
"$PYTHON" -m venv tmp/e2e/venv
git clone --branch v4.1.0 --depth 1 https://github.com/SWE-bench/SWE-bench.git tmp/e2e/SWE-bench
git -C tmp/e2e/SWE-bench rev-parse HEAD
# Expected: 726c5461e2ef52d83cf1ea2107870a8bb3328d57
tmp/e2e/venv/bin/pip install ./tmp/e2e/SWE-bench
npm run eval:swebench -- prepare
tmp/e2e/venv/bin/pip freeze > tmp/e2e/swe/python-dependencies.txt
npm run eval:swebench -- gold
docker build -f e2e/SweAgent.Dockerfile -t orbit-e2e:swe .
ORBIT_E2E_IMAGE=orbit-e2e:swe caffeinate -i npm run eval:swebench -- solve ornith-1.5:9b
# Use the actual predictions path printed by solve:
npm run eval:swebench -- grade tmp/e2e/swe/solve-ornith-1.5-9b-<uuid>/predictions.jsonl
```

`ORBIT_SWE_PYTHON` overrides the host virtual-environment interpreter. Commands
use the active Docker context endpoint. `gold` explicitly pulls the pinned amd64
image and gives it an experiment-owned alias for the official harness.

`solve` requires a successful gold result for the current dataset file hash. It
extracts only `problem_statement` and a source archive at `base_commit`. The agent
gets neither repository history, the reference patch, evaluation test patch,
nor dataset records. The trusted host extracts the resulting diff into official
JSONL fields `instance_id`, `model_name_or_path`, `model_patch`. A fresh official
container applies and grades that patch. The evaluator report determines
resolution; process exit zero alone is insufficient. The SWE solving budget is
900 seconds/50 tool iterations (51 model calls), context 32768, thinking disabled by default (`ORBIT_SWE_THINK=true` enables it for a separately recorded experiment). Small cases use
context 16384 and thinking disabled. Both use temperature 0.6, top-p 0.95,
num_predict 4096 and seed 42. Settings are recorded for every trial.

The agent network is available for the host Ollama connection. The prompt forbids
retrieving solutions, but external access is not technically allowlisted. This is
a local diagnostic experiment, not a contamination-proof benchmark submission.
Agent dependencies differ from the official grader's pinned environment; solver
test errors and official grading outcomes must be distinguished.

## Evidence and interpretation

`tmp/e2e/runs/<timestamp>-small/` holds environment metadata, model digests and
quantization, each prompt/options, Run and Session results, streamed model/tool
events, copied artifacts, grader logs and incremental `summary.json`.
`tmp/e2e/swe/` holds pinned dataset metadata, private reference material, official
reports and predictions. **Do not mount this parent directory into the agent.**
These ignored files are local evidence: preserve them separately for a machine
handoff. Compact dated reports, JSON summaries and generated prediction patches
also remain local under ignored `e2e/results/`. Git tracks the harness, Dockerfiles,
pinned case manifests and operating instructions, not execution artifacts.
Copy results separately when sharing evidence or moving to another machine; a
fresh clone does not contain historical reports or submitted patches.

Read `grade.json` / summary status for final outcomes. `resolved` requires both a
completed Run and independent success; `unresolved` includes incorrect work and
exhausted model budgets. `runtime-error` describes Orbit execution/close failures;
`environment-error` or `timeout` describes infrastructure/host deadlines;
`grading-error` means the judge did not produce a usable result. Raw `run.json`
status describes execution only and can say `runtime-error` for a budget stop;
the final grader explicitly classifies that stop as unresolved. An incomplete
response can omit token accounting; `usageComplete: false` means the reported
usage is only a lower bound. Report all planned trials, not only successful ones.

Seed reuse reduces one source of variation but does not guarantee deterministic
inference. Three repetitions per fixture are diagnostic samples, not a statistical
estimate of general coding ability. Public model benchmark claims use other
scaffolds, budgets and environments and must not be substituted for these results.

The harness reuses Agent/Run, Session, coding tools and the Ollama adapter. It is
an additive developer evaluation, separate from workflow-selection/evaluation
product APIs; no durable product schema, public API, execution policy, or safety
contract changes. An ADR is therefore unnecessary for these test-local changes.
A future provider-options API or safety-sensitive tool error redesign needs its
own proposed ADR and approval before implementation.

An empty prediction is handled by the official harness as `empty_patch_ids`, with no test execution. The wrapper records it as unresolved with `gradingDisposition: skipped-empty-patch`; it never calls that a successfully graded patch.

## Recovery and completion experiment

The small-case default evaluation strategy is `coding-recovery-v1`. SWE-bench retains `baseline`: the recovery strategy did not improve the measured SWE attempts. It supplies
known environment facts, asks the agent to re-read after an exact-text edit
failure, preserve test exit status, and finish after focused checks pass. These
are test-host instructions; they contain no case solution, reference patch or
hidden test information. Orbit's default runtime limits and product prompts are
unchanged. Use `ORBIT_E2E_STRATEGY=baseline` to reproduce the original prompts.

`ORBIT_E2E_ROUNDS` changes the small-case budget (default 12), while
`ORBIT_SWE_ROUNDS` changes the one-problem budget (default 50). Values must be
integers from 1 to 100. The host sets tool iterations, tool rounds and model-call
allowance together; time limits remain unchanged. The instruction text does not
include the selected budget, so a 30/50 comparison uses exactly the same prompt.
Each run records its strategy and prompt hash.

```sh
# Three repetitions per small case/model, improved instructions, original budget:
caffeinate -i npm run test:e2e:ollama

# Reproduce the recovery-strategy comparison explicitly; grade both predictions.
ORBIT_E2E_STRATEGY=coding-recovery-v1 ORBIT_SWE_ROUNDS=30 ORBIT_SWE_THINK=false ORBIT_E2E_IMAGE=orbit-e2e:swe caffeinate -i npm run eval:swebench -- solve ornith-1.5:9b
ORBIT_E2E_STRATEGY=coding-recovery-v1 ORBIT_SWE_ROUNDS=50 ORBIT_SWE_THINK=false ORBIT_E2E_IMAGE=orbit-e2e:swe caffeinate -i npm run eval:swebench -- solve ornith-1.5:9b
```

`metrics` records started/completed model calls, tool calls/errors, repeated failed
calls with identical tool name/input JSON, and completed-response Ollama loading,
prompt evaluation and generation durations. Interrupted calls contribute no
invented response duration. `execution` includes the observed command elapsed
time and timeout-callback overrun. These help locate delay; they cannot establish
whether a long gap was host sleep, scheduling, transport or inference without
further evidence. Diagnostic metrics never replace independent grading.

Changing these test-host prompts and limits is a local evaluation change, not an
architecture change. Safety-sensitive edit error disclosure or product-wide
budget changes remain separate design work requiring an approved ADR.

A repeated failed call is a diagnostic count, not proof of an unproductive loop:
rerunning a failing test after a partial fix can be appropriate. Inspect tool
names, edits and test outputs before attributing that count to failed recovery.

The measured SWE configuration is the original prompt, 50 iterations and thinking disabled. It completed in 41 tool calls and passed official grading in one trial. This selects a useful evaluation default, not a universal optimal budget. The local report `e2e/results/2026-09-25-recovery.md` also records the unsuccessful recovery-prompt trials, when those artifacts have been retained.

## Three pinned Verified problems

`e2e/swebench/*.json` contains a preselected three-repository diagnostic sample.
Set `ORBIT_SWE_CASE` to one manifest to isolate its dataset, gold report, solver
workspaces and official grading under `tmp/e2e/verified/<instance_id>`. Omitting
it retains the existing Lite problem and its separate directory. A manifest
must specify Verified's immutable revision/base commit and a matching official
image digest; mutable tags and mismatched prepared instances are rejected.

Use the existing pinned host Python harness from the setup above. Build the
solver image once; its Python dependencies support the three selected source
trees without including reference patches or grading data:

```sh
docker build -f e2e/VerifiedAgent.Dockerfile -t orbit-e2e:verified .
export ORBIT_SWE_CASE=e2e/swebench/django__django-15731.json
npm run eval:swebench -- prepare
npm run eval:swebench -- gold
ORBIT_E2E_IMAGE=orbit-e2e:verified ORBIT_E2E_STRATEGY=baseline ORBIT_SWE_ROUNDS=50 ORBIT_SWE_THINK=false caffeinate -i npm run eval:swebench -- solve ornith-1.5:9b
# Use the predictions path printed by solve, keeping ORBIT_SWE_CASE unchanged:
npm run eval:swebench -- grade <predictions.jsonl>
```

Repeat with `pytest-dev__pytest-10051.json` and
`sphinx-doc__sphinx-10323.json`. Run serially to avoid inference contention.
Do not replace a problem after seeing an unsuccessful solution. The original
prompt, 50 iterations, 900-second Run budget, context 32768 and thinking disabled
are retained. No product runtime defaults change. The solver uses a source
snapshot and a generic Python environment, not the official per-problem test
environment; local test setup failures must be distinguished from official
patch grading failures. Record image ID and `pip freeze` alongside results,
since transitive Python dependencies are not fully locked by the Dockerfile.

Saved batch predictions are standard JSONL. The example below requires a locally
retained or separately copied `e2e/results/2026-09-25-verified-predictions.jsonl`;
it is not present in a fresh clone. To regrade one saved prediction
through this single-instance wrapper, extract its row without changing the patch:

```sh
python3 - <<'PYTHON'
import json
from pathlib import Path
root = Path('tmp/e2e/verified/replay')
root.mkdir(parents=True, exist_ok=True)
for line in Path('e2e/results/2026-09-25-verified-predictions.jsonl').read_text().splitlines():
    row = json.loads(line)
    (root / (row['instance_id'] + '.jsonl')).write_text(line + '\n')
PYTHON
ORBIT_SWE_CASE=e2e/swebench/django__django-15731.json npm run eval:swebench -- grade tmp/e2e/verified/replay/django__django-15731.jsonl
```

Prepare the matching dataset first on a new machine. Change both the manifest
and JSONL filename to regrade the other two problems. A replay is a new grading
run of the existing patch, not a new model attempt.
