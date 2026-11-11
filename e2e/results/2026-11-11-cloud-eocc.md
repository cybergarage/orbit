# Cloud EoCC persistence and continuation diagnostic

On 2026-11-11, the final diagnostic passed all four provider/algorithm cases:
EoCC created a checkpoint, saved it with a file-backed execution journal, reopened
the session with the same projection, and continued through a real model call.
The continued answer retained the branch, marker and pending check, stated that
the check had not run, and survived a second close/reopen. No second compaction
was needed. This is a synthetic lifecycle test, not benchmark success or evidence
of superiority over Orbit's existing suffix strategy.

Related: [Issue #22](https://github.com/cybergarage/orbit/issues/22),
[accepted ADR](../../docs/adr/2026-11-11-selectable-session-compaction.md),
[earlier local evaluation](../../docs/research/2026-11-11-local-compaction-transfer.md),
[all diagnostic attempts](2026-11-11-cloud-eocc.json).

## Final measured cases

| Requested and returned model | Algorithm             | Estimated input before / after | Summary calls / continuation calls | Result |
| ---------------------------- | --------------------- | ------------------------------ | ---------------------------------- | ------ |
| `gpt-4o-2024-08-06`          | structured-summary-v1 | 16,140 / 337                   | 1 / 1                              | Passed |
| `gpt-4o-2024-08-06`          | handoff-summary-v1    | 16,140 / 281                   | 1 / 1                              | Passed |
| `claude-opus-4-6`            | structured-summary-v1 | 16,135 / 518                   | 1 / 1                              | Passed |
| `claude-opus-4-6`            | handoff-summary-v1    | 16,135 / 549                   | 1 / 1                              | Passed |

All cases use `eocc-v1`, window/trigger/target 32,768/12,288/8,192, a
4,096-token worker and summary output allowance, and a 180-second, six-call
limit per phase. Input estimates use `gpt-json-v1` and are not provider token
counts. The summary still consumes the original long input: peak completed
provider inputs were 17,037 / 17,119 / 20,181 / 20,269 tokens respectively.
The ledger includes combined summary and continuation usage; billed cost and
cache accounting remain unknown. Default provider sampling applies; no seed or
temperature equivalence is claimed.

## Failures and corrections

The ledger preserves every live diagnostic launch, including setup failures.
Initial attempts stopped before inference because the new isolated storage was
not initialized. A subsequent attempt used an in-memory journal with persistent
sessions: OpenAI generated summaries, but checkpoint commits failed with
`recording-failed`. The diagnostic now initializes its private storage and uses
`FileExecutionJournal` with the recorder's writer lease. An intermediate runner
also attempted to acquire that lease twice and failed before inference.

Anthropic rejected both initial recap requests with HTTP 400 because the
adapter sent an open object schema in `output_config.format`. Its API requires
`additionalProperties: false` for object schemas. Closing an otherwise empty
schema would allow only an empty object, so it would not implement Orbit's
generic JSON hint. The adapter now adds a JSON-only system instruction instead;
Orbit still parses and validates the summary. This is prompt-based formatting,
not a constrained-decoding guarantee. [Anthropic structured-output requirements](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)

One intermediate rerun still contained the rejected wire field; it passed the
OpenAI cases and failed the Anthropic cases. After removing the field, all four
cases passed. These development attempts are not independent repeated trials
and are not aggregated into a model success rate.

## Provenance and limits

The runtime baseline is `81bf5cca6a38be6ecb3d322f6dd8359c5f1ccfee`, with the
Anthropic adapter correction and new diagnostic runner in this change. The
ledger records source fingerprints, source-history hashes and event-file hashes.
The final run also records the runner hash. Raw synthetic transcripts, checkpoints,
responses and journals remain in the ignored local evidence directory. UUIDs
vary between launches; each launch shares one history across all four cases.

The fixture has 1,000 repetitive assistant observations and explicit retention
instructions. It does not exercise real tools, long repair trajectories, task
verifiers, exact recall of arbitrary history, or repeated resets. Persistence
uses the existing format-2 transcript and projection-version-4 checkpoint.
Continuation exercises context preparation and the real adapter under a managed
Run; it is not a full Agent tool loop. A pass proves only the checked lifecycle
and retained facts for this fixture. Model identifiers are explicit, but hosted
backend immutability is not independently verified.

The worker factory supports both cloud providers without changing the default
Ollama path. The standalone diagnostic does not yet extend the SWE-bench/Harbor
host launchers with cloud credential delivery. Next work is held-out task-level
evaluation with matched budgets, followed by a separately specified paper
reproduction. No default strategy changes follow from this diagnostic.

See [execution instructions](../../docs/development.md#cloud-eocc-persistence-diagnostic).

## Validation

Headers and build passed. The complete local suite passed 1,316 tests, and
`test:e2e:unit` passed 27 tests. The first full-suite attempt had loopback sandbox
failures and one missing generated module caused by overlapping a build with the
test process; the successful full rerun followed the completed build with
loopback permission. No live cloud calls run in the deterministic CI suite.
