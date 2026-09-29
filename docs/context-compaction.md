# Input budgets and conversation compaction

A saved conversation can be larger than a model request. Orbit can prepare a
smaller input while retaining the original Session messages and their IDs.
Budgeting is opt-in; an absent policy or `mode: "disabled"` preserves unbudgeted
compatibility behavior. The same policy is used by Agent, Service, CLI and GUI.

## Configure a profile

Set `contextPolicy` in workspace settings, or pass it to `Agent` or
`OrbitApplicationService.create`. Settings replace the complete policy when a
nearer workspace overrides it. Programmatic callers can also inject an
estimator function. JSON settings use the built-in estimator. An injected estimator returns `model`,
`provider`, `revision`, `kind`, `tokens` and additive `components`; mismatched
model identity or unknown accounting refuses preparation. The estimator function
stays in memory while each Run snapshots the JSON profile for its journal.

```json
{
  "contextPolicy": {
    "mode": "budgeted",
    "profile": {
      "revision": "local-trial-1",
      "provider": "ollama",
      "model": "example-model",
      "window": 8192,
      "outputReserve": 1024,
      "safetyMargin": 256,
      "trigger": 5000,
      "target": 3000,
      "summaryOutput": 512,
      "templateOverhead": 128
    }
  }
}
```

These are illustrative values, not a measured product profile. Replace the model
identity, window and counts using the selected model and application conditions.
A model switch with a mismatched profile refuses the next budgeted invocation.
Before each budgeted preparation, Orbit reconciles the profile with
[provider metadata and runtime context settings](model-context-capacity.md).
The profile window is a ceiling/fallback; discovered smaller limits reduce it.
OpenAI uses a documented exact-ID catalog rather than model-name inference.

The ordinary input budget is `window - outputReserve - safetyMargin`. Counts
must be nonnegative safe integers, reserves must be positive, and
`0 < target < trigger <= input budget`. At or above `trigger`, Orbit attempts
one compaction for that model iteration. The new request must fit `target` and
be smaller than the old request. A summary also has its own input budget within
the same model window and initially uses `summaryOutput` as its output cap. If
the model stops a summary at that cap, Orbit first retries the same source with
up to `outputReserve` output tokens when the expanded request fits its input
budget. If it still stops at the output cap, Orbit retries smaller groups of
complete tool exchanges. The same recovery applies to each batch. Summary
instructions request concise JSON within the selected output budget and
consolidate repeated facts without discarding unfinished work or test evidence.
Only a complete, validated final summary becomes a checkpoint.

The `context.summary.started` diagnostics identify the request phase (`full`,
`batch` or `expanded`), source message count and output limit. A
`context.summary.truncated` event records an output-length stop separately from
a transport failure. Completed request events indicate a response was received;
only `context.compaction.completed` confirms a validated checkpoint was saved.

`estimateJSONRequest` tokenizes the entire frozen JSON request and adds the
explicit `templateOverhead` assumption. This includes serialized instructions,
messages and tool schemas. It is an estimate, not a provider token-count oracle;
server templates and tokenizer differences can still cause provider rejection.
Recognized image/audio request parts return unknown and refuse budgeted use.
An injected `RequestEstimator` must return a revision, kind, total and component
counts whose sum equals that total. Unknown counts never mean zero.

Built-in adapters implement `Model.prepare(messages, options)`, returning a
`PreparedModelInvocation` whose frozen `request` describes the JSON sent by
`invoke()`. The Ollama adapter includes `stream: false` in that projection and
passes a fresh deep copy to each SDK invocation: the SDK assigns request fields
in place, while the counted projection must remain unchanged, including after
an SDK failure.
`maxOutputTokens` maps to OpenAI Chat Completions `max_completion_tokens`,
Anthropic `max_tokens`, and Ollama `options.num_predict`. A custom Model must
implement this prepared-request and cap contract before budgeted use; an adapter
without `prepare` is rejected. Direct Model calls are not managed Agent runs.
Summary invocations also request JSON output: OpenAI uses JSON mode, Anthropic
uses its structured-output configuration, and Ollama uses `format: "json"`.
Orbit still parses and validates every response against the versioned summary
shape and original source IDs before it can save a checkpoint. A provider's
format constraint does not replace that validation.
The summary prompt prioritizes confirmed edit/write results, the latest observed
test outcomes, and remaining work. Later tool evidence supersedes older plans
and checkpoint claims; a failed test does not imply that an edit was undone.
These instructions improve evidence retention, but shape/source-ID validation
does not prove that generated prose faithfully describes the source.

