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
the same model window and uses `summaryOutput` as its output cap.

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
