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
import hashlib
import xml.etree.ElementTree as ET


def read_junit(path):
    """Report observed testcase outcomes, never assertion coverage."""
    content = path.read_bytes()
    if len(content) > 16 * 1024 * 1024:
        raise ValueError('JUnit report exceeds 16 MiB')
    root = ET.fromstring(content)
    if root.tag not in ('testsuite', 'testsuites'):
        raise ValueError('Unsupported JUnit root')
    suites = [node for node in root.iter('testsuite') if not node.findall('testsuite')]
    cases = [node for suite in suites for node in suite.findall('testcase')]
    reported = sum(int(suite.attrib['tests']) for suite in suites)
    if not suites or reported != len(cases):
        raise ValueError('JUnit testcase count does not match suite totals')
    counts = {'reported': reported, 'passed': 0, 'failed': 0, 'errors': 0, 'skipped': 0}
    for case in cases:
        kind = 'errors' if case.find('error') is not None else 'failed' if case.find('failure') is not None else 'skipped' if case.find('skipped') is not None else 'passed'
        counts[kind] += 1
    return {'adapter': 'pytest-junit-v1', 'counts': counts,
            'reportSha256': hashlib.sha256(content).hexdigest(),
            'verificationCoverage': 'unknown'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--timeout', type=float, default=120)
    parser.add_argument('--tail', type=int, default=12000, help='Maximum displayed log bytes')
    parser.add_argument('--pytest-junit', action='store_true', help='Capture pytest JUnit testcase counts outside the workspace')
    parser.add_argument('--log-dir', default='/output/test-runs')
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command or not 0 < args.timeout <= 600 or not 1 <= args.tail <= 100000:
        parser.error('Provide an argv after --, timeout in (0, 600], and tail in [1, 100000]')
    directory = Path(args.log_dir) / str(uuid.uuid4())
    directory.mkdir(parents=True)
    log = directory / 'output.log'
    requested = command.copy()
    junit = directory / 'junit.xml'
    if args.pytest_junit:
        is_pytest = Path(command[0]).name in ('pytest', 'py.test') or (len(command) >= 3 and Path(command[0]).name.startswith('python') and command[1:3] == ['-m', 'pytest'])
        if not is_pytest or any(arg.startswith(('--junitxml', '--junit-xml')) for arg in command):
            parser.error('--pytest-junit requires pytest argv without an existing JUnit option')
        command += ['--junitxml', str(junit)]
    started = time.monotonic()
    report = {'requestedArgv': requested, 'argv': command, 'cwd': os.getcwd(), 'timedOut': False, 'log': str(log)}
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
    if args.pytest_junit:
        try:
            report['testReport'] = read_junit(junit)
        except (OSError, ValueError, ET.ParseError, KeyError) as error:
            report['testReport'] = {'status': 'unavailable', 'reason': str(error), 'verificationCoverage': 'unknown'}
    (directory / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
    with log.open('rb') as output:
        output.seek(max(0, log.stat().st_size - args.tail))
        sys.stdout.write(output.read().decode('utf-8', errors='replace'))
    print('\nORBIT_TEST_RESULT ' + json.dumps(report), flush=True)
    return report['exitCode'] if report['exitCode'] >= 0 else 128 - report['exitCode']


if __name__ == '__main__':
    sys.exit(main())
