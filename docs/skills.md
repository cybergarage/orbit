# Explicit Skill selection

A Skill supplies reusable instructions for one Run. It does not grant tool
permission, execute a script, expand linked resources or change the model.
The catalog stays outside model input. Only explicitly selected instructions
are loaded into ordinary answering/tool iterations.

## List and select

Place a file at `.orbit/skills/test-review/SKILL.md` in a marked workspace:

```markdown
---
name: test-review
description: Review the target test and distinguish observed results from guesses.
---
Identify the target test, inspect its assertions and explain what a passing result
would establish. Use ordinary tools and obtain required operation confirmation.
Report the command and its actual outcome; do not infer success from a timeout.
```

Run `orbit skills --json` to inspect IDs, SHA-256 digests, source paths and
issues. `orbit exec --skill ID@DIGEST "Inspect the target test"` applies that
exact choice. Repeat `--skill` to preserve an explicit order. Names mentioned in
a prompt do not select anything. Use the actual ID and digest from the list.

CLI, Ink and GUI default to the nearest ancestor containing `.orbit`, with
`.orbit/skills` as its only root. No marked workspace means no default catalog.
Repeat `--skill-root ID=DIRECTORY` to replace that default with explicit roots;
relative directories resolve from the launch directory. Root IDs are unique
ASCII letters, digits, underscores or hyphens (1–128 characters).
The library has no implicit roots or home-directory search.

Ink uses `/skills`, `/skill ID@DIGEST` and `/skill clear`. Local slash commands
leave pending selections intact. Successful managed admission consumes them;
a rejected admission retains them. An admitted Run whose loading fails requires
explicit reselection and a new request ID. Ctrl+C requests cancellation during
listing or execution; it does not prove pending I/O has closed.

The GUI's Skills panel shows server-configured candidates and pending choices.
Refresh the catalog after changing a file, clear outdated choices and explicitly
select the new digest. Current/finished metadata comes from the Run snapshot.
A reconnect queries authoritative state without resubmitting a new Run. The
explicit saved-source action loads historical snapshots; ordinary events contain
IDs/digests and a snapshot reference, not the instruction bodies. Pending choices
are browser state; a full page reload clears unsent selections.

## Catalog validation and initial limits

Only immediate child directories containing `SKILL.md` are inspected. Candidate
symlinks and hard links are rejected. Canonical-root aliases conflict even if
they have different configured IDs. Same-name Skills in different roots remain
distinct; their names do not establish precedence.

Frontmatter uses pinned `yaml` 2.9.1. Require exactly string `name` and
`description`, a matching directory name and nonempty instructions. Names use
lowercase ASCII letters/digits with single internal hyphens (1–64 characters).
Descriptions allow up to 1,024 Unicode code points. Quoted and block scalars,
BOM and CRLF are supported. Duplicate keys, anchors, aliases, explicit tags,
unknown keys, nested metadata and invalid UTF-8 are rejected. The closing `---`
ends frontmatter; subsequent text is the instruction body, not another metadata
document. The original BOM and line endings remain in the snapshot.

| Limit | Initial product value |
| --- | ---: |
| Roots | 8 |
| Inspected directory entries, including invalid candidates | 4,096 |
| Candidate directories | 128 |
| Source bytes per file | 65,536 |
| Total listing bytes, including failed reads and overflow probes | 2,097,152 |
| Selected Skills per Run | 4 |

These are bounded starting values, not tuned quality or latency optima.
`complete: false` and `issues` explain where discovery stopped, including when a
configured root is missing. Reaching a
ceiling can conservatively stop without checking for another entry/EOF. Listed
IDs are usable in a partial result; filesystem enumeration does not promise the
same partial subset each time. Empty or missing roots produce diagnostics.

Activation rechecks the listing's root, directory and regular-file observations,
then reopens selected files with a bounded asynchronous read. A changed digest,
root rebinding, deletion or detected replacement requires a refreshed listing
and explicit selection, even if replacement bytes are identical. Source IDs
encode paths and configured root identity; they are not signed provenance or
protection against all hostile filesystem races. Once resolved, frozen bytes
remain in use for that Run even if files change later.

## Library and application APIs

