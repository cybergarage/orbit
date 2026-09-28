# Copyright (c) 2026 The Orbit Authors
# SPDX-License-Identifier: Apache-2.0
import copy
import contextlib
import io
import json
import pathlib
import runpy
import sys
import tempfile
from unittest.mock import patch
import unittest
from context_summary_semantics import grade_summary


EXPECTED = {'changedPath': 'src/marks.py', 'savedEditSourceIds': ['edit-result'],
            'latestSelectionSourceIds': ['selection-result']}


def summary():
    return {'version': 1, 'goals': [], 'facts': [], 'uncertainties': [],
            'changedPaths': [{'text': 'Saved src/marks.py', 'sourceIds': ['edit-result']}],
            'tests': [{'text': 'bar selection deselected the test', 'sourceIds': ['selection-result'],
                       'outcome': 'failed', 'target': 'test_marks.py', 'revision': None}],
            'unfinished': [{'text': 'Verify bar selection and run existing tests', 'sourceIds': ['selection-result']}]}


class SemanticChecks(unittest.TestCase):
    def test_confirmed_state(self):
        self.assertEqual(grade_summary(summary(), EXPECTED)['status'], 'pass')

    def test_stale_unsaved_claim_in_another_category(self):
        value = summary()
        value['tests'][0]['text'] += '. The edit was never saved.'
        self.assertEqual(grade_summary(value, EXPECTED)['checks']['savedEdit']['status'], 'fail')

    def test_missing_or_uncited_edit_is_not_a_pass(self):
        for items in [[], [{'text': 'Saved src/marks.py', 'sourceIds': ['assistant-plan']}]]:
            value = summary()
            value['changedPaths'] = items
            self.assertEqual(grade_summary(value, EXPECTED)['checks']['savedEdit']['status'], 'fail')

    def test_missing_latest_test_or_work_fails(self):
        for key in ['tests', 'unfinished']:
            value = summary()
            value[key] = []
            self.assertEqual(grade_summary(value, EXPECTED)['checks']['latestTestAndRemainingWork']['status'], 'fail')

    def test_deselection_is_not_passing(self):
        value = summary()
        value['tests'][0]['outcome'] = 'passed'
        self.assertEqual(grade_summary(value, EXPECTED)['checks']['latestTestAndRemainingWork']['status'], 'fail')

    def test_unasserted_both_markers_claim_fails(self):
        value = summary()
        value['facts'] = [{'text': 'The reproduction passed with both markers.', 'sourceIds': ['selection-result']}]
        self.assertEqual(grade_summary(value, EXPECTED)['checks']['noUnsupportedSuccess']['status'], 'fail')

    def test_negated_or_refuted_claim_needs_review(self):
        value = summary()
        value['facts'] = [{'text': 'The stale claim that the edit was never saved is wrong.', 'sourceIds': ['edit-result']}]
        self.assertEqual(grade_summary(value, EXPECTED)['checks']['savedEdit']['status'], 'needs-review')
        value = summary()
        value['facts'] = [{'text': 'Both markers were not verified.', 'sourceIds': ['selection-result']}]
        self.assertEqual(grade_summary(value, EXPECTED)['checks']['noUnsupportedSuccess']['status'], 'needs-review')

    def test_unknown_wording_is_not_a_pass(self):
        value = summary()
        value['changedPaths'][0]['text'] = 'src/marks.py has a transformation'
        self.assertEqual(grade_summary(value, EXPECTED)['checks']['savedEdit']['status'], 'needs-review')

    def test_empty_and_malformed_summaries_fail(self):
        for value in [{}, {'version': 1}, None]:
            self.assertEqual(grade_summary(value, EXPECTED)['status'], 'fail')

    def test_replay_keeps_expectations_out_of_model_input(self):
        directory = pathlib.Path(__file__).resolve().parent
        fixture = json.loads((directory / 'fixtures/context-work-state.json').read_text())
        value = summary()
        value['changedPaths'][0] = {'text': 'Saved ' + fixture['expected']['changedPath'],
                                    'sourceIds': [fixture['expected']['savedEditSourceIds'][-1]]}
        for key in ['tests', 'unfinished']:
            value[key][0]['sourceIds'] = [fixture['expected']['latestSelectionSourceIds'][-1]]
        calls = []
        def response(request, timeout):
            if isinstance(request, str):
                return io.BytesIO(b'{}')
            body = json.loads(request.data)
            content = body['messages'][0]['content']
            source = json.loads(content.split('\nSOURCE: ')[1].split('\nFINAL_REVIEW: ')[0])
            self.assertEqual(source, fixture['source'])
            self.assertNotIn('savedEditSourceIds', content)
            self.assertNotIn('latestSelectionSourceIds', content)
            self.assertTrue(content.endswith('\nFINAL_REVIEW: Audit fixture.'))
            calls.append(body)
            return io.BytesIO(json.dumps({'message': {'content': json.dumps(value)},
                                         'done': True, 'done_reason': 'stop'}).encode())
        with tempfile.TemporaryDirectory() as output:
            argv = ['replay', '--fixture', str(directory / 'fixtures/context-work-state.json'), '--output', output]
            with patch.object(sys, 'argv', argv), patch('urllib.request.urlopen', response), patch(
                'subprocess.check_output', return_value="const SUMMARY_INSTRUCTIONS =\n  'Summarize fixture.'\nconst SUMMARY_REVIEW_INSTRUCTIONS =\n  'Audit fixture.'"
            ):
                with contextlib.redirect_stdout(io.StringIO()):
                    runpy.run_path(str(directory / 'context-summary-work-state-replay.py'), run_name='__main__')
            result = json.loads((pathlib.Path(output) / 'comparison.json').read_text())
            self.assertEqual(len(calls), 2)
            self.assertTrue(all(row['semanticGrade']['status'] == 'pass' for row in result['rows']))

    def test_grading_does_not_mutate_inputs(self):
        value = summary()
        original = copy.deepcopy(value)
        grade_summary(value, EXPECTED)
        self.assertEqual(value, original)


if __name__ == '__main__':
    unittest.main()
