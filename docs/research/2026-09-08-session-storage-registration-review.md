---
status: current
investigation-date: 2026-09-08
orbit-commit: 672c3668e9c0d1922e9a8d36f217ee89515ac558
related-adrs:
  - docs/adr/2026-09-08-session-storage-registration-guard.md
  - docs/adr/2026-09-08-session-writer-recovery-guard.md
superseded-by: []
---

# Session Storage Registration Review

## Purpose

Review the proposed guard protocol against its completion point, old-data
conversion, identity guarantees and the existing public ownership paths. This
note supersedes the [initial investigation](2026-09-08-session-storage-registration.md)
as current decision input; its source ledger and negative experiments remain
historical evidence. The guard recommendation is conditional, not approved.

## Baseline and Evidence

On 2026-09-08, inspected Orbit `672c3668e9c0d1922e9a8d36f217ee89515ac558`.
The working tree was clean, with no src/test/dependency changes after the proposal.
Public main remained `80130cf194e477f136eefaa5b7cd2a2374dff198`.
Re-read coordination.ts (binding, initialization, scope validation, WriterClaim
release, isSessionLocked and recoverSessionWriter), recorder.ts (isOpen),
writer-lease.ts (consumeWriterLease), repository.ts, deletion-service.ts and the
unchanged registration-interruption.mjs fixture. Paths are under
`src/core/session/`, except the diagnostic under `test/core/execution/fixtures/`.
The companion evidence is A06, A09 and A11 at publication repository commit
`f29460a6d9f65daa1f8b270e9934882cf10e0e63`.

Fresh macOS arm64 / Node 26.5.0 headers and build passed. The diagnostic again
returned exit 1: death checkpoint 73 and injected fsync-error checkpoint 74 both
reported writableAdmission accepted and offlineResume succeeded. No timeout was
accepted. The existing-file resync omission remains a source finding, not a
successful durability experiment. No implementation or test correction was made.
The full macOS npm test run passed 397 tests, with 0 lint errors / 12 warnings;
format/lint produced no source differences. The independent failing probe is
not included in that aggregate.
The previous Linux reproduction is retained; this document review does not claim
a new Linux, Windows, UI, deployment or physical-storage experiment.

## Findings and Recommended Corrections

| Review finding                                                | Evidence / consequence                                                                                                                                                    | Non-binding correction                                                                                                                                                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Blanket rejection assertions contradict the completion matrix | The proposal permits ready after final unlink and before the first guard on unchanged v2, but its validation list says to assert rejected acquisition at every checkpoint | Assert the exact expected state for each stage, and separately assert that the external gate remains closed after an uncertain outcome                                                                            |
| Ready is not acknowledgement                                  | Final guard unlink precedes its directory sync; the parent says refusal lasts until the procedure completes                                                               | Preserve a three-part distinction: prerequisites durable, logical readiness, initializer acknowledgement. Require explicit author approval of this interpretation, not a claim that the parent already defines it |
| Repair can accidentally depend on unavailable writer scope    | sessionScope and recoverSessionWriter validate registration; release/retry also traverse coordinationPaths                                                                | Add a scope-free, non-authorizing offline inspection/resume path before obtaining Session scope. Do not use a fake or bypassed scope                                                                              |
| Stable pair ID cannot revoke scopes on every resync           | Proposed v2 retains pair ID and root paths; current scopes are immutable identity objects, while owner tokens/leases provide write authority                              | Require live revalidation; do not claim a new generation or blanket scope revocation on an unchanged-pair resync without encoding one                                                                             |
| Same-path copied metadata is not physical root authentication | realpath identifies paths; dev/inode observations are attempt-local, and pair IDs can be copied                                                                           | Limit rejection claims to observable alias/conflict/replacement checks. Whole-pair copy/restore at the same paths needs external maintenance controls, not a fabricated detection guarantee                       |

### Completion compatibility

The accepted recovery ADR requires refusal after a registration crash until the
procedure completes. It does not explicitly distinguish last namespace mutation,
its directory sync and delivery of a return value. The initial proposal exposes
that ambiguity rather than resolving it by evidence. Under the narrower safety
interpretation (no usable pair before binding prerequisites are synchronized),
last-guard removal can be the logical completion point. After a final sync error,
internal admission may see ready even though the initializer did not acknowledge.
The external gate still remains closed until exclusive verification/resync.

If the accepted sentence means refusal after **every** unsuccessful initializer
including this last interval, the proposed ordinary-file protocol does not meet
it. This must be recorded as a conditional compatibility issue. Adding another
ready/acknowledged file moves the same publication interval; a manifest does not
make response delivery atomic with other processes' admission. A separately
controlled admission authority and explicit operator handoff are alternatives
for a stronger condition and require additional design, lifecycle and availability
costs. Such a service is not part of this recommendation or today's implementation.

