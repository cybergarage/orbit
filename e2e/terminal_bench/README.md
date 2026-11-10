# Terminal-Bench integration

This opt-in harness runs a hash-verified Orbit bundle **inside** Harbor's task
container and uses the official verifier. It does not establish leaderboard
performance. Python 3.12+, Docker Compose, Node 22+ and reachable Ollama are
required. The first supported environments are Debian bookworm / Ubuntu 24.04
on linux/amd64; ARM hosts use emulation. No host Docker socket, home directory,
or task solution is uploaded to the agent.

`source.json` pins Harbor 0.25.0 and Terminal-Bench 2.1. The adapter targets that
release API, not moving online documentation. The dataset stays unmodified;
job generation rejects a changed checkout. Task image tags and resolved image
IDs must be retained with result artifacts; upstream image availability is an
infrastructure dependency. The adapter has no provider credentials and targets
local Ollama only. A trusted bundle includes the compiled runtime, dependencies,
worker and Node binary; do not accept a bundle from untrusted model output.

```sh
python3.12 -m venv tmp/e2e/terminal-bench/venv
tmp/e2e/terminal-bench/venv/bin/pip install harbor==0.25.0
git clone https://github.com/harbor-framework/terminal-bench-2-1.git tmp/e2e/terminal-bench/dataset
git -C tmp/e2e/terminal-bench/dataset checkout 12b7565679ce5006230b820666353673a133db93
node e2e/terminal_bench/bundle.mjs
python3 e2e/terminal_bench/job.py --name orbit-smoke-suffix --task fix-git \
  --arm suffix --output tmp/e2e/terminal-bench/suffix.json
PYTHONPATH="$PWD" tmp/e2e/terminal-bench/venv/bin/harbor run \
  --config tmp/e2e/terminal-bench/suffix.json
```

Before inference, generate fresh job names with `--control oracle` and
`--control nop` for the same tasks. Require reward 1 and reward 0 respectively.
These controls test the verifier and infrastructure; never mount the dataset
parent or verifier/solution directories into the solver. Harbor injects the
verifier after agent execution. Its independent reward remains authoritative.
The no-solution-network prompt is cooperative, not an enforced network allowlist.

`--arm` accepts `fha`, `suffix`, `suffix-handoff`, `eocc-structured`, `eocc`,
`sac-structured`, and `sac`. `suffix` is Orbit's existing algorithm and strategy;
`eocc`/`sac` use the handoff algorithm. Algorithm-controlled comparisons use
`suffix-handoff` versus `eocc`/`sac`, or `suffix` versus the `*-structured` arms.
All Terminal-Bench arms use one Bash invocation per model response, one serial
trial, a 16,384-token window, 12,288 trigger, 8,192 target, 2,048 output/summary
reserve, 256 safety margin, temperature 0.6, top-p 0.95 and the recorded seed.
The default 300-second Run limit is a diagnostic constraint, shorter than the
official task allowance; it is not a leaderboard configuration. The Harbor
outer timeout adds cleanup grace. GNU `timeout` terminates the owned worker
process group after 30 seconds of grace, with a five-second hard-kill fallback.
Its nonzero exit uses Harbor's graded agent-failure path; a competing Docker exec
timeout must not turn an already stopped Run into an ungraded infrastructure
error. The task image must provide GNU `timeout`. No infrastructure failures are silently retried.

Artifacts under `tmp/e2e/terminal-bench/jobs/` include Harbor configuration and
lock files, environment/verifier logs and reward, plus `agent/result.json`,
`events.jsonl`, `context-policy.json`, and `orbit-config.json`. Record all planned
trials, including timeout, setup error, summary failure and missing reward.
Final-log worker/summary token totals include all completed provider calls,
including responses settling after the Run timeout; incomplete
usage is flagged. Peak completed input is a lower bound when a call lacks usage.
Billed cost remains null. Cache tokens and uncached input are reported only when
every request has a completed response with a valid provider cache count; otherwise
they remain null. Ollama 0.40.14 defines `prompt_eval_count` as total prompt tokens
and `prompt_eval_cached_count` as the cached subset.
[Version-pinned API schema](https://github.com/ollama/ollama/blob/9a3e8177767245acc62b735eba7d5d8a553606d0/docs/openapi.yaml). Orbit Run outcome,
verifier reward and compaction activity are separate: no compaction means the
threshold policy was not exercised. Reopening or reading results never reruns tools.

The common worker also accepts these controls through the existing SWE-bench
host: `ORBIT_E2E_COMPACTION_ARM`, `ORBIT_E2E_ACTION_MODE=single`, and `ORBIT_E2E_SEED` (default 42). Rebuild all
selected images after changes; the host's source fingerprint includes the
compaction configuration module. Existing callers without these settings retain
their prior execution mode and generation defaults.

Adapter boundary checks (no Docker or model calls):

```sh
LITELLM_LOCAL_MODEL_COST_MAP=True PYTHONPATH="$PWD" tmp/e2e/terminal-bench/venv/bin/python -B -m unittest e2e.terminal_bench.test_orbit
npm run test:e2e:unit
```

Collect all planned trials, including missing and failed results, without inference:

```sh
python3 -B e2e/terminal_bench/summarize.py tmp/e2e/terminal-bench/suffix.json --output tmp/e2e/terminal-bench/summary.json
python3 -B -m unittest e2e.terminal_bench.test_summary
```

Job and summary output paths must remain under `tmp/e2e/terminal-bench/`.
Identical repeated tool calls are a diagnostic count, not proof of redundant
work: a repeated verification command can be necessary. Final provider usage
can be complete even when the Run timed out and reported non-quiescence.

## Fixed-history recap diagnostic

After building, `node e2e/terminal_bench/fixed-history.mjs --prepare-only`
validates a synthetic source that crosses the compaction trigger without calling
Ollama. Explicit `--run` performs six serial live recap preparations with the
pinned local model, a 32,768-token window, the same 12,288 trigger / 8,192 target,
and 2,048 summary limit. The larger window leaves room for recap instructions.
This isolates source retention and checkpoint creation; it is not a task-success
benchmark or a test of SAC's per-action cadence. No tool is executed. The fixture
asks to retain an exact marker, branch and pending check, and verifies that the
pending check is not reported as passed. Outputs remain under the ignored
`tmp/e2e/terminal-bench/fixed-history/` directory.
