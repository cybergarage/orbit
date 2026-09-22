# Orbit Documentation

This directory separates current product behavior, durable concepts,
point-in-time research, and architecture decisions. The separation lets Orbit
describe an experimental direction without presenting unimplemented behavior
as a product contract.

## Start here

- Build your first application with [Building an agent](building-agents.md)
  and the [runnable consumer example](../examples/agent/README.md).
- Read [Versioning](versioning.md) for 0.x compatibility and release milestones.

- Read [Concept Overview](concepts/overview.md) for Orbit's purpose and design
  principles.
- Read [Current Architecture](architecture.md) for the structure implemented in
  the repository today.
- Read [Development](development.md) to build, test, and change Orbit.
- Read the feature guides for current user-visible behavior, including
  [Input budgets and compaction](context-compaction.md).

## Document types

| Document type        | Location                                                            | Owns                                                                                  | Does not own                                                     |
| -------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Concepts             | [`concepts/`](concepts/README.md)                                   | Durable vocabulary, mental models, invariants, and clearly labeled direction          | Approval of a design or a claim that directional behavior exists |
| Current architecture | [`architecture.md`](architecture.md)                                | Maintained map of the implemented runtime and module boundaries                       | Historical rationale or speculative target designs               |
| Feature guides       | Files such as [`tools.md`](tools.md) and [`session.md`](session.md) | Current user and integration behavior                                                 | Architecture decision history                                    |
| Research             | [`research/`](research/README.md)                                   | Dated evidence, comparisons, analysis, and non-binding recommendations                | Decisions or maintained product contracts                        |
| Decisions            | [`adr/`](adr/README.md)                                             | Architecturally significant decisions, rationale, status, and implementation evidence | General tutorials or routine progress reports                    |

Keep one authoritative home for each fact. Other documents should summarize
only enough context to remain readable and link to that home.

## First-stage directory layout

```text
docs/
├── README.md                 documentation map and ownership rules
├── architecture.md          current implemented architecture
├── concepts/                durable and directional mental models
│   ├── README.md             concept authoring and maintenance rules
│   ├── overview.md
│   ├── agent-runtime.md
│   ├── processor-model.md
│   ├── processor-graph.md
│   ├── adaptive-execution.md
│   └── glossary.md
├── adr/                     architecture decision lifecycle and records
├── research/                dated investigations and evidence
└── *.md / *.adoc            existing feature and development guides
```

The content lifecycle, rather than subject name alone, determines where a
document belongs. For example, an investigation of graph routing stays in
`research/`, the shared meaning of Router stays in `concepts/`, an adopted
routing contract belongs in an ADR, and its implemented structure appears in
`architecture.md`.

## Concept map

- [Agent Runtime](concepts/agent-runtime.md): how an agent turn progresses
- [Processor Model](concepts/processor-model.md): the executable-step
  abstraction
- [Processor Graph](concepts/processor-graph.md): bounded managed composition and broader directions
- [Adaptive Execution](concepts/adaptive-execution.md): the directional model
  for evaluated graph evolution
- [Glossary](concepts/glossary.md): shared terminology and status qualifiers

## Current feature documentation

- [Projects](projects.md): explicit catalogs, registered session membership and GUI navigation.

- [Workflow evaluation](workflow-evaluation.md): trusted plans, read-only evidence inspection, fixed denominators and missing-resource accounting.

- [Managed Processor Graphs](processor-graphs.md): compilation, typed values, shared Run ownership and journal v2 migration.

- [Managed Execution](execution.md): run APIs, one-operation approval, required journal, recovery and migration.

- [Explicit Skill selection](skills.md): source-identified, one-Run instructions and historical snapshots.
- [Settings](settings.md)
- [Coding Tools](tools.md)
- [Sessions](session.md)
- [Session Logs](logging.md)
- [CLI Reference](cli.md): generated command usage, flags and examples.
- [Interactive Commands](interactive.md)
- [Local GUI](gui.md)
- [GUI Integration](gui-integration.md)

- [Workflow selection](workflow-selection.md): human choice, captured requests, memory/host storage and observation.

## Growth policy

Keep the first-stage structure shallow. Add a new top-level documentation
category only when several maintained documents share a distinct audience and
lifecycle. Do not move the existing feature guides merely to make the tree
symmetrical.

Possible future categories such as `guides/`, `reference/`, or `subsystems/`
require an established body of content and a migration plan for incoming
links. Proposed specifications belong in research or a proposed ADR until the
repository adopts a dedicated specification lifecycle.

- [Session storage registration, recovery and migration](session-storage.md): offline initialization, scoped writer/journal APIs, retained guards and deletion migration.

- [Verified interrupted context](interrupted-context.md): opt-in cancelled nondispatch evidence, derived input and exclusive transcript-v3 migration.
