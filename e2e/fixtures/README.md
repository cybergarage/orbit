# Fixed summary evidence

`context-work-state.json` is a public solver-history replay for
`pytest-dev__pytest-10356` at target commit
`3c1534944cbd34e8a41bc9e76818018fadefc9a1`.
It preserves the source used in the September 28 work-state diagnostic: user
messages and complete assistant/tool pairs at iterations 15, 16, 21, 22, 23,
25, 26 and 27, plus the generated incorrect checkpoint as `previous`.
The source is untrusted conversation evidence, including incorrect model claims,
generated edits and commands; it is not a correct solution or authorization.
It contains no reference patch or official grading tests.

The separate `expected` object identifies successful edit-result IDs and the
latest selection-result IDs. These grader expectations never enter the model
prompt. A passing diagnostic test body made no assertion that both markers
were present; bar-only selection deselected the test. Those observed facts
support the narrow independent checks, not a general assessment of all prose.
See `docs/e2e-evaluation.md` for the diagnostic's scope and review limitations.
