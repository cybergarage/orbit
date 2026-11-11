# X sharing draft: interim compaction evaluation

Status: draft for manual posting; not published. Source: [combined interim report](2026-11-11-cloud-compaction-interim.md), [PR #33](https://github.com/cybergarage/orbit/pull/33).

## Post text

```text
Orbit compaction, tested with local + cloud LLMs: EoCC compacted and continued to a task pass, but no advantage over suffix is established. SAC recap overhead is a concern. Small sample; interim results only.

https://github.com/cybergarage/orbit/pull/33
```

## Suggested image alt text

Orbit interim compaction results. Local ornith-1.5:9b: one task per suite with three seeds. Terminal-Bench passes: suffix 1/3, EoCC 1/3, SAC 1/3. SWE-bench passes: suffix 1/3, EoCC 0/3, SAC 0/3. Cloud Opus 4.6: two complete tasks, 64-call limit including summaries. FHA, suffix and EoCC each passed 2/2; SAC passed 0/2. Their respective two-task list costs were $2.45, $2.02, $2.30 and $5.25, not invoice amounts. GPT-4o passed 0/2 for each method. EoCC committed a reset and continued to a native task pass on Opus. Shorter context does not guarantee lower cost. Different tasks and settings must not be pooled; this small sample establishes no general superiority.

## Sharing notes

- Use the corrected four-column local-results table (Benchmark, Suffix, EoCC, SAC).
- Counts describe the reported tasks and repetitions, not benchmark-wide success rates.
- The cloud image table covers only the two complete task blocks. It does not show all observed calibration spend or prior experiments.
- Sharing this report does not authorize additional paid evaluation. Evaluation remains stopped.
