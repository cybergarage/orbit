# Copyright (c) 2026 The Orbit Authors
# SPDX-License-Identifier: Apache-2.0
"""Host-owned dataset preparation. Never mount this output in the agent."""
import json
from pathlib import Path
from datasets import load_dataset

record = Path("dataset.json")
config = json.loads(record.read_text()) if record.exists() else {}
dataset_name = config.get("dataset", "princeton-nlp/SWE-bench_Lite")
instance_id = config.get("instance_id", "sympy__sympy-20590")
revision = config.get("revision", "6ec7bb89b9342f664a54a6e0a6ea6501d3437cc2")
dataset = load_dataset(dataset_name, split="test", revision=revision)
instance = next(row for row in dataset if row["instance_id"] == instance_id)
Path("instance.json").write_text(json.dumps([instance], indent=2))
Path("dataset.json").write_text(json.dumps({"dataset": dataset_name, "revision": revision, "split": "test", "instance_id": instance["instance_id"], "repo": instance["repo"], "base_commit": instance["base_commit"]}, indent=2))
print(json.dumps({key: instance[key] for key in ["instance_id", "repo", "base_commit"]}))