Recommend explicit author approval of logical completion after durable binding
prerequisites, with external shutdown for uncertain acknowledgement. Do not
infer this choice merely from the earlier acceptance. Until the author decides,
the new ADR remains proposed and the accepted reasons remain unchanged.

### Registration repair and owned resources

A dedicated offline inspection/resume operation must accept the configured S/J
pair and operator conditions without first demanding a writable SessionScope.
It reads retained metadata without granting writer authority. Strict normal
initialization rejects pending/unknown artifacts; explicit evidence-based resume
is the sole path for reconstructing a known partial attempt. A malformed guard
is never an ordinary free slot. Record exactly which surviving binding/guard and
operator configuration establish the pair and attempt; ambiguous evidence blocks.

If pending registration is discovered while a local writer/cleanup is alive,
that violates maintenance prerequisites. Keep resources quarantined. Do not
invoke initialization in a loop that waits for scope-based cleanup which itself
requires registration to be ready. Stop the affected application and verify
termination under the external gate, then inspect dead-owner and journal evidence
from a separate maintenance process. Unknown ownership still blocks automated
recovery. Restoring registration does not reconcile an incomplete run or delete
its Session guard, owner or minimal deletion record.

### Identity and repeated registration

Pair ID plus canonical S/J paths express logical one-to-one identity. Guard attempt
IDs identify maintenance, not a new binding generation. A no-data-change resync
may retain those identifiers. Scope objects alone never constitute a write lease:
revalidate v2 identity, both guards and live owner at the relevant public boundaries.
Old v1 or different-pair scope fails; an unchanged-pair scope is not promised
permanently revoked merely because resynchronization occurred. An epoch would
be additional persistent state, not an implicit property of a UUID.

Alias normalization, wrong-role/partner refusal and within-attempt descriptor/path
identity checks remain necessary. They do not detect an entire pair restored with
copied metadata to the same canonical names between stopped processes. Arbitrary
root replacement is unsupported and must remain behind the external gate pending
reviewed migration. If automatic detection of that replacement is required,
consider storage-specific identity or a separately retained registry in later
research; do not silently extend the current v2 claim.

### Ordering and alternatives retained

Retain the sequence: sync newly created ancestry, sync S and J guards, sync or
convert each existing/new binding, resync both final files and affected directories,
finish permitted legacy cleanup, remove/sync J guard, remove/sync S guard. Repeated
registration cannot skip existing file fsync. Partial removal recovery restores
both durable guards before resync. Unsupported file/directory sync refuses.

For the manifest option, retain one Session-root authority with immutable
prerequisites in both roots and journal-side discovery; invalidate old readiness
durably before changing dependencies. No cross-filesystem atomic rename or pair
of independent ready writes is assumed. Its additional generation and reclamation
rules offer no present requirement that outweighs the guard option's smaller
state model. The comparison supports a recommendation, not proof of either remedy.

## External Implementation Research

Re-read the same pinned source excerpts on 2026-09-08:
Codex `5adb68a49933ae446bf11935662c83dba55a0804`,
`codex-rs/rollout/src/compression.rs`, synchronizes temporary output before
publication. Pi `b79e4cc834970cca69daebffab7df1da7d1e52c4`,
`packages/coding-agent/src/core/session-manager.ts`, uses exclusive first write
and append without an explicit file fsync in the inspected methods. The initial
research's OS maintenance-lock comparison and primary-document references are
reused, not new runtime evidence. Neither source establishes the proposed Orbit
completion semantics or same-path replacement detection. Their pinned links and
comparison limits remain in the original ledger.

## Validation Conditions and Remaining Questions

Add stage-specific expectations, scope-free offline resume, no repair writes in
read-only status checks, and retention of cleanup when registration becomes
unexpectedly pending. Validate initial/v1/repeated-v2 paths, partial files and guards,
rename/unlink lost acknowledgements and crashes during evidence-based resume.
Check no new namespace generation is claimed without encoding/testing it. Exercise
observable root replacements separately from unsupported whole-pair restore.
Do not mark timeouts, blanket rejection or API success as evidence of the wrong
property.

Author choices remain format/outage costs, the exact completion interpretation,
and offline repair/synchronization costs within the stated identity scope.
The four accepted / partial ADRs retain their unverified Windows, deployment,
physical-storage and representative workload conditions. Everything's managed
schema refusal remains separate. Limits remain initial profiles, not measured
optima. No acceptance, implementation, test correction or book chapter production
is authorized by this review.

## References

- [Initial registration investigation and pinned external sources](2026-09-08-session-storage-registration.md)
- [Registration proposal](../adr/2026-09-08-session-storage-registration-guard.md)
- [Accepted recovery decision and evidence](../adr/2026-09-08-session-writer-recovery-guard.md)