## What remains in context

Trusted instructions remain outside the summary. Original user inputs for the
active Run remain verbatim, including multiple initial inputs and Graph stage
inputs. Older turns are compacted first when that leaves enough room. Otherwise,
completed tool rounds within the active turn can be summarized while the newest
complete round remains verbatim. No call/result group may cross the boundary.
Missing, duplicate or mismatched results refuse preparation. Canonical history
is never deleted or overwritten, and a checkpoint is not permission to retry tools.
A single oversized protected input, newest tool group, or eligible tool group
still stops safely. When the complete summary source exceeds its input budget,
Orbit summarizes consecutive batches without dividing a tool call from its
results. It validates each intermediate summary, then saves only the final
checkpoint after measuring the resulting ordinary request.

Within-turn checkpoints use projection version 3 and retain original user IDs.
Save/reopen validation checks those references, exact current-Run user retention,
source digests, linear history and complete tool groups on both sides. Existing
projection versions 1 and 2 remain readable. Older Orbit binaries cannot read
new projection-version-3 checkpoints, even in transcript v2; upgrade readers
before enabling this feature. Verified interruption still requires transcript v3
and the existing proof/synchronization contract.

The summarizer is the configured Agent model, called without tools. It consumes
the same Run's model-call allowance and obeys its cancellation, deadline and
resource ownership. Its response must be JSON with version 1 and arrays named
`goals`, `facts`, `changedPaths`, `tests`, `unfinished`, and `uncertainties`.
Each item contains nonempty `text` and `sourceIds` referring to original messages.
Test items also require a target, a revision string (or null when unknown), and
an outcome of passed, failed or unknown. At least one item is required. Tool calls
in a summary response are rejected. A complete JSON code fence around the object
is accepted, but surrounding prose and invalid evidence references are rejected.
Each batch consumes a model call and the same Run budget. If a later batch
fails, no intermediate checkpoint becomes active.

The checkpoint is labeled untrusted and projected as user-level context.
Valid source references do not establish that every statement is true or that
nothing important was omitted. Review retained original messages when a fact
matters. Deterministic test fixtures verify mechanics; representative real-model
quality and cost trials remain separate work.

## Failure and visibility

On an invalid or failed summary, Orbit may use the unchanged original input only
when it still fits the ordinary budget and the Run remains active with capacity.
Malformed JSON, invalid summary fields, and unknown source IDs have distinct
diagnostic reasons. After one such validation failure, the same Run skips further
summary attempts while its ordinary request fits the budget. It retries at the
hard budget; if the summary still fails, the Run cannot safely continue.
It emits a `context-prepared` event with outcome `failed`. Successful compaction
emits outcome `compacted` with before/after estimates. Events carry counts and
outcomes, not transcript bodies. Ink and GUI show the active mode and the latest
compaction outcome; the application service records `context.prepared` diagnostics.
The noninteractive CLI reports enabled budgeting and compaction outcomes on stderr.

Unknown input size, protected-input overflow, an oversized individual summary batch,
cancellation, exhausted Run budgets, unresolved work and recording failures do
not bypass the budget. With budgeting enabled, a recognized provider overflow,
recoverable length stop, or Ollama truncated tool-argument response can trigger
one forced compaction and one regeneration. The checkpoint must advance, fit the
target, and produce a request smaller than the rejected input. Recovery never
falls back to the unchanged request. A second failure stops; refusals, filters,
pauses and unrelated provider errors do not trigger this recovery. Summary and
regeneration calls count against the same Run budget. Orbit never retries by
deleting oldest messages. A storage failure marks required recording failed and retains
the existing Run's recovery conditions. See [Execution](execution.md).