```ts
import {Agent, Message, MessageType, SkillCatalog} from '@cybergarage/orbit'

const catalog = new SkillCatalog([{id: 'project', directory: '/workspace/.orbit/skills'}])
const listing = await catalog.list(abortSignal)
// Present metadata; obtain an explicit user selection of candidate ID + digest.
const skills = selectedCandidates.map(({id, digest}) => ({id, digest}))
const agent = new Agent({cwd: '/workspace', skillCatalog: catalog})
try {
  const handle = await agent.startRun(
    [new Message(MessageType.User, {content: 'Review the target test.'})],
    {requestId, skills},
  )
  const result = await handle.finished
  // Inspect outcome, recording, quiescence and unresolved work independently.
} finally {
  await agent.close()
  await catalog.settle()
}
```

`SkillRoot`, `SkillLimits`, `SkillListing`, `SkillSelection`, `SkillSnapshot` and
`SessionSkillEntry` are exported with `SkillCatalog`. An optional injected
`SkillIO` supports controlled filesystem testing. `catalog.settle()` waits for
owned work and retries failed descriptor closes; unresolved cleanup remains a
failure. Callers own cancellation of read-only listings and must await cleanup.
Agent uses `catalog.createReader()` to copy listed observations into a separate
Run I/O owner, so unrelated catalog queries cannot delay that Run’s cleanup.
A Run tracks resolution and snapshot synchronization, including late opens.
A deadline may return `incomplete` while I/O remains owned and quarantined.

Configure `OrbitApplicationService` with the same `skillCatalog`. Call
`listSkills(signal)` and then `startRun(threadId, content, {requestId, skills})`.
The existing request-ID string overload remains valid. ThreadManager and Agent
compare ordered selections and catalog configuration before cached returns;
changed selections under the same request ID conflict. Exact replay returns the
original Run without reopening a file, including persisted recovery. To retry a
failed admitted Run, use a new request ID and explicit selection.

`new Skill({content | file})` retains its old permissive parser. It neither
participates in discovery nor automatically becomes a valid catalog choice.
Repair invalid metadata for catalog use without relying on the legacy parser
to validate it.

## Input lifetime and persistence

Agent adds a user-level, source-labelled prefix after standing instructions and
before conversation input. It does not mutate standing messages or append the
body as a conversation message. Budgeted preparation protects its full encoded
body/wrapper and refuses overflow. The disabled-budget path applies the same
prefix without a token-fit guarantee. A dedicated compaction summary receives
its own instruction and eligible historical conversation, without active Skill
bodies or tools. The next Run and a resumed Session have no active selection by
default. Past model answers may still reflect earlier instructions; this does
not promise semantic forgetting.

Persistent selections require transcript v2 or v3. Agent appends turn context, start
and user input, resolves all choices, saves one `skill_context` revision 1 and
synchronizes it before journal readiness and the first model call. The record
contains ordered exact UTF-8 sources, digests, metadata, derived bodies and
projection revision `yaml-2.9.1-body-v1`. Reopen validates derivation, identity,
ordering and the immutable revision. A snapshot is evidence of resolved input,
not of successful execution or model compliance. Transcript and journal are
separate acknowledgements; a saved snapshot alone never authorizes model use.

Revision 1 permits at most four snapshots and has a fixed 4 MiB UTF-8 JSON-line
ceiling, checked before decode and append. These format bounds are independent
of current product limits: lowering those limits does not reject earlier valid
snapshots. JSON escaping and duplicated derived bodies count toward this limit.
It is not a whole-Session memory bound.
`session.getSkillContexts()` returns copies. Application `skillHistory(sessionId)`
and authenticated `GET /api/sessions/:sessionId/skills` provide explicit details.
Session deletion removes these records with the transcript under the existing
minimal deletion-journal contract.

## Reader deployment and migration

Stop old writers/readers and automatic restart sources before enabling Skill
selection. Migrate v1 through the existing [exclusive migration](context-compaction.md)
when needed; do not silently upgrade. Deploy compatible readers and writers
together. Old v2 readers reject a complete unknown `skill_context` record, even
without a final newline, but their existing torn-final-JSON recovery can remove
a malformed final line. That exception is not a universal downgrade barrier.
Invalid complete records must not be silently rewritten. Storage registration,
external exclusion, owner leases and synchronization conditions remain unchanged.
This feature does not authorize deletion of `.v1-backup` files.

See [Managed Execution](execution.md), [Sessions](session.md) and the
[accepted decision](adr/2026-09-09-run-scoped-skill-selection.md).

### Use with verified interrupted context

Transcript v3 also accepts the existing revision-1 Skill records with unchanged identity, content, bounds and ordering checks. [Verified interrupted context](interrupted-context.md) never reselects historical snapshots and never inserts current Skills into summary-only requests. Upgrade all readers together before the separate v3 migration.
