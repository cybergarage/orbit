# Verified input after interrupted tool calls

Orbit can derive input for a **new explicit request** after a narrowly proven
cancellation. This is opt-in. It does not retry the old call, repair missing
outputs, resume a Graph node or change an old outcome.

## Policy and supported history

Set `interruptionPolicy: {mode: 'verified-not-dispatched', revision: 1}` on
`AgentOptions`, or in workspace/service settings. Input budgeting is independent.
The default is `{mode: 'disabled'}`. Enabled Agent-owned memory Sessions and new
Thread/CLI/Ink Sessions use transcript v3; an explicitly supplied old Session
requires migration. A model must implement `prepare`; invoke-only models are
refused before managed MCP preparation. GUI uses the same Thread/service setting,
without adding a new control or automatically migrating saved data.

```ts
import {Agent, MemorySessionLogStore} from 'orbit'

const logs = new MemorySessionLogStore()
const agent = new Agent({
  interruptionPolicy: {mode: 'verified-not-dispatched', revision: 1},
  logStore: logs,
  // Supply the application's existing model, execution policy and repository.
})
// Submit a new, intentional user request using the existing startRun/startGraphRun API.
// Inspect outcome, quiescence, recording and unresolved resources independently.
// Close Agent and its owned resources using the application's existing lifecycle.
```

The retained required journal must establish a cancelled, quiescent Run with
acknowledged recording and no cleanup errors, unknown operations or unsettled
resources. Every missing call needs an unambiguous assistant-message/call identity
within the synchronized terminal prefix, and **no operation intent**. An intent
whose operation later failed validation is still an intent. A successful read
whose output was lost is not synthesized, even beside an unexecuted write.
Reused IDs, mismatched results, unmatched intents and inconsistent Graph visits
refuse preparation. Ordinary denials retain their actual tool error response.

Core checks exact replay first. A retry of the same submitted request observes
its Run without rereading Skill, starting MCP or preparing a model. A changed
enabled policy changes submitted configuration and conflicts with the same ID.
New requests preflight history before effectful work, and recheck it before
ordinary invocation and checkpoint saving. Graph shares this path with Agent;
direct tool nodes retain their real operations and never receive invented values.

## Raw evidence and derived input

The raw transcript and original terminal remain unchanged. Provider-facing
messages retain assistant calls and add deterministic error-form responses for
only the proven missing calls. Their wording states nonexecution, cancellation,
absence of actual output and absence of permission to retry. OpenAI uses the call
ID, Anthropic a corresponding error `tool_result`, and Ollama its tool name and
error content. These are request-shape contracts, not claims about model quality.

A v3 `context_projection` revision-1 record stores raw head/digest, checkpoint
ancestry, call/message/turn identities, journal positions/digests and a derived
view digest. Core synchronizes it before consuming that view. It rereads the
bounded transcript, key and journal under the current writer ownership. Missing,
changed, torn or unsynchronizable proof refuses use. Pending evidence/save I/O
remains owned after cancellation; no failed-save fallback invokes a model.
File and ancestor identities are compared again after sync/close, including a
final journal-wide check after later file and directory acknowledgements. This
detects replacements observed within verification; it does not identify a
physical copy made before observation or prevent changes after the last check.
Failed evidence closes remain attached to the Session or journal. Managed Run
cleanup calls `Session.settleContextEvidence()` and, when supplied,
`ExecutionJournal.settleContextEvidence()` to retry them. Unconfirmed cleanup
keeps the Run incomplete and its owner retained. Custom journals that can retain
failed handles must implement this cleanup hook too; a rejected close is not
proof of release.

`SessionContextBuilder.build` rejects projection-dependent history with
`verified-context-required`. Disabling budgeting or the interruption policy does
not bypass that requirement. Existing raw message/entry accessors and Graph/Run
inspection remain available for observation without granting model-use authority.
Applications must not treat a parsed provenance record as authorization. Custom
journal implementations are trusted extensions and must implement the optional
`verifyContextEvidence(maxBytes)` contract with synchronized, complete owned
records; a detached log or host assertion is not a replacement.

