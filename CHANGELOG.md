# Changelog

## 0.6.0 — 2026-09-15

First public release as `@cybergarage/orbit`. The command remains `orbit`.

### Application development

- Document the Node.js application boundary, host-owned capabilities and 0.x
  compatibility policy. Planned milestones are 0.8 for book publication and
  1.0 for a completed assistant application and stable runtime API contract.
- Add a standalone TypeScript assistant example with an offline model adapter,
  persistent conversations, approvals, cancellation, logs and restart/resume.
- Update maintained guide imports to use the scoped package and correct GUI
  integration guidance for storage setup, admission and observation.

### Distribution

- Build the runtime, type declarations, GUI bundle and CLI manifest before
  packing; keep README generation separate from package publication.
- Validate the installed tarball from an independent consumer and run that
  check in release/publish workflows and Linux CI on Node.js 20.19 and 24.

### Included runtime

The initial release includes OpenAI, Anthropic and Ollama adapters; coding and
MCP tools; managed Run budgets, approvals, cancellation and journals; persistent
Sessions and storage maintenance; explicit Skill selection; and bounded
processor graphs with workflow evaluation and application-owned selection.
See the [documentation map](docs/README.md) for behavior and limitations.

This is an evolving 0.x runtime, not a complete autonomous assistant product.
Persistent storage must be initialized under offline exclusive control. Existing
development installations must follow the applicable storage migration guides.
Live provider, deployment, Windows persistence and physical-failure validation
are separate from the deterministic consumer checks.
