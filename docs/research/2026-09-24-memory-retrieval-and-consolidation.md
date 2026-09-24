---
status: current
investigation-date: 2026-09-24
orbit-commit: 0146f1d424d4b955a4de1865a604a68db158913c
related-adrs:
  - docs/adr/2026-09-22-project-memory-context.md
superseded-by: []
---

# Memory Retrieval and Consolidation

## Purpose and result

Revisit how a Project memory becomes useful to a subsequent task: creation,
retrieval, consolidation, and bounded model input. This supplements the
[initial investigation](2026-09-22-projects-and-cross-session-memory.md); it does
not replace its historical findings or approve implementation.

The immediate gap is task-directed recall. Current Orbit selects explicit IDs
and recent entries; it does not search for relevant older knowledge. Prioritize
an experiment with Project-scoped lexical search and source expansion. Evaluate
reviewable extraction candidates next. Autonomous consolidation and generated
memory links are later options, not justified replacements for curation by this
investigation alone.

## Baseline and questions

The inspected local commit is above. GitHub's main endpoint returned
`abc358ba69a6b9de24d2c7a16a6bd38b28aac00c`, an ancestor of local HEAD. Project and
memory work is locally committed; upstream publication is not established.
Only the pre-existing untracked `.claude/` directory was present in Orbit.

Questions:

- How do systems choose between always-included facts and retrieved evidence?
- Which component generates text, selects changes, and validates them?
- Which additions address Orbit's actual limitations without losing provenance?

`src/core/projects/memory-context.ts::selectProjectMemory` accepts no query.
It orders selected IDs, then descending update time, then ID. It tests the full
rendered memory envelope against a maximum of 2,048 tokens and 16 entries.
Unselected oversized entries are skipped; selected ineligible entries fail
preparation. Bodies are neither summarized nor sliced.
`memory-service.ts::prepare`, `saveExcerpt`, and source validation preserve
membership, provenance, and generation checks. Read
`test/core/projects/memory.test.ts` for whole-entry selection, frozen captures,
source edits/deletion, and repeated model input. Tests were read, not rerun.

## Pinned implementation evidence

Nineteen downloaded blobs matched the SHA-1 object IDs in their commit trees.
The local acquisition ledger is
`/private/tmp/orbit-memory-methods-20260924/verified.json`; the reproducible source
identities and relevant paths are recorded below. No external suite was run.

