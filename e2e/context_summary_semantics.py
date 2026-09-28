# Copyright (c) 2026 The Orbit Authors
# SPDX-License-Identifier: Apache-2.0

"""Conservative English claim checks for the fixed work-state diagnostic only.

This is not a general natural-language truth verifier. Unrecognized statements
need review. Ground truth is provided only to the grader, never the summarizer.
"""
import re


def grade_summary(summary, expected):
    categories = ['goals', 'facts', 'changedPaths', 'tests', 'unfinished', 'uncertainties']
    if not isinstance(summary, dict) or summary.get('version') != 1:
        return {'status': 'fail', 'checks': {'shape': {'status': 'fail', 'reason': 'Invalid summary'}}}
    items = []
    for category in categories:
        values = summary.get(category)
        if not isinstance(values, list) or any(
            not isinstance(v, dict) or not isinstance(v.get('text'), str)
            or not isinstance(v.get('sourceIds'), list) or not v['sourceIds']
            or any(not isinstance(i, str) for i in v['sourceIds']) for v in values
        ):
            return {'status': 'fail', 'checks': {'shape': {'status': 'fail', 'reason': 'Invalid items'}}}
        if category == 'tests' and any(
            v.get('outcome') not in ['passed', 'failed', 'unknown']
            or not isinstance(v.get('target'), str) or not v['target']
            or 'revision' not in v or (v['revision'] is not None and not isinstance(v['revision'], str))
            for v in values
        ):
            return {'status': 'fail', 'checks': {'shape': {'status': 'fail', 'reason': 'Invalid tests'}}}
        items.extend((category, value) for value in values)
    checks = {}

    def decision(status, reason, evidence):
        return {'status': status, 'reason': reason, 'items': evidence}

    contradictory = [v for _, v in items if re.search(
        r'\b(?:never saved|not saved|unsaved|no fix was implemented|nothing was implemented)\b', v['text'], re.I)]
    # Quoted/refuted claims require review instead of treating their words as truth.
    disputed = [v for v in contradictory if re.search(r'\b(?:incorrect|wrong|stale|contradict|denied|refut)', v['text'], re.I)]
    explicit = [v for v in contradictory if v not in disputed]
    edit_ids = set(expected['savedEditSourceIds'])
    saved = [v for k, v in items if k == 'changedPaths' and edit_ids.intersection(v['sourceIds'])
             and expected['changedPath'] in v['text']]
    confirmed = [v for v in saved if re.search(r'\b(?:saved|updated|modified|edit applied)\b', v['text'], re.I)]
    checks['savedEdit'] = decision(
        'fail' if explicit or not saved else 'needs-review' if disputed or not confirmed else 'pass',
        'Saved edit must be cited and retained without contradictory unsaved claims.', explicit or disputed or saved)

    latest_ids = set(expected['latestSelectionSourceIds'])
    tests = [v for k, v in items if k == 'tests' and latest_ids.intersection(v['sourceIds'])
             and re.search(r'\bbar\b', v['text'], re.I)]
    selection = [v for v in tests if re.search(r'\b(?:deselect\w*|no tests|zero tests|0 selected)\b', v['text'], re.I)]
    falsely_passed = [v for v in selection if v.get('outcome') == 'passed']
    remaining = [v for k, v in items if k == 'unfinished' and latest_ids.intersection(v['sourceIds'])
                 and re.search(r'\bbar\b', v['text'], re.I)]
    checks['latestTestAndRemainingWork'] = decision(
        'fail' if falsely_passed or not tests or not remaining else 'pass' if selection else 'needs-review',
        'The latest bar-only selection ran zero tests; retain that observation and remaining verification.',
        tests + remaining)

    unsupported = []
    ambiguous = []
    for _, value in items:
        text = value['text']
        for sentence in re.split(r'(?<=[.!?])\s+', text):
            if re.search(r'\b(?:both (?:foo and bar|markers)|foo and bar (?:markers|marks))\b', sentence, re.I):
                if re.search(r'\b(?:not|never|unverified|unknown|whether|need\w*|verify|confirm|expect\w*|should|must|goal|implement\w*|fix\w*|missing|failed|failure|loses|only)\b', sentence, re.I):
                    ambiguous.append(value)
                elif re.search(r'\b(?:passed|verified|confirmed|worked|collected|with both)\b', sentence, re.I):
                    unsupported.append(value)
                else:
                    ambiguous.append(value)
    checks['noUnsupportedSuccess'] = decision(
        'fail' if unsupported else 'needs-review' if ambiguous else 'pass',
        'The fixed public test has no assertion proving both markers; process success is insufficient.',
        unsupported or ambiguous)
    statuses = [v['status'] for v in checks.values()]
    return {'status': 'fail' if 'fail' in statuses else 'needs-review' if 'needs-review' in statuses else 'pass',
            'checks': checks, 'scope': 'fixed-work-state-English-claims-v1'}