## Checkpoints and resume

The pure `SessionContextBuilder` still builds synchronously. Agent's asynchronous
preparer handles estimation, summary generation and saving before projection.
Nested projected payloads are copied so a caller cannot modify the canonical
payload through its model input.

Transcript v2 adds an append-only `compaction` entry. It records the Session ID,
source head, prefix end, first retained message, predecessor checkpoint, SHA-256
digest of canonical original message representations, structured summary,
projection version, model/provider, profile/estimator revisions, token estimates,
summary usage when available and timestamp. This transcript version is independent
of the v2 root-registration binding format.

Persistent activation waits for the Run's required transcript synchronization.
On reopen, a complete surviving checkpoint is validated and re-synchronized under
the writer before use. This does not imply the earlier caller received a success
response. A malformed final partial transcript line follows existing recovery;
an invalid complete checkpoint refuses loading. Original message entries remain.
Repeated checkpoints refer to the preceding checkpoint and an expanded original
prefix; summaries are not regenerated on resume. Disabled budget mode still
replays an existing valid checkpoint and only disables automatic preparation.

## Migrate existing transcripts

New budgeted persistent Sessions use transcript v2 unless verified interrupted context selects v3. `SessionRepository.create`
accepts `formatVersion: 2`; the default remains v1 for compatibility. Enabling
budgeting for a persistent v1 Session reports `transcript-migration-required`.
Old readers cannot open v2. Stop old binaries and their automatic restart sources
before migration, as required by [Session storage](session-storage.md).

```sh
orbit storage inspect SESSION_ID
orbit storage migrate-transcript SESSION_ID --writers-stopped --restarters-disabled --exclusive-storage-control
orbit storage resume-transcript SESSION_ID --writers-stopped --restarters-disabled --exclusive-storage-control
```

Use `--session-root` and `--journal-root` to name a registered pair explicitly.
`inspect` is read-only. The confirmations assert external exclusion that survives
the maintenance process; flags do not stop other processes for you.

The public equivalents are `inspectTranscriptMigration(scope)` and
`migrateSessionTranscript(scope, file, conditions, resume?)`. Migration preserves
IDs and writes a retained `.v1-backup`, a synchronized intent and `.v2-pending`
copy before replacement and parent-directory synchronization. A stable Session
maintenance guard covers rename, validation and release. Normal acquisition,
read-only isOpen checks and deletion recognize pending migration; generic writer
recovery refuses its intent.

After interruption, keep external exclusion and use migration-aware resume.
It accepts only source/target digests matching the intent and validates the backup
before release. If interruption left only a guard before an intent existed,
inspect that evidence under the existing offline writer-recovery procedure and
then retry migration. A partial or conflicting backup, replacement or intent
requires exclusive evidence review; do not delete it based only on a dead PID.
A missing guard with a valid surviving intent is re-established during exclusive
resume. The minimal deletion record and the prohibition on deleted-ID reuse remain.

The migration backup contains original conversation data and remains until an
operator handles it under the application's retention policy. It is not a second
registered Session. Windows and physical-storage-failure trials remain unverified;
current automated evidence targets macOS and Linux.

## Explicit Skill selection

Selected Skill instructions are protected ordinary-request prefixes in both
budget modes. The dedicated summarizer receives no active Skill bodies; frozen
bodies return in the subsequent answering request. Historical snapshots remain
separate from canonical conversation-message digests. See [Skills](skills.md).

### Opt-in verified interruption

With [verified interrupted context](interrupted-context.md), new persistent Sessions use v3 and old ones need the separate byte-preserving migration. Only uniquely proven cancelled nondispatch can supply error-form input. Projection-aware checkpoints use projection version 2, retain raw source digests and reference synchronized provenance. Ordinary version-1 checkpoints keep their strict validation. Summary requests serialize raw evidence as untrusted data and receive no tools or Skills. Mandatory cancellation notices remain outside the summary, count toward the ordinary budget, and never release latest-turn protection. Policy-off and budget-off paths cannot bypass verification of dependent history.

