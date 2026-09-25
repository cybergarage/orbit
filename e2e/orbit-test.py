#!/usr/bin/env python3
# Copyright (c) 2026 The Orbit Authors
# SPDX-License-Identifier: Apache-2.0
"""Run a test argv without a shell; keep its exit code while showing a log tail."""
import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--timeout', type=float, default=120)
    parser.add_argument('--tail', type=int, default=12000, help='Maximum displayed log bytes')
    parser.add_argument('--log-dir', default='/output/test-runs')
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command or not 0 < args.timeout <= 600 or not 1 <= args.tail <= 100000:
        parser.error('Provide an argv after --, timeout in (0, 600], and tail in [1, 100000]')
    directory = Path(args.log_dir) / str(uuid.uuid4())
    directory.mkdir(parents=True)
    log = directory / 'output.log'
    started = time.monotonic()
    report = {'argv': command, 'cwd': os.getcwd(), 'timedOut': False, 'log': str(log)}
    try:
        with log.open('wb') as output:
            process = subprocess.Popen(command, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
            try:
                report['exitCode'] = process.wait(timeout=args.timeout)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
                report.update(exitCode=124, timedOut=True)
    except OSError as error:
        report.update(exitCode=127, error=str(error))
    report['elapsedMs'] = round((time.monotonic() - started) * 1000)
    (directory / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
    with log.open('rb') as output:
        output.seek(max(0, log.stat().st_size - args.tail))
        sys.stdout.write(output.read().decode('utf-8', errors='replace'))
    print('\nORBIT_TEST_RESULT ' + json.dumps(report), flush=True)
    return report['exitCode'] if report['exitCode'] >= 0 else 128 - report['exitCode']


if __name__ == '__main__':
    sys.exit(main())
