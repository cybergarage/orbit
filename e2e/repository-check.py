# Copyright (c) 2026 The Orbit Authors
# SPDX-License-Identifier: Apache-2.0
"""Run public repository checks in a disposable, network-disabled container."""
import json
import shutil
import subprocess
import sys

config = json.loads(sys.argv[1])
shutil.copytree('/fixture', '/workspace', dirs_exist_ok=True, symlinks=True)
steps = []
for step in config['steps']:
    try:
        result = subprocess.run(step['argv'], cwd=step.get('cwd', '/workspace'),
                                capture_output=True, text=True, timeout=120)
        steps.append({**step, 'exitCode': result.returncode, 'timedOut': False,
                      'stdout': result.stdout[-40000:], 'stderr': result.stderr[-40000:]})
    except subprocess.TimeoutExpired:
        steps.append({**step, 'exitCode': None, 'timedOut': True})
    if steps[-1]['exitCode'] != 0:
        break
print(json.dumps({'steps': steps, 'passed': len(steps) == len(config['steps']) and all(s['exitCode'] == 0 for s in steps)}))