## Project memory

The core Project service groups independent conversations; the GUI exposes
curated notes, source excerpts, selection and preview. Memory is captured once
per managed Run as journal-v3 evidence and inserted as a fixed user-role prefix.
It is not appended to canonical history or included in compaction source text.
The prepared-request budget still includes it. Library callers opt in explicitly;
GUI Project conversations default to curated mode and offer Off. CLI workflows
remain single-session. See [Projects and curated memory](projects.md) for API,
source validation, compatibility and retained-history behavior.

## Incomplete generations

Agent checks provider termination metadata before accepting a response as
conversation history or executing any returned tool calls. Length, max-token,
context-window, content-filter, refusal and pause stops produce a typed
`IncompleteModelResponseError` instead of a completed turn. Summaries pass the
same gate, even when a truncated response happens to contain valid JSON.
Raw provider diagnostics remain available when enabled. A custom Model without
termination metadata retains compatibility; it owns truthful completion signaling.

## Capacity-derived profiles

`await createModelContextPolicy(model, options)` returns a budgeted policy using
provider metadata and runtime capacity. It fails if capacity is unknown. Defaults
reserve up to 4096 output tokens (bounded by the model limit and one quarter of
the window), 5% safety margin, and up to 2048 summary output tokens. Compaction
starts at 65% of the remaining input budget and targets 40%. These are Orbit
policy ratios, not claims that providers publish compaction thresholds. Options
can set contextWindow, outputReserve, safetyMargin and cancellation signal.

The book E2E worker uses this helper and saves its resolved profile in
`output/context-policy.json`. Existing applications still opt into budgeting;
existing v1 transcripts require explicit migration as described above.

## Source-derived tool observations

When a budgeted request uses a checkpoint, Orbit adds a separate untrusted JSON
view of acknowledged built-in edit/write and Bash results in the checkpoint's
canonical prefix. The summary does not produce or modify these records. Runtime
provenance binds the actual dispatched adapter, call group, Run and operation to
existing journal intent/result digests. Imported or legacy results without a
matching binding remain unrecognized; a custom tool named `edit` does not gain
built-in semantics. No second persistent observation ledger or new transcript
version is introduced.

The view preserves latest successful saves and later failed saves by path,
with source IDs and result digests. A saved-at-operation flag is not a claim
about current contents: later shell commands or external edits can change them.
Generic commands retain process exit, timeout and output truncation, with at most
1,024 characters each of stdout and stderr. Their tested revision and behavioral
coverage remain unknown. A request without an acknowledgement is not a confirmed
operation and does not authorize replay.

All projected data counts toward the prepared input budget. Up to three recent
prefix commands are included; oldest commands are omitted first when required,
with explicit counts. Required latest-save records and protected context are
never silently removed to make input fit. An infeasible mandatory projection
refuses compaction/preparation with `observation-context-exceeds-budget`.
`context.observations.prepared` diagnostics expose the deterministic view,
unknown-result and omission counts, and total estimated request tokens. Model
answers may still misinterpret the records; evaluators should inspect these
records directly. Persistent evidence is rechecked before provider invocation.

Runtime provenance digests remain in the canonical transcript and journal
validation path. Summary-model source serialization omits that opaque envelope
metadata; it still includes the original tool request/result and message IDs.
This keeps execution proofs out of the summary token budget without changing
source digests, persisted bytes, or the separately derived observation view.

### Empty and incomplete summary recovery

Summary requests include an explicit output contract: version 1, every category
array, all evidence/test item fields, and at least one supported item across the
categories. This complements provider JSON mode; it is not provider-enforced
JSON Schema and does not guarantee semantic correctness.

