"""Generate a serial, no-retry Harbor job from pinned local tasks."""
import argparse
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
ARMS = ("fha", "suffix", "suffix-handoff", "eocc-structured", "eocc", "sac-structured", "sac")
SOURCE = json.loads(Path(__file__).with_name("source.json").read_text())


def make_job(dataset, bundle, name, tasks, arm, model, seed, elapsed, control=None):
    if arm not in ARMS or seed < 0 or not 0 < elapsed <= 900 or not tasks:
        raise ValueError("Invalid evaluation selection or budget")
    revision = subprocess.check_output(["git", "-C", str(dataset), "rev-parse", "HEAD"], text=True).strip()
    if revision != SOURCE["datasetCommit"]:
        raise ValueError("Terminal-Bench dataset revision mismatch")
    if subprocess.check_output(["git", "-C", str(dataset), "status", "--porcelain"], text=True).strip():
        raise ValueError("Terminal-Bench dataset has local modifications")
    if any(task not in SOURCE["smokeTasks"] + SOURCE["heldOutTasks"] for task in tasks):
        raise ValueError("Task is not in the predeclared evaluation set")
    manifest = json.loads((bundle / "manifest.json").read_text())
    agent = {"name": control} if control else {
        "import_path": "e2e.terminal_bench.orbit:OrbitAgent", "model_name": model,
        "skip_model_parsing": True, "override_timeout_sec": elapsed + 45,
        "override_setup_timeout_sec": 600,
        "kwargs": {"bundle": str(bundle / "orbit-bundle.tar.gz"), "bundle_sha256": manifest["bundleSha256"],
                   "arm": arm, "seed": seed, "elapsed_sec": elapsed},
    }
    return {
        "job_name": name, "jobs_dir": str(ROOT / "tmp/e2e/terminal-bench/jobs"),
        "n_attempts": 1, "n_concurrent_trials": 1, "retry": {"max_retries": 0},
        "environment": {"type": "docker", "delete": True,
                        "extra_docker_compose": [str(Path(__file__).with_name("amd64.yaml"))]},
        "agents": [agent], "tasks": [{"path": str(dataset / "tasks" / task)} for task in tasks],
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=Path, default=ROOT / "tmp/e2e/terminal-bench/dataset")
    parser.add_argument("--bundle", type=Path, default=ROOT / "tmp/e2e/terminal-bench/bundle")
    parser.add_argument("--name", required=True)
    parser.add_argument("--task", action="append", required=True)
    parser.add_argument("--arm", choices=ARMS, default="suffix")
    parser.add_argument("--model", default="ornith-1.5:9b")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--elapsed", type=int, default=300)
    parser.add_argument("--control", choices=["oracle", "nop"])
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    config = make_job(args.dataset.resolve(), args.bundle.resolve(), args.name, args.task,
                      args.arm, args.model, args.seed, args.elapsed, args.control)
    output = args.output.resolve()
    output.relative_to((ROOT / "tmp/e2e/terminal-bench").resolve())
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(config, indent=2) + "\n")
