# Copyright (c) 2026 The Orbit Authors
# SPDX-License-Identifier: Apache-2.0
"""Host-owned dataset preparation. Never mount this output in the agent."""
import json
from pathlib import Path
from datasets import load_dataset

dataset_name = "princeton-nlp/SWE-bench_Lite"
record = Path("dataset.json")
revision = json.loads(record.read_text())["revision"] if record.exists() else "6ec7bb89b9342f664a54a6e0a6ea6501d3437cc2"
dataset = load_dataset(dataset_name, split="test", revision=revision)
instance = next(row for row in dataset if row["instance_id"] == "sympy__sympy-20590")
Path("instance.json").write_text(json.dumps([instance], indent=2))
Path("dataset.json").write_text(json.dumps({"dataset": dataset_name, "revision": revision, "split": "test", "instance_id": instance["instance_id"], "repo": instance["repo"], "base_commit": instance["base_commit"]}, indent=2))
print(json.dumps({key: instance[key] for key in ["instance_id", "repo", "base_commit"]}))
