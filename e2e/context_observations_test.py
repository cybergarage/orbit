# Copyright (c) 2026 The Orbit Authors
# SPDX-License-Identifier: Apache-2.0
import copy
import json
import pathlib
import unittest
import runpy
import tempfile
import sys
import io
import contextlib
from unittest.mock import patch
from context_observations import extract_observations, observation_view


def pair(mid, tool, details, error=False, call_id='reused'):
    return [{'id': mid, 'payload': {'toolCalls': [{'id': call_id, 'name': tool,
              'input': {'command': 'pytest', 'path': 'wrong-input-path'}}]}},
            {'id': mid + '-result', 'parentid': mid, 'type': 'tool',
             'payload': {'toolCallId': call_id, 'name': tool, 'isError': error,
                         'output': {'details': details, 'isError': error}}}]


class Observations(unittest.TestCase):
    def test_known_log_uses_saved_results_not_stale_summary(self):
        fixture = json.loads((pathlib.Path(__file__).parent / 'fixtures/context-work-state.json').read_text())
        ledger = extract_observations(fixture['source']['messages'])
        self.assertEqual(ledger['unlinkedResultIds'], [])
        view = observation_view(ledger)
        writes = [r for r in view['records'] if r['kind'] == 'file-write']
        self.assertEqual(len(writes), 1)
        self.assertEqual(writes[0]['path'], '/workspace/src/_pytest/mark/structures.py')
        self.assertTrue(writes[0]['savedAtOperation'])
        self.assertEqual(writes[0]['sourceIds'][-1], '01a0e6c2-c1df-745a-89cc-d0f1eed79d0f')
        last = view['records'][-1]
        self.assertEqual(last['exitCode'], 5)
        self.assertIn('1 deselected', last['stdout'])
        self.assertEqual(last['verificationCoverage'], 'unknown')

    def test_reused_call_ids_are_correlated_by_parent(self):
        ledger = extract_observations(pair('a', 'edit', {'path': 'a.py', 'bytes': 3}) +
                                      pair('b', 'edit', {'path': 'b.py', 'bytes': 4}))
        self.assertEqual([r['path'] for r in ledger['records']], ['a.py', 'b.py'])

    def test_failed_later_write_is_not_saved(self):
        ledger = extract_observations(pair('a', 'edit', {'path': 'a.py'}) +
                                      pair('b', 'edit', {'path': 'a.py'}, True))
        self.assertEqual([r['savedAtOperation'] for r in observation_view(ledger)['records']], [True, False])
        self.assertEqual(len(ledger['records']), 2)

    def test_cancelled_intent_without_result_is_not_observation(self):
        self.assertEqual(extract_observations(pair('a', 'edit', {'path': 'a.py'})[:1])['records'], [])

    def test_orphan_and_duplicate_results_are_not_paired_by_name(self):
        messages = pair('a', 'edit', {'path': 'a.py'})
        result = copy.deepcopy(messages[-1]); result['id'] = 'other'; messages.append(result)
        orphan = copy.deepcopy(result); orphan['id'] = 'orphan'; orphan['parentid'] = 'missing'; messages.append(orphan)
        ledger = extract_observations(messages)
        self.assertEqual(len(ledger['records']), 1)
        self.assertEqual(ledger['unlinkedResultIds'], ['other', 'orphan'])

    def test_duplicate_source_identity_is_rejected(self):
        with self.assertRaises(ValueError):
            extract_observations([{'id': 'same'}, {'id': 'same'}])

    def test_external_tool_is_not_assumed_builtin(self):
        ledger = extract_observations(pair('a', 'mcp:edit', {'path': 'a.py'}))
        self.assertEqual(ledger['records'][0]['kind'], 'tool-result')

    def test_shell_success_does_not_prove_tests_or_file_changes(self):
        ledger = extract_observations(pair('a', 'bash', {'exitCode': 0, 'stdout': 'all features verified'}))
        self.assertEqual(ledger['records'][0]['kind'], 'command')
        self.assertEqual(ledger['records'][0]['verificationCoverage'], 'unknown')
        self.assertNotIn('savedAtOperation', ledger['records'][0])

    def test_same_path_reedit_keeps_history_and_latest_observation(self):
        ledger = extract_observations(pair('a', 'write', {'path': 'a.py', 'bytes': 3}) +
                                      pair('b', 'edit', {'path': 'a.py', 'bytes': 4}))
        self.assertEqual(len(ledger['records']), 2)
        self.assertEqual(observation_view(ledger)['records'][0]['bytes'], 4)

    def test_view_does_not_silently_drop_mandatory_data_for_budget(self):
        ledger = extract_observations(pair('a', 'bash', {'stdout': 'x' * 1000}))
        with self.assertRaises(ValueError):
            observation_view(ledger, max_bytes=100)

    def test_unknown_revision_and_truncated_output_are_not_upgraded(self):
        record = extract_observations(pair('a', 'bash', {'exitCode': 0, 'truncated': True}))['records'][0]
        self.assertTrue(record['outputTruncated'])
        self.assertNotIn('revision', record)

    def test_junit_reports_counts_without_behavioral_verification(self):
        read = runpy.run_path(str(pathlib.Path(__file__).parent / 'orbit-test.py'))['read_junit']
        with tempfile.TemporaryDirectory() as directory:
            report = pathlib.Path(directory) / 'report.xml'
            report.write_text('<testsuites><testsuite tests="4"><testcase/><testcase><failure/></testcase><testcase><error/></testcase><testcase><skipped/></testcase></testsuite></testsuites>')
            value = read(report)
            self.assertEqual(value['counts'], {'reported': 4, 'passed': 1, 'failed': 1, 'errors': 1, 'skipped': 1})
            self.assertEqual(value['verificationCoverage'], 'unknown')
            report.write_text('<testsuite tests="0"/>')
            self.assertEqual(read(report)['counts']['passed'], 0)
            report.write_text('<testsuite tests="1"/>')
            with self.assertRaises(ValueError):
                read(report)

    def test_consumer_grader_requires_actual_source_evidence(self):
        grade = runpy.run_path(str(pathlib.Path(__file__).parent / 'context-observations-replay.py'))['grade_answer']
        expected = {'changedPath': 'a.py', 'savedEditSourceIds': ['edit'], 'latestSelectionSourceIds': ['test']}
        answer = {'savedEdits': [{'path': 'a.py', 'savedAtOperation': True, 'sourceIds': ['edit']}],
                  'latestBarSelection': {'result': 'no-tests-selected', 'sourceIds': ['test']},
                  'behaviorVerification': {'status': 'unverified', 'sourceIds': ['test']}}
        self.assertEqual(grade(answer, expected)['status'], 'pass')
        for key in ['savedEdits', 'latestBarSelection', 'behaviorVerification']:
            bad = copy.deepcopy(answer); bad[key] = [] if key == 'savedEdits' else {}
            self.assertEqual(grade(bad, expected)['status'], 'fail')
        answer['behaviorVerification']['status'] = 'verified'
        self.assertEqual(grade(answer, expected)['status'], 'fail')

    def test_consumer_replay_isolates_expected_values_and_conditions(self):
        directory = pathlib.Path(__file__).parent
        fixture = json.loads((directory / 'fixtures/context-work-state.json').read_text())
        calls = []
        def response(request, timeout):
            if isinstance(request, str):
                return io.BytesIO(b'{}')
            source = json.loads(json.loads(request.data)['messages'][0]['content'].split('\nSOURCE: ')[1])
            self.assertNotIn('expected', source)
            self.assertNotIn('savedEditSourceIds', str(source))
            self.assertEqual(source['checkpoint'], fixture['source']['previous'])
            answer = {'savedEdits': [], 'latestBarSelection': {'result': 'unknown', 'sourceIds': []},
                      'behaviorVerification': {'status': 'unknown', 'sourceIds': []}}
            if 'observations' in source:
                answer = {'savedEdits': [{'path': fixture['expected']['changedPath'], 'savedAtOperation': True,
                          'sourceIds': [fixture['expected']['savedEditSourceIds'][-1]]}],
                          'latestBarSelection': {'result': 'no-tests-selected', 'sourceIds': [fixture['expected']['latestSelectionSourceIds'][-1]]},
                          'behaviorVerification': {'status': 'unverified', 'sourceIds': [fixture['expected']['latestSelectionSourceIds'][-1]]}}
            calls.append(source)
            return io.BytesIO(json.dumps({'message': {'content': json.dumps(answer)}, 'done': True, 'done_reason': 'stop'}).encode())
        with tempfile.TemporaryDirectory() as temporary:
            out = pathlib.Path(temporary) / 'run'
            argv = ['replay', '--fixture', str(directory / 'fixtures/context-work-state.json'), '--output', str(out), '--repetitions', '1']
            with patch.object(sys, 'argv', argv), patch('urllib.request.urlopen', response), patch('subprocess.check_output', return_value='a' * 40):
                with contextlib.redirect_stdout(io.StringIO()):
                    runpy.run_path(str(directory / 'context-observations-replay.py'), run_name='__main__')
            rows = json.loads((out / 'comparison.json').read_text())['rows']
            self.assertEqual([r['grade']['status'] for r in rows], ['fail', 'pass'])
            self.assertEqual(len(calls), 2)

    def test_input_unchanged_and_view_deterministic(self):
        messages = pair('a', 'edit', {'path': 'a.py'}); before = copy.deepcopy(messages)
        a = extract_observations(messages)
        self.assertEqual(a, extract_observations(messages)); self.assertEqual(messages, before)
        self.assertEqual(observation_view(a), observation_view(a))


if __name__ == '__main__':
    unittest.main()
