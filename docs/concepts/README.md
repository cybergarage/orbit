# Orbit Concepts

Concept documents define Orbit's durable vocabulary, mental models, design
principles, and invariants. They connect the learning purpose of the project to
its longer-term engineering direction without claiming that every described
capability is implemented.

## Concept index

1. [Overview](overview.md) introduces the product and its principles.
2. [Agent Runtime](agent-runtime.md) explains the current turn loop and its
   intended decomposition.
3. [Processor Model](processor-model.md) defines the executable-step
   abstraction.
4. [Processor Graph](processor-graph.md) defines the directional composition
   model.
5. [Adaptive Execution](adaptive-execution.md) defines the directional control
   plane for evaluated graph evolution.
6. [Glossary](glossary.md) owns shared terminology.

## Status language

Every behavioral statement must make its status clear:

- **Current** means the behavior exists in the maintained repository and must
  agree with [Current Architecture](../architecture.md) and feature guides.
- **Directional** means the concept guides exploration but is not an approved
  design, roadmap commitment, or implemented capability.
- **Decision** means an ADR has accepted or rejected a concrete architecture
  choice. Link the ADR rather than restating its full rationale.

Avoid ambiguous future tense. Use explicit phrases such as "directional model"
and "not currently implemented."

## Ownership and relationships

Concepts answer what Orbit means and which invariants should survive design
changes. Current architecture answers how the repository works today. Research
records what was investigated at a date and revision. ADRs record what was
decided and why. Feature guides define current user and integration behavior.

A concept may synthesize several research notes and decisions, but it must link
them and must not become their historical archive. An accepted runtime change
usually requires coordinated updates to the relevant ADR, concept, current
architecture, and feature guide.

## Authoring a concept

Use the following structure when it fits the subject:

1. `Purpose`
2. `Conceptual Model`
3. `Current Orbit Implementation`
4. `Directional Model`
5. `Invariants`
6. `Non-goals`
7. `Related Concepts`
8. `Related Research and Decisions`

Keep concept documents stable and implementation-independent where possible.
Name actual classes and files only in `Current Orbit Implementation`, or link
to the current architecture map. Add a new concept page only when the term or
model is used across multiple components or decisions.

## Change policy

- Update a concept when shared terminology, durable principles, or the boundary
  between current and directional behavior changes.
- Do not record meeting notes, alternative-by-alternative analysis, or dated
  ecosystem surveys here; use `docs/research/`.
- Do not approve architecture here; use `docs/adr/`.
- Preserve one definition per term in [Glossary](glossary.md), then link it
  where more detail is needed.
- Review concepts after implementing a significant ADR so stale directional
  claims do not contradict the current architecture.