An empty summary or missing required fields triggers one corrective generation
for that source, using the same original evidence and deterministic validation
feedback. Invalid output is never persisted or patched with fabricated facts.
The corrective request includes no tools, is measured before dispatch, consumes
ordinary Run model-call allowance, and obeys cancellation/deadlines. Existing
output-length recovery still applies. If correction remains empty/incomplete,
Orbit tries smaller complete tool groups and halves failing multi-group batches.
A failing single group stops recovery; unchanged-history fallback and validation
cooldown retain their existing capacity checks. No agent iteration cap is added.

Unknown evidence IDs, invalid test outcomes and unsupported versions remain
invalid. `context.summary.validation-failed` diagnostics distinguish `empty`
from `missing-fields` when requesting correction. Persistent summary validation
and transcript versions are unchanged. This is a local generation/recovery fix
within the existing budgeted-compaction policy; it changes no public model API,
provider format option, authorization boundary or persistence contract.

A corrective generation retains the output allowance used by the defective response. If a source already exhausted `summaryOutput` and expanded to `outputReserve`, correction starts at `outputReserve`; it does not repeat the exhausted smaller allowance or expand beyond the reserve. The corrected prompt is re-estimated against the input budget for that allowance before invocation. Correction feedback is also retained if a correction at the initial allowance needs expansion. Failure at the reserve returns to the existing complete-group splitting path. This is a local recovery fix within the existing compaction policy; it changes no public API, provider format, persistence format, or authorization behavior.

## Smaller sources and cumulative summaries

For histories with more than eight complete groups, Orbit skips a full-source generation when the estimated marginal source exceeds twice `summaryOutput`. Initial batches use at most one eighth of the complete groups. Each multi-group candidate also checks its marginal prepared-request estimate against twice `summaryOutput`, in addition to the full input budget. The baseline has the same prior summary and allowed IDs but no new messages. This is a heuristic difference between frozen request estimates, not provider-exact source token counting. A single complete group can exceed the source target if it fits the actual input budget; tools are never split. Short histories can still use one full request to avoid unnecessary cumulative calls.

The prompt asks for a cumulative summary of about half `summaryOutput`, including source IDs, even when output expands. This is a soft generation target, not evidence truncation or a guaranteed provider limit. Orbit deterministically merges only exact duplicate items within the same category and unions their source IDs. Test items with different text, target, revision or outcome remain distinct. All other facts remain; canonical source messages and existing checkpoints are not rewritten. Only validated summaries are compacted. The next batch receives that compacted representation.

`context.summary.started` records estimated input tokens, prior-summary bytes and source/summary targets. `context.summary.validated` records item counts and UTF-8 JSON byte sizes before/after exact deduplication. These distinguish batching overhead, cumulative growth and model latency. Smaller requests can require more model calls and are not inherently faster. Semantic checks and official grading remain separate from size measurements. This is local tuning of the existing compaction policy, without public settings, persistence or safety changes; no new ADR is required. Deadlines, cancellation, model-call accounting, original source validation and atomic checkpoint activation remain unchanged.

Verified-interruption raw history retains its existing one-shot route when it fits the summary input budget; its nondispatched calls have no actual result to form a raw complete tool group. Complete-group validation occurs only when splitting is required. The shorter-source heuristic does not manufacture tool results or bypass interruption proofs.

### Repeated tool streams in summary input

Summary requests factor a `stdout` or `stderr` string only when it occurs exactly
inside one text content block and the representation saves serialized bytes. The
private `orbit-tool-output-references-v1` rendering retains the output under
`value` and replaces repeated stream fields with named `streams` references
(`contentIndex`, `start`, `length`; UTF-16 offsets). Slicing that text block
restores the stream exactly, including whitespace and Unicode. Other metadata,
errors and content blocks remain present; empty, short and unmatched streams
remain literal. This does not deduplicate different messages or infer success.

Canonical history, ordinary model requests, source IDs, source digests and saved
sessions retain the original tool result. Only the private summary serialization
changes, so this local optimization requires no new public API or persistence ADR.
Lossless reconstruction verifies the input representation, not the semantic
accuracy of the generated summary; the latter needs separate evaluation.
