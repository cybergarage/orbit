"""Collect every planned trial without rerunning agents or dropping failures."""
import argparse
from datetime import datetime
import json
from pathlib import Path


def summarize(config_path):
    config = json.loads(Path(config_path).read_text())
    directory = Path(config["jobs_dir"]) / config["job_name"]
    results = []
    for path in directory.glob("*/result.json"):
        result = json.loads(path.read_text())
        worker = path.parent / "agent" / "result.json"
        result["worker"] = json.loads(worker.read_text()) if worker.exists() else {}
        results.append(result)
    agent = config["agents"][0]
    rows = []
    for task in config["tasks"]:
        matches = [r for r in results if r["config"]["task"]["path"] == task["path"]]
        if len(matches) > 1:
            raise ValueError("Multiple results for a planned single-attempt trial")
        result = matches[0] if matches else {}
        metadata = (result.get("agent_result") or {}).get("metadata") or {}
        worker = result.get("worker", {})
        runtime = worker.get("runtime") or metadata.get("orbit_runtime") or {}
        timing = result.get("agent_execution") or {}
        seconds = None
        if timing.get("started_at") and timing.get("finished_at"):
            seconds = (datetime.fromisoformat(timing["finished_at"]) - datetime.fromisoformat(timing["started_at"])).total_seconds()
        rows.append({
            "job": config["job_name"], "task": Path(task["path"]).name,
            "arm": agent.get("kwargs", {}).get("arm", agent.get("name")),
            "seed": agent.get("kwargs", {}).get("seed"),
            "recorded": bool(result), "reward": ((result.get("verifier_result") or {}).get("rewards") or {}).get("reward"),
            "exceptionType": (result.get("exception_info") or {}).get("exception_type"),
            "runtime": {key: runtime.get(key) for key in ("outcome", "reason", "quiescence")},
            "metrics": worker.get("evaluation") or metadata.get("evaluation"),
            "agentSeconds": seconds, "taskChecksum": result.get("task_checksum"),
            "bundleSha256": metadata.get("bundle_sha256"),
        })
    return rows


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("configs", nargs="+", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    rows = [row for config in args.configs for row in summarize(config)]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({"plannedTrials": len(rows), "trials": rows}, indent=2) + "\n")
