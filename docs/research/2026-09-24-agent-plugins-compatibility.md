---
status: current
investigation-date: 2026-09-24
orbit-commit: a816567fc16b5e36698a1546fa873fd3f88ea1a9
related-adrs:
  - docs/adr/2026-09-24-agent-plugins-client.md
superseded-by: []
---

# Agent Plugins Compatibility

## Purpose

Establish the gap between Orbit's existing Skills/MCP execution and a portable
Agent Plugins client. This note supplies evidence, not acceptance or implementation.

## Research Questions

- Can the existing runtime consume a portable package without rewriting it?
- Which loader, persistent-data, Skill and execution contracts need changes?
- How can independent startup failures coexist with managed Run safety?

## Findings

Orbit does not load Agent Plugins packages at the inspected revision. Reusing its
stdio transport and managed tool path is feasible, but merely translating JSON
would omit package validation, instance data, Skill compatibility and failure
isolation. No source or runtime behavior was changed during this investigation.

Agent Plugins 1.0.0 is published. Its portable components are Skills and MCP
servers. Client installation policy and presentation are separate concerns.
The core package begins with `plugin.json`; fixed component locations are
`skills/` and `mcp.json`. The normative specification, rather than a product's
native plugin directory, defines compatibility. See [the specification](https://agent-plugins.org/specification).

## Orbit Baseline

Inspected tracked source at `a816567fc16b5e36698a1546fa873fd3f88ea1a9`:

| Source                                                            | Verified behavior                                                                              | Implication                                                                                             |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `src/core/settings.ts`, `McpServerSettings`, `validateMcpServers` | Native MCP settings carry command, args and env.                                               | There is no portable manifest or transport discriminator.                                               |
| `src/core/mcp.ts`, `createMcpTransport`                           | Uses the SDK stdio transport and the manager's cwd.                                            | Existing transport can be reused; per-package startup context is missing.                               |
| `src/core/mcp.ts`, `loadTools`, `managedConnect`                  | Starts servers sequentially; a rejected startup stops enumeration.                             | Plugin failure isolation needs an explicit runtime change.                                              |
| `src/core/execution/authorization.ts`, `executePrepared`          | Records dispatch and stops a Run on an unknown operation.                                      | Catching a manager error does not undo the Run stop.                                                    |
| `src/core/skills/parser.ts`, `parseSkillSource`                   | Accepts only name, description, license and compatibility; requires a nonempty body.           | Standard optional fields and valid minimal Skills require compatibility review.                         |
| `src/core/skills/catalog.ts`, `listOwned`, `observe`              | Scans immediate directories, enforces canonical regular-file identity and records diagnostics. | Can supply selection machinery, but package containment and alias behavior need deliberate integration. |
| `src/core/skills/record.ts`, `parseSkillEntry`                    | Re-derives snapshots using versioned projections and validates their path identity.            | Parser changes must not silently redefine persisted projections.                                        |
| `src/apps/skill-catalog.ts`                                       | Uses explicit Skill roots or nearest `.orbit/skills`.                                          | No plugin package activation exists in the product.                                                     |
| `src/core/agent.ts`                                               | Owns per-Run MCP manager, Skill reader and frozen settings.                                    | Plugin contributions must be bound before dispatch and owned through cleanup.                           |

A source/test search found no `plugin.json`, `mcp.json`, `PLUGIN_ROOT`,
`PLUGIN_DATA` or `agent-plugins` implementation. The findings above also follow
from reading the loader and runtime paths, not just the absent search matches.
`test/core/execution/mcp-contract.test.ts` was read for schema refusal, managed
approval, real stdio timeout and reconciliation expectations. Tests were not run
in this research phase. The unrelated untracked `.claude/` directory was not used.
`git ls-remote origin refs/heads/main` failed with DNS resolution; this baseline
is local HEAD, not a verified statement about the current published main.

## External Systems Investigated

Investigation date: 2026-09-24. Existing local source snapshots were read and their
Git blob SHA-1 recomputed against their saved source metadata. This verifies the
snapshot bytes against the saved metadata, not a fresh remote fetch. No external
runtime tests were performed and no product-wide Agent Plugins support claim is made.

| System / revision                                | Inspected source and blob                                                                        | Finding and proposed lesson                                                                                                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex `8c68d4c87dc54d38861f5114e920c3de2efa5876` | `codex-rs/codex-mcp/src/connection_manager.rs`; `612b2ed4420097e9de3857a843a261c43088ffc6`       | `list_all_tools` skips unavailable tool lists and aggregates server-tagged tools. Separate per-server availability from aggregate discovery. This does not establish Orbit's cleanup safety. |
| Pi `781152fc24841dc54b22284514604048ebe5e2c9`    | `packages/coding-agent/src/core/skills.ts`; `c06474730cbc0b0374f42ef6d4aa002d14d26a0e`           | Skill loading reports diagnostics; native directory scanning can recurse. Retain diagnostics, but do not copy recursive discovery into a fixed portable layout.                              |
| Same Pi revision                                 | `packages/coding-agent/src/core/resource-loader.ts`; `338daf7e96f5070e5d8f729a5ce3474d563a14b1`  | `updateSkillsFromPaths` composes resource paths and source information. Preserve contribution provenance in Orbit.                                                                           |
| Same Pi revision                                 | `packages/coding-agent/src/core/extensions/types.ts`; `50a102cb5c9bc18d56d7c1fb1c56b14bff290a4e` | `registerTool` exposes a native executable extension surface. Do not mistake native tool registration for a portable component format.                                                       |

## Analysis

The [loading guide](https://agent-plugins.org/client-implementers/loading-and-discovery)
requires manifest-first processing, local version selection, fixed discovery and
narrow failure boundaries. Missing components are valid. Unknown manifest fields
and invalid `extensions` container values have nonfatal handling, so rejecting
all schema-validation errors uniformly would be incorrect. Filesystem-resolved
containment is a package access rule, not an OS sandbox.

The [MCP runtime guide](https://agent-plugins.org/client-implementers/mcp-runtime)
separates document errors from server-entry errors and connection failures.
Stdio support is sufficient for an initial MCP-capable client. Per-instance data
and plugin-relative launch context cannot be supplied by the current shared cwd
alone. Failed startup should not discard healthy sibling contributions.

The [Agent Skills specification](https://agentskills.io/specification) includes
string-map `metadata` and experimental `allowed-tools`. Orbit currently rejects
both. Accepting a descriptive field must not grant execution authority. Old
snapshot projections must remain readable with their original derivation rules.
Supplementary files also require an explicit package-relative access path;
loading SKILL.md alone does not demonstrate bundled-resource support.

A significant conflict is observed in the current implementation:
`managedConnect` dispatches through `executePrepared`; rejection after dispatch
marks an operation unknown and requests Run stop. Adding `catch/continue` in
`loadTools` alone would not permit healthy servers to initialize and could hide
unreleased resources. The implementation needs a startup-specific result that
separates initialization failure, process quiescence and possible external effects.
It must never relabel an unknown external effect as success.

## Implications for Orbit

Non-binding recommendation: introduce a core-owned local package catalog,
explicit activation from CLI/GUI/library, and stdio contributions that reuse
existing managed authorization. Keep an installation-instance ID independent of
manifest name/version and root path; use it for persistent data and provenance.
Permit package updates only between Runs. Preserve native MCP configuration
behavior outside the plugin path unless a separate decision changes it.

An initial release should document Skills plus stdio support, skip unsupported
remote transports diagnostically, and exclude marketplaces, downloading,
automatic updates, native hooks and arbitrary JavaScript module loading.
Resources, permissions, snapshot compatibility and cleanup need tests before a
conformance claim; examples alone are insufficient.

## Risks and Limitations

- No Windows, live model, third-party plugin or network MCP execution was tested.
- Source snapshots do not establish that the compared products implement this standard.
- Package containment does not restrict what an authorized MCP subprocess can do.
- User-owned mutable plugin directories require revalidation and a documented
  no-concurrent-update condition; path checks alone do not freeze a running script.
- Skill compatibility is wider than accepting two extra keys. Empty bodies,
  optional-value constraints, aliases and persisted validation must be reviewed.
- Full MCP schema vocabulary and paginated discovery are separate existing gaps.

## Open Questions

The proposed ADR resolves the product activation and instance-data policy for
review. Implementation must demonstrate independent startup isolation without
weakening the unknown-operation barrier. If that test cannot pass, the feature
must not be advertised as conformant and the proposal must be revisited.

## Related Decisions

- [Proposed Agent Plugins client](../adr/2026-09-24-agent-plugins-client.md)
- [Descriptive Skill metadata](../adr/2026-09-21-skill-descriptive-metadata.md)
- [Prepared operation authorization](../adr/2026-09-07-prepared-operation-authorization.md)

## References

- [Agent Plugins specification 1.0.0](https://agent-plugins.org/specification)
- [Client conformance checklist](https://agent-plugins.org/client-implementers/conformance)
- [Plugin schema 1.0.0](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json)
- [MCP schema 1.0.0](https://agent-plugins.org/schemas/1.0.0/mcp.schema.json)
- [Codex inspected source](https://github.com/openai/codex/blob/8c68d4c87dc54d38861f5114e920c3de2efa5876/codex-rs/codex-mcp/src/connection_manager.rs)
- [Pi Skill loader](https://github.com/earendil-works/pi/blob/781152fc24841dc54b22284514604048ebe5e2c9/packages/coding-agent/src/core/skills.ts)
- [Pi resource loader](https://github.com/earendil-works/pi/blob/781152fc24841dc54b22284514604048ebe5e2c9/packages/coding-agent/src/core/resource-loader.ts)
- [Pi native extension API](https://github.com/earendil-works/pi/blob/781152fc24841dc54b22284514604048ebe5e2c9/packages/coding-agent/src/core/extensions/types.ts)
