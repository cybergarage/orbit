# Copyright (c) 2026 The Orbit Authors
# SPDX-License-Identifier: Apache-2.0

"""Compare complete core compaction with one frozen history in disposable images."""
import argparse
import hashlib
import json
import pathlib
import subprocess
import time
import urllib.request
import uuid


def api(endpoint, body=None):
    request = urllib.request.Request(
        'http://localhost:11434/api/' + endpoint,
        data=None if body is None else json.dumps(body).encode(),
        headers={'Content-Type': 'application/json'},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline-image', required=True)
    parser.add_argument('--candidate-image', required=True)
    parser.add_argument('--output', required=True, help='New artifact directory; existing directories are refused')
    args = parser.parse_args()
    root = pathlib.Path(__file__).resolve().parent.parent
    out = pathlib.Path(args.output).resolve()
    out.mkdir(parents=True, exist_ok=False)
    fixture = root / 'e2e/fixtures/context-tool-output-history.json'
    driver = root / 'e2e/context-tool-output-replay.mjs'
    tag = next(m for m in api('tags')['models'] if m['name'] == 'ornith-1.5:9b')
    show = api('show', {'model': 'ornith-1.5:9b'})
    docker = json.loads(subprocess.check_output(['docker', 'info', '--format', '{{json .}}'], text=True))
    metadata = {
        'startedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'checkout': subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip(),
        'fixtureSha256': hashlib.sha256(fixture.read_bytes()).hexdigest(),
        'driverSha256': hashlib.sha256(driver.read_bytes()).hexdigest(),
        'model': {'name': tag['name'], 'digest': tag['digest'], 'details': tag['details'],
                  'ollamaVersion': api('version')['version'],
                  'templateSha256': hashlib.sha256(show.get('template', '').encode()).hexdigest()},
        'docker': {k: docker.get(k) for k in ['ServerVersion', 'Architecture', 'MemTotal']},
        'generation': {'num_ctx': 32768, 'seed': 42, 'temperature': 0.6, 'top_p': 0.95,
                       'think': False, 'summaryOutput': 2048, 'expandedOutput': 4096},
        'conditions': {},
    }
    for condition, image in [('baseline', args.baseline_image), ('candidate', args.candidate_image)]:
        identity = subprocess.check_output(['docker', 'image', 'inspect', image, '--format', '{{.Id}}'], text=True).strip()
        fingerprint = subprocess.check_output(['docker', 'run', '--rm', image, 'node', '/opt/orbit/e2e/source-fingerprint.mjs'], text=True).strip()
        row = {'image': identity, 'sourceFingerprint': fingerprint}
        metadata['conditions'][condition] = row
        name = 'orbit-summary-replay-' + uuid.uuid4().hex[:10]
        command = ['docker', 'run', '--name', name,
                   '--mount', f'type=bind,src={fixture},dst=/input/history.json,readonly',
                   '--mount', f'type=bind,src={driver},dst=/opt/orbit/e2e/context-tool-output-replay.mjs,readonly',
                   image, 'node', '/opt/orbit/e2e/context-tool-output-replay.mjs']
        started = time.monotonic()
        print('START', condition, name, flush=True)
        with (out / (condition + '.log')).open('w') as log:
            process = None
            try:
                process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT)
                row['exitCode'] = process.wait(timeout=1860)
            except subprocess.TimeoutExpired:
                row['hostTimeout'] = True
                subprocess.run(['docker', 'stop', '--time', '10', name], stdout=log, stderr=log, timeout=30, check=False)
                process.wait(timeout=20)
            finally:
                row['hostElapsedMs'] = round((time.monotonic() - started) * 1000)
                destination = out / condition
                destination.mkdir()
                copied = subprocess.run(['docker', 'cp', name + ':/output/replay/.', str(destination)], stdout=log, stderr=log, check=False)
                row['artifactsCopied'] = copied.returncode == 0
                subprocess.run(['docker', 'rm', '--force', name], stdout=log, stderr=log, timeout=30, check=False)
                (out / 'metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
                print('END', condition, row, flush=True)


if __name__ == '__main__':
    main()
