# Internal formats

Before 1.0, extend current structures additively with explicit validation and safe
missing-field defaults. New data need not be readable by older Orbit code. A format
identifier is not a release counter: do not increment it for optional fields.
Unknown fields should survive updates where their meaning is independent of the
validated fields. Never infer authorization, approval, completion or success from
missing evidence.

## Inventory and disposition

This inventory was checked at `4a36fd5606a9d3a0a07d18a1d746d1a41ee44ed3`.

| Family                                                                                                              | Disposition                                                           | Reason                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Archive, model-selection, title sidecars                                                                            | Remove mandatory numeric tag and emission; accept optional fixed `1`  | One current structure; preserve extensions and validate identity and required fields.                                                                                                                                                                                                                                |
| Title revisions, operation IDs; GUI request generations                                                             | Retain                                                                | Concurrency, idempotency and stale-result ordering, not schema versions.                                                                                                                                                                                                                                             |
| Transcript v1/v2/v3 and offline migrations                                                                          | Deferred, destructive boundary                                        | `SESSION_FORMAT_VERSION` is still 1; v2 enables compaction and v3 verified projections. Removing v1/v2 readers would reject ordinary current saved conversations. Byte-preserving migration and recovery evidence must remain available until an explicit compatibility cutoff is chosen.                            |
| Journal v1/v2/v3, graph inspection and interrupted context                                                          | Deferred, destructive boundary                                        | Historical runs coexist. v2 graph evidence and v3 mandatory project-context acknowledgement affect dispatch and unknown outcomes. Relabeling old runs would invent evidence.                                                                                                                                         |
| Storage bindings v1/v2, registration attempts; ownership/deletion/recovery markers                                  | Retain pending coordinated design                                     | Pair identity, incomplete registration and exclusive ownership protect filesystem authority. Removing legacy binding interpretation can strand registered stores.                                                                                                                                                    |
| SQLite project catalog user_version 0/1/2                                                                           | Deferred, destructive boundary                                        | v1 lacks current catalog additions; removing its upgrade makes existing project membership inaccessible. Empty database initialization is distinct from accepting an unversioned nonempty database.                                                                                                                  |
| Log records and opaque pagination cursor                                                                            | Shared structural reader; retain current writes and fixed identifiers | Shared required validation projects historical flat records in memory; a historical tag resolves extension collisions, and damaged current records reject. Unknown extensions and saved bytes survive. Cursor positions remain unchanged.                                                                            |
| Scheduled-work state and GUI task payload `1`                                                                       | Retain pending dedicated validation review                            | Persisted retries, claims, permissions and unknown occurrence results must survive; do not combine with the separately in-progress EventStore/timer work.                                                                                                                                                            |
| Authorization snapshots, budget continuation, observation provenance, project context, skills, evaluation artifacts | Retain fixed identifiers                                              | Evidence and contract identifiers protect authority, provenance, immutable digests and typed interpretation. Additive evolution must preserve their validation and unknown states.                                                                                                                                   |
| Context-summary `1`, algorithm/schema IDs and literal tool-output encodings                                         | Retain fixed identifiers                                              | Differentiate evidence-bearing summary and escaped output contracts; never treat missing test outcome as passed.                                                                                                                                                                                                     |
| Diagnostic reports and runtime metadata                                                                             | Retain fixed identifiers                                              | Exported consumer contracts; no alternate historical implementation to remove in this change.                                                                                                                                                                                                                        |
| Workflow adapter/projector id and version                                                                           | Retain semantic implementation identity                               | Ordered adapter id/version pairs enter the sealed candidate digest (`src/core/selection/validation.ts`, `src/core/processor/graph-definition.ts`). A changed closure must receive an honest new identity; removing this without replacement would collapse the trust contract. This is not a storage schema counter. |
| Product/package, plugin and dependency versions; MCP, provider headers and native bridge protocol                   | Retain                                                                | Releases or external interoperability contracts, outside internal schema cleanup.                                                                                                                                                                                                                                    |

## Current sidecar contract

Archive, saved model selection and title records use their current required fields
without a mandatory numeric tag. Existing `version: 1` is accepted, but other
explicit tags are rejected. Missing metadata means active archive state, original
conversation model and title revision zero respectively; malformed present records
are errors. Unknown top-level fields survive updates, including nested JSON values.
Saved model selection extensions also survive, while mutation inputs remain strict.
Updates that exceed 4 KiB fail before replacing the original record.

The non-log legacy readers above are deliberately unchanged. Their removal needs
an explicit decision about access to existing conversations, projects and history;
this change performs no reset, conversion or user-data migration. See the
[decision](adr/2026-11-14-additive-session-metadata.md) for rationale.

## Backward-compatible alternatives

The [structural log reader](adr/2026-11-14-structural-log-reading.md) implements
common validation and a read-only historical projection. A historical tag remains
necessary to disambiguate legacy extensions whose names overlap current fields;
collisions are preserved under `fields.historicalRecord`. Current writes remain
unchanged. This replaces numbered validator dispatch without removing access to
old partitions or introducing a data migration.

Transcript and checkpoint structures alone do not prove that interrupted calls
were never dispatched. Identical ordinary entries can occur before and after a
format's stronger evidence requirements; missing projection acknowledgement cannot
be interpreted as nondispatch. Keep explicit format/evidence gates and existing
opt-in offline migrations until a capability-based contract can represent those
guarantees. Automatically changing headers would not manufacture the missing proof.

Journal graph and project acknowledgements similarly encode ordering requirements.
Inferring a weaker format whenever an acknowledgement is missing could accept a
corrupt current run. Common low-level parsing is possible; removing the semantic
admission gates is incompatible with conservative recovery.

SQLite already migrates v1 to v2 transactionally by adding automation/extraction
tables while preserving catalog rows. Keep that backward-compatible upgrade.
Structural table discovery could replace numeric dispatch in a separate change,
but must check partial/corrupt schemas, constraints and indexes rather than merely
testing table existence. No user catalog is opened or migrated by this review.

Retain storage pair IDs and ownership markers: unlike descriptive log extensions,
unknown or missing authority cannot receive permissive defaults. None of these
alternatives requires deleting or resetting user data. Further consolidation is
possible, but cannot safely infer historical execution guarantees from absent data.