A projection-aware checkpoint uses projection version 2, references retained
provenance, and hashes the original raw source. Earlier version-1 checkpoints
keep their existing validation. Summaries receive raw history serialized as
untrusted data, no tools and no Skill instructions. A deterministic interruption
notice stays outside the lossy summary and inside the ordinary request budget.
Latest user-turn and Graph-turn protection remain in force. Historical Skill
snapshots are not reactivated.

## Exclusive v2-to-v3 migration

Stop every writer/reader using the pair and every automatic restart source.
Retain external admission stop throughout migration and any response-unknown
inspection. `migrateSessionTranscriptV3(scope, file, offlineConditions, resume?)`
requires the existing registered Session/journal scope and all three offline
conditions. It does not take over an execution right or settle unknown effects.

For v1, finish the existing `migrateSessionTranscript` conversion first. The new
conversion refuses an older pending intent; resolve that migration using its own
API. Only a complete, valid v2 source can be converted. V3-capable readers still
read valid v1/v2 records, Skill snapshots and checkpoints. Old readers reject v3.
All readers of a shared pair must be upgraded together.

The new converter changes only the header and retains every following UTF-8
byte, entry position and Graph high-water boundary. It retains `.v1-backup` if
present, adds `.v2-backup`, writes a separate version-2 migration intent and
`.v3-pending`, synchronizes the replacement, renames and resynchronizes before
releasing exclusion. Journal versions remain 1 and 2 per Run.

Maintenance validates each complete journal with the runtime ordering/schema
validator, including mixed v1/v2 Runs in one Session (never mixed versions
inside a Run). It requires an acknowledged, quiescent original terminal with
no unresolved operations or cleanup errors. Later settlement cannot upgrade an
unknown or failed-storage terminal for automatic maintenance. Known cancelled,
failed and budget-exceeded outcomes remain those outcomes; migration is not a
successful retry. Unknown complete records, torn tails, absent results, missing
keys and aliased journal artifacts require offline review without mutation.
For bound Graph Runs, the read-only Graph inspector checks the preserved
transcript prefix, message references and synchronized positions; a ready Run
also requires its original terminal phase within its terminal high-water mark.
Old Skill/checkpoint validation still runs on the complete source and target.
The converter neither omits the Graph journal nor creates replacement evidence.

After an interruption, use `inspectTranscriptMigration(scope)`, the registered
scope's lock inspection, and external process checks. With a valid retained
guard/intent, call the new converter with `resume: true` under the same offline
conditions. If no migration artifact remains, it inspects/resynchronizes a
completed v3 file and returns `already-migrated`. A guard that was created but
never fully written, a partial/invalid intent, or conflicting backup/replacement
requires exclusive manual inspection; the API preserves artifacts and refuses
blind removal. A v3 writer also refuses an incomplete JSON tail instead of
silently rewriting evidence. Read-only decoding reports that tail separately.
A missing success response does not permit external restart merely because
internal file checks look ready. Recheck and synchronize exclusively first.

No API in this feature deletes backups. Keep evidence for as long as any view or
checkpoint depends on it. Existing Session deletion and maintenance coordinate
with live ownership and remove the associated journal using their established
contracts. Removing a needed journal separately makes continuation unavailable.

## Bounds and validation scope

Revision-1 records have a fixed 4 MiB JSON-line format limit. Current producer
limits are 128 inserted calls, 1 MiB projection metadata, and 64 MiB cumulative
raw transcript/journal evidence per verification. Exceeding them refuses
preparation; it never verifies a prefix only. These starting values are not
measured optima. Format decoding uses the fixed bound independently of producer
limits, so lower future product limits need not invalidate historical records.

Fixed-double tests cover request serialization, owned refusal/cancellation,
Agent/Graph continuation with budgets on/off, triggered compaction and exclusive
migration fault boundaries. Consult the [ADR's implementation evidence](adr/2026-09-14-verified-interrupted-tool-context.md)
for exact execution results and remaining checks. Physical storage failure,
real provider acceptance/quality and application integration require separately
specified environments. This core feature does not change the book's chapter-19
admission-stop policy or provide a production recovery UI.
