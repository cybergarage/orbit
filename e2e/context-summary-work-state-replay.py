# Copyright (c) 2026 The Orbit Authors
# SPDX-License-Identifier: Apache-2.0

"""Replay the pytest-10356 stale-checkpoint diagnostic against local Ollama."""

import argparse
import hashlib
import json
import pathlib
import re
import subprocess
import time
import urllib.request

from context_summary_semantics import grade_summary


ITERATIONS = [15, 16, 21, 22, 23, 25, 26, 27]


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def prompt_at_ref(root, ref):
    code = subprocess.check_output(
        ["git", "show", ref + ":src/core/session/context-policy.ts"],
        cwd=root,
        text=True,
    )
    match = re.search(r"const SUMMARY_INSTRUCTIONS =\n  '([^\n]+)'", code)
    if match is None:
        raise ValueError("Cannot locate summary instructions at " + ref)
    review = re.search(r"const SUMMARY_REVIEW_INSTRUCTIONS =\n  '([^\n]+)'", code)
    return match.group(1), (review.group(1) if review else None)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("solver_run", type=pathlib.Path, nargs="?",
                        help="Saved solve directory with agent/output/result.json")
    parser.add_argument("--output", type=pathlib.Path, required=True)
    parser.add_argument("--baseline-ref", default="4eb5701")
    parser.add_argument("--candidate-ref", default="HEAD")
    parser.add_argument("--fixture", type=pathlib.Path, help="Fixed source and separate grader expectations")
    args = parser.parse_args()
    if args.solver_run is None and args.fixture is None:
        parser.error("Supply solver_run or --fixture")
    root = pathlib.Path(__file__).resolve().parent.parent
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=True)
    expected = None
    if args.fixture:
        fixture = json.loads(args.fixture.read_text(encoding="utf-8"))
        messages = fixture["source"]["messages"]
        previous = fixture["source"]["previous"]
        expected = fixture["expected"]
    else:
        run = args.solver_run.resolve()
        entries = json.loads((run / "agent/output/result.json").read_text(encoding="utf-8"))["entries"]
        messages = [
            entry["message"] for entry in entries
            if entry.get("type") == "message"
            and (entry.get("iteration") in ITERATIONS or entry["message"].get("role") == "user")
        ]
        previous = next(entry["summary"] for entry in entries if entry.get("type") == "compaction")
    ids = list(dict.fromkeys(
        [message["id"] for message in messages]
        + [source_id for category in previous.values() if isinstance(category, list)
           for item in category for source_id in item["sourceIds"]]
    ))
    source = {"messages": messages, "previous": previous}
    write_json(out / "source.json", source)
    metadata = {}
    for endpoint in ["version", "tags"]:
        with urllib.request.urlopen("http://localhost:11434/api/" + endpoint, timeout=10) as response:
            metadata[endpoint] = json.load(response)
    write_json(out / "model-metadata.json", metadata)
    variants = [("baseline", args.baseline_ref), ("candidate", args.candidate_ref)]
    rows = []
    for name, ref in variants:
        instructions, review = prompt_at_ref(root, ref)
        prompt = (
            instructions
            + "\nOUTPUT_TOKEN_BUDGET: 2048. Complete the JSON object within this budget."
            + "\nORIGINAL_SOURCE_IDS: " + json.dumps(ids)
            + "\nSOURCE: " + json.dumps(source)
        )
        if review is not None:
            prompt += "\nFINAL_REVIEW: " + review
        body = {
            "model": "ornith-1.5:9b", "stream": False, "think": False, "format": "json",
            "messages": [{"role": "user", "content": prompt}],
            "options": {"num_ctx": 32768, "num_predict": 2048, "seed": 42,
                        "temperature": 0.6, "top_p": 0.95},
        }
        write_json(out / (name + "-request.json"), body)
        started = time.monotonic()
        request = urllib.request.Request(
            "http://localhost:11434/api/chat", data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=300) as response:
            result = json.load(response)
        write_json(out / (name + "-response.json"), result)
        row = {
            "condition": name, "elapsedMs": round((time.monotonic() - started) * 1000),
            "doneReason": result.get("done_reason"), "inputTokens": result.get("prompt_eval_count"),
            "outputTokens": result.get("eval_count"),
            "promptSha256": hashlib.sha256(prompt.encode()).hexdigest(),
        }
        try:
            summary = json.loads(result["message"]["content"])
            write_json(out / (name + "-summary.json"), summary)
            row["jsonValid"] = True
            if expected is not None:
                row["semanticGrade"] = grade_summary(summary, expected)
                if result.get("done_reason") != "stop" or not result.get("done", False):
                    row["semanticGrade"] = {"status": "fail", "reason": "Incomplete model response"}
            row["unknownSourceIds"] = [
                source_id for category in (summary.values() if isinstance(summary, dict) else [])
                if isinstance(category, list) for item in category if isinstance(item, dict)
                for source_id in (item.get("sourceIds", []) if isinstance(item.get("sourceIds"), list) else [])
                if source_id not in ids
            ]
        except (ValueError, KeyError, TypeError, AttributeError) as error:
            row["jsonValid"] = False
            row["parseError"] = str(error)
        if row.get("unknownSourceIds"):
            row["semanticGrade"] = {"status": "fail", "reason": "Unknown source evidence"}
        rows.append(row)
        write_json(out / "comparison.json", {
            "rows": rows, "sourceSha256": hashlib.sha256(json.dumps(source).encode()).hexdigest(),
        })
        print(json.dumps(row), flush=True)
    write_json(out / "comparison.json", {
        "rows": rows, "sourceSha256": hashlib.sha256(json.dumps(source).encode()).hexdigest(),
    })


if __name__ == "__main__":
    main()
