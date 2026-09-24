# Local coding E2E evaluation

This opt-in developer harness measures an Orbit coding agent using real Ollama
inference. It is separate from deterministic `npm test`. It does not establish a
SWE-bench leaderboard score. See [the recorded experiment](../e2e/results/2026-09-25.md)
for local results, failures, model identities and limitations.

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
900 seconds/30 tool iterations (31 model calls), context 32768, thinking enabled by default (`ORBIT_SWE_THINK=false` disables it for a separately recorded experiment). Small cases use
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
handoff. Compact dated results live under `e2e/results/`.

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