| System and commit                                                                                                                                     | Read path and write path                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Codex](https://github.com/openai/codex/tree/fdd89e78ac33f02e65dabe60567cdfeba2e954d4), `fdd89e78ac33f02e65dabe60567cdfeba2e954d4`                    | `codex-rs/memories/write/src/phase1.rs` extracts structured per-rollout output and redacts serialized source before upload. `phase2.rs` claims a global job and consolidates selected outputs. The V1/V2 templates under `memories/write/templates/memories/` differ: V1 has raw-memory and rollout summaries plus a detailed handbook; V2 distills rollout summaries into `memory_summary.md`. `codex-rs/ext/memories/src/prompts.rs` truncates the summary and renders developer instructions; the read templates describe selective detailed lookup. Prompt criteria do not guarantee generation accuracy. |
| [HermesAgent](https://github.com/NousResearch/hermes-agent/tree/92dd3321929a915479ade608591d40de93965c7b), `92dd3321929a915479ade608591d40de93965c7b` | `tools/memory_tool.py` and `memory_tool_store.py` expose bounded add/replace/remove/batch updates to profile-scoped files with a frozen load-time prompt snapshot. On overflow the store returns entries and asks the caller to consolidate; it does not itself summarize. `tools/session_search_tool.py` discovers sessions through FTS and returns original messages, anchored windows, or bounded head/tail reads without LLM calls.                                                                                                                                                                       |
| [OpenClaw](https://github.com/openclaw/openclaw/tree/6b13f55aaf7151e3edfb33ddafeac69abb0b38d2), `6b13f55aaf7151e3edfb33ddafeac69abb0b38d2`            | `extensions/memory-core/src/flush-plan.ts` requests daily-note preservation before compaction. `dreaming-consolidation.ts` asks the model for added/merged/superseded operations, while the host constructs result text from candidate evidence. Validation checks prior entries, project groups, replacement lineage, loss fraction, and aggregate size. `dreaming-consolidation-projects.test.ts` was read. `memory/hybrid.ts` merges lexical/vector candidates with source paths and lines. `memory-read-tool.ts` separates failed reads from absence.                                                     |

Pi remains outside the shared-memory comparison. The prior investigation at
`95fbc04997eaee961eb673fa7923e9220609ebd5` inspected standard session and resource
loading, not all extensions. Those paths establish cwd-based conversations and
shared instructions, not an automatic extraction/consolidation pipeline. This
pass does not widen that absence claim.

OpenClaw's rejected consolidation returns null. The caller's append fallback was
not traced in this pass; a log message alone is not evidence of a completed
fallback. Project grouping is not equivalent to retrieval authorization.

## Publication evidence and limits

This is a mechanism comparison, not a benchmark ranking. The paper code was not
pinned or executed. Version-specific HTML was inspected for the relevant methods;
MemGPT and A-Mem were also checked through official PDFs. The Generative Agents
PDF exceeded the web reader's size limit, so its same-version HTML was used.
No quantitative result, significance claim, or performance superiority is adopted;
seeds, complete run counts, and lifecycle costs were not audited.

| Exact artifact                                                                                                                                                    | Contribution and method                                                                                                                        | Evaluation boundary                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Park et al., _Generative Agents: Interactive Simulacra of Human Behavior_, UIST 2023, [arXiv:2304.03442v2](https://arxiv.org/html/2304.03442v2), sections 4.1–4.2 | Retrieval combines relevance, recency of access, and importance; reflection creates higher-level inferences with links to supporting memories. | Human-behavior simulation and ablations of the agent architecture, not coding correctness or Project isolation. Reported retrieval mistakes and embellished recollections argue against treating reflection as verified fact. |
| Packer et al., _MemGPT: Towards LLMs as Operating Systems_, [arXiv:2310.08560v2](https://arxiv.org/pdf/2310.08560v2), section 2, revised 2024                     | Separates in-context working information and external recall/archive storage; model tool calls move information and can chain retrieval.       | Multi-Session Chat-derived recall, document QA, and key-value retrieval. Benefits depend on retrieval and the underlying model. External storage does not eliminate finite input or inference cost.                           |
| Xu et al., _A-Mem: Agentic Memory for LLM Agents_, [arXiv:2502.12110v11](https://arxiv.org/pdf/2502.12110v11), section 3                                          | Constructs notes with contextual metadata, retrieves related notes, generates links, and updates neighboring metadata.                         | Long-conversation QA including LoCoMo; this does not establish source integrity, deletion propagation, or safe autonomous mutation for Orbit.                                                                                 |

These works motivate distinct experiments. They do not establish that the
inspected OSS adopted the papers directly. Extraction reduces and interprets
source material; indexing and retrieval select evidence; link generation may
increase stored metadata. They are not interchangeable forms of compression.

## Non-binding implications for Orbit

1. **Project-scoped retrieval experiment.** Reuse membership/source eligibility,
   entry revisions, and Run snapshots. Add a query/ranking interface and an
   inspectable result with source references and exclusion reasons. Apply scope
   filters before ranking and verify again before capture. Compare lexical
   ranking with the current recency baseline before adding embeddings.
2. **Reviewable extraction candidates.** Reuse registered source reads and the
   explicit save/edit path. A model proposes text plus exact source references;
   a user reviews it before promotion. Candidate storage, cancellation, budgets,
   and regeneration exclusions require new contracts. Do not silently turn the
   current explicit write API into a model-owned write tool.
3. **Consolidation and links.** Investigate only after recall evidence exists.
   OpenClaw's separation of model-selected operations from host-produced text is
   a useful alternative to unrestricted rewrite. Multi-source derivation,
   conflicting facts, supersession, retired-source invalidation, and rollback
   require designs beyond the current edited-entry flag.

A future ADR is required for new public APIs, indexing persistence, or automatic
writes. The existing accepted ADR explicitly excludes automatic extraction,
embeddings, and background consolidation. No code, accepted decision, or
maintained feature contract changes in this research pass.

## Proposed evaluation

Use tasks where the relevant decision is old, lexical wording changes, similar
facts belong to different Projects, a source is corrected/deleted, and a retired
fact would otherwise be extracted again. Measure evidence recall at a fixed
input budget, irrelevant tokens, answer support, cross-Project exposure, stale
fact use, latency, and model cost. Keep a separate held-out set when tuning
ranking or extraction prompts. Deterministic tests establish mechanics, while
model-based trials must evaluate memory quality. Neither was executed here.
