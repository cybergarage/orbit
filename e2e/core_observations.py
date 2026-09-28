# Copyright (c) 2026 The Orbit Authors
# SPDX-License-Identifier: Apache-2.0
"""Check runtime observation diagnostics directly against canonical solver results."""
import argparse
import json
from pathlib import Path


def check_views(entries, events):
    messages = {entry['message']['id']: entry['message'] for entry in entries if entry.get('type') == 'message'}
    rows = []
    for event in events:
        if event.get('type') != 'context.observations.prepared':
            continue
        view = event.get('data', {}).get('view', {})
        checks = []
        for record in view.get('records', []):
            ids = record.get('sourceIds', [])
            request = messages.get(ids[0], {}) if len(ids) == 2 else {}
            result = messages.get(ids[1], {}) if len(ids) == 2 else {}
            payload = result.get('payload', {})
            provenance = payload.get('observation', {})
            calls = [call for call in request.get('payload', {}).get('toolCalls', [])
                     if call.get('id') == payload.get('toolCallId') and call.get('name') == payload.get('name')]
            details = payload.get('output', {}).get('details', {})
            valid = len(calls) == 1 and provenance.get('groupId') == request.get('id') and record.get('adapter') == provenance.get('adapter')
            if record.get('kind') == 'file-write':
                actual_success = not payload.get('isError', False) and not payload.get('output', {}).get('isError', False)
                valid = valid and record.get('path') == details.get('path') and record.get('bytes') == details.get('bytes') and record.get('savedAtOperation') is actual_success
            elif record.get('kind') == 'command':
                valid = valid and record.get('exitCode') == details.get('exitCode') and record.get('timedOut') == details.get('timedOut') and record.get('command') == payload.get('input', {}).get('command') and record.get('verificationCoverage') == 'unknown' and record.get('workspaceRevision') is None
            else:
                valid = False
            checks.append({'sourceIds': ids, 'kind': record.get('kind'), 'passed': bool(valid)})
        rows.append({'sequence': event.get('sequence'), 'tokens': event.get('data', {}).get('tokens'),
                     'omittedRecords': view.get('omittedRecords'), 'unknownResults': view.get('unknownResults'),
                     'records': checks, 'passed': all(check['passed'] for check in checks)})
    return {'scope': 'runtime-diagnostic-source-correspondence-v1',
            'status': 'not-exercised' if not rows else 'pass' if all(row['passed'] for row in rows) else 'fail',
            'viewCount': len(rows), 'recordCount': sum(len(row['records']) for row in rows), 'rows': rows,
            'limitations': ['Checks correspondence with controlled runtime artifacts, not journal cryptographic authentication.',
                            'Does not grade model answers, current workspace state or behavioral correctness.']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--result', type=Path, required=True)
    parser.add_argument('--events', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = json.loads(args.result.read_text())
    events = [json.loads(line) for line in args.events.read_text().splitlines() if line.strip()]
    report = check_views(result['entries'], events)
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({key: report[key] for key in ['status', 'viewCount', 'recordCount']}))
    return int(report['status'] == 'fail')


if __name__ == '__main__':
    raise SystemExit(main())
