# Publication Analysis

Use this reference when an Orbit research note analyzes one or more academic
publications. The goal is a reproducible technical comparison, not a literature
summary based on abstracts.

## Build an evidence ledger

Before drafting, record for each work:

| Field               | Required evidence                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| Identity            | title, authors, venue, year, persistent paper identifier, official URL                               |
| Exact artifact      | publication version or revision and, when practical, the official PDF SHA-256                        |
| Problem             | the problem the paper explicitly formulates                                                          |
| Claimed novelty     | the authors' contribution claims, separated from the investigator's assessment                       |
| Architecture        | execution units, state, data flow, control flow, optimizer, evaluator, and artifact boundaries       |
| Optimization target | prompts, models, tools, nodes, edges, topology, code, memory, or combinations                        |
| Evaluation setup    | datasets, splits, sample counts, models, prompts, seeds, run counts, baselines, metrics, and budgets |
| Results             | exact table values, variance or uncertainty, costs, ablations, negative results, and reported scope  |
| Limits              | missing details, threats to validity, untested production properties, and future work                |
| Source code         | pinned revision and inspected files, or an explicit statement that code was not inspected            |

Use the official PDF rather than relying on the abstract or repository README
for algorithms and experimental results. If local extraction helps, download to
a temporary directory, keep the PDF out of the repository, and use tools such as
`pdfinfo`, `pdftotext -layout`, and `shasum -a 256`. If those tools are not
available, use an equivalent PDF reader and record the exact source artifact.

## Analyze each publication

For each work, cover these concerns when the source supports them:

1. **Publication and problem:** identify the work and the concrete limitation it
   addresses.
2. **Claimed novelty:** separate a new algorithm, representation, systems
   integration, and evaluation contribution. Do not credit an integration
   framework with inventing every algorithm it includes.
3. **Architecture:** explain the runtime graph or workflow separately from the
   optimization/search structure. A search-tree node may represent a complete
   workflow rather than a runtime step.
4. **Optimization loop:** identify the mutable artifact, candidate generation,
   feedback signal, selection rule, stopping condition, and promotion boundary.
5. **Evaluation:** state which component each benchmark actually evaluates.
   Do not use a modularity-only experiment as evidence for an optimizer.
6. **Results:** reproduce the minimum table or numeric context needed to make
   the comparison auditable.
7. **Limitations:** include contrary evidence, regressions, omitted details,
   costs, and properties that were not evaluated.

## Interpret numbers without inflating them

- Distinguish an absolute percentage-point change from a relative percentage
  improvement. Compute the latter only when the numerator and denominator are
  both available and label the calculation as an inference.
- Preserve whether a value is a mean, best run, pass@1, solve rate, F1, or
  another metric. Do not place unlike metrics on a common scale without a stated
  reason.
- Record error bars, run counts, and seeds. If absent, say they are absent.
- Separate workflow-search or optimization cost from deployed inference cost.
  A low inference point after search is not a low total lifecycle cost.
- Note whether test data is held out from repeated validation search and whether
  model, prompt, or benchmark choices constrain transfer.
- Treat a task-specific gain as task-specific. It does not establish production
  safety, security, causal attribution, or model independence.
- When a paper's prose and table labels differ, preserve the table values and
  explain the interpretation instead of silently choosing the stronger claim.

## Compare works on stable dimensions

Useful comparison dimensions include:

- primary contribution;
- runtime execution unit;
- workflow or graph representation;
- mutable optimization artifact;
- search or update method;
- evaluator and feedback source;
- versioning and provenance;
- demonstrated benchmark scope;
- cost boundary; and
- production controls that are present, absent, or untested.

Avoid imposing Orbit terminology on a paper. A paper's node, agent, action,
operator, workflow, and Orbit Processor are not interchangeable unless the
evidence establishes the mapping.

## Derive Orbit implications conservatively

State Orbit implications as non-binding. Separate the execution plane from the
learning or control plane, candidate generation from candidate approval, and a
complete immutable version from an in-place edit.

Benchmark evidence may motivate experiments. It does not remove the need for
schema validation, capability policy, held-out evaluation, provenance,
approval, staged rollout, or rollback.

End with open questions that could be answered by further research or distinct
ADRs. Do not convert those questions into decisions inside the research note.
