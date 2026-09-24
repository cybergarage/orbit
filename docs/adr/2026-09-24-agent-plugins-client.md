---
status: accepted
proposed-date: 2026-09-24
decision-date: 2026-09-25
implementation-status: not-started
implementation-completed-date: null
implementation-commits: []
superseded-by: []
---

# Local Agent Plugins Client

## Purpose

Allow one local Agent Plugins 1.0.0 package to contribute Skills and stdio MCP
tools to Orbit CLI, GUI and library applications. Keep the existing per-operation
authorization, explicit Skill selection, evidence and resource ownership.

## Decision

Accepted by the author on 2026-09-25 with the explicit instruction to accept
this ADR and proceed with implementation, verification and chapter 13 updates.
Review confirms the stdio-first scope and the separation between independent
component loading and the unknown-operation execution barrier. Implementation
has not started at acceptance; completion requires the confirmation below.

### Scope and public boundary

Implement reusable loading in `src/core/plugins/` and export its public types
through the normal core/package entry points. Provide a `PluginCatalog` API
accepting an explicit list of `{id, directory}` installation instances and a
host-controlled data root. Its inspection result contains metadata, Skill
contributions, stdio server descriptors and structured diagnostics. Inspection
must not launch servers, install dependencies or execute package code.

Connect that catalog to Agent construction and the existing per-Run MCP manager
and Skill reader. Freeze contributions for a Run and include their instance IDs,
manifest/configuration digests and resolved launch values in the existing
request/operation bindings. Do not mutate a live Run when files change. Changed
catalogs invalidate stale Skill selections and incompatible request replays.

Applications accept repeatable `--plugin ID=DIRECTORY` and an optional
`--plugin-data-dir DIRECTORY`. Resolve relative package arguments against the
invoking cwd. Default product data to `~/.orbit/plugins/data/ID`; require library
hosts to choose their own data root. Validate IDs as 1–64 lowercase alphanumeric
or hyphen characters, with alphanumeric ends. Reject duplicate IDs before
activation. IDs are scoped to the host data root and identify installations,
not manifest names. Users must choose separate IDs for separate installations.
Changing version or relocating a package with the same ID preserves its data.
Reject a data root inside a package root and paths escaping the selected data
root. Do not add automatic directory scanning or ancestor-setting activation.

CLI exec, interactive mode and GUI startup use one shared core composition path;
`orbit plugins list` inspects selected packages without starting MCP processes.
Existing Skill listings include plugin Skills and provenance. The GUI exposes
plugin metadata and diagnostics through its authenticated API and Skill picker;
it does not add a download/install UI. Existing explicit Skill-root selection
controls workspace roots and does not disable explicitly selected plugins.

### Loading and validation

Implement the 1.0.0 manifest and component rules locally, with no schema network
fetch during loading. Use the normative specification's exceptions rather than
applying a generic strict JSON validator to every manifest error. Keep unknown
client namespaces inert. Distinguish rejected package, invalid component,
invalid Skill/server, unsupported transport, and runtime failure diagnostics.
Never expose environment values in diagnostics.

Enforce filesystem-resolved package containment for all package-owned access.
Discover only immediate Skill children. Resolve permitted internal aliases to
canonical targets and retain logical discovery paths separately where needed.
Revalidate file identity around reads and before startup; deny escaping or
changed targets. Do not interpret arbitrary arguments as package paths. Keep
bounded reads and explicit limit diagnostics; document limits separately from
format validity. Initial package bounds: 64 selected instances, 1 MiB per JSON
manifest/configuration, 256 server entries per package, plus existing Run server
and Skill byte/selection limits. Exceeding a bound must not be reported as a
successful complete listing.

Missing optional components are ordinary absence. One invalid component or entry
must not discard healthy siblings. Invalid JSON/schema-version combinations
must not result in any startup for the affected scope. Validate unsupported
transport descriptors and report them without connecting or substituting stdio.

### Skills and bundled resources

Accept standard Skill metadata including `metadata` and `allowed-tools`.
Validate and preserve them in listings and snapshots. `allowed-tools` remains
informational in Orbit; it cannot bypass or extend host execution policy.
Accept valid minimal Skill documents without requiring a nonempty instruction
body. Audit other optional-value constraints against the referenced standard.
Unknown nonstandard keys remain outside this portable support contract.

Keep explicit selection and source digests. Preserve exact v1/v2 snapshot
validation with legacy parsers. Introduce a new projection revision for Skills
whose metadata, body or logical/canonical path representation requires the new
contract. The record reader must validate the source-derived metadata and both
path representations; new readers retain old-record support, while old readers
may reject new projections. Do not silently rewrite stored records or raise the
existing snapshot-count/record-byte ceilings. This is a limited replacement of
the restriction in the descriptive-metadata ADR after acceptance, not a change
to Skill selection authority.

Provide a core package-resource reader that resolves a plugin instance and
package-relative resource path under the same containment checks, with bounded
reads. Applications can use it to expose referenced material after selection.
Do not automatically inject entire resource trees, execute Skill scripts, add
package directories to writable tool roots or persist supplementary files as if
they were part of the SKILL.md snapshot. Document that continued access to a
live bundled resource requires the package to remain installed.

### MCP startup, data and naming

Implement stdio contributions first; Streamable HTTP and legacy SSE remain
unsupported transports with diagnostics. Use the existing SDK transport,
ToolRegistry, codecs and ToolRuntime. Give each server its resolved package
startup context and per-instance persistent data. Create the data directory
before launch, preserve it across updates and never delete it automatically.
Bind the resolved executable, cwd, arguments, environment and plugin provenance
to startup approval; revalidate package executable/cwd containment immediately
before dispatch. No implicit approval follows from enabling a plugin.

Use a stable plugin-instance/server composite identity distinct from native
server names. Generate bounded model-visible tool names from the full identity
and retain the original remote tool name for calls. Detect any collision with
native, custom or plugin tools before exposing the catalog; do not silently
replace a definition. Exact naming and its digest algorithm must be documented
and tested for determinism and collision rejection, not treated as a persistent
remote-tool ID.

### Independent failures and managed safety

Separate plugin startup attempt results from tool-call outcomes. A rejected
manifest/configuration or denied startup is known nondispatch and can be skipped.
For a spawned server that fails initialization, retain the client/transport and
track shutdown, pending promises and any unknown operation in the owning Run.
Continue independent component/server initialization while that Run has budget
and has not been cancelled by the user. Do not retry failed startup implicitly.

A startup-specific managed path must not invoke the global stop merely because
one plugin server is unavailable. After discovery, a separate execution-admission
check prevents model/tool dispatch if an operation remains unknown or a required
resource has not quiesced. Unknown external effects remain unknown even when the
process has exited; only existing explicit reconciliation can resolve them.
Loading other components is not permission to continue application execution.
Global cancellation, exhausted Run limits, journal failures and revoked policy
still stop work. Resource cleanup failures remain visible and owned.

This refines failure isolation for plugin startup only. Native MCP settings keep
their current fail-fast behavior. Ordinary tool-call exceptions retain the
existing unknown-operation stop. Do not implement isolation as a blanket
`catch/continue` around `executePrepared` and do not downgrade an unknown outcome
to an ordinary failure to obtain a successful Run.

## Consequences

Portable packages can reuse the existing execution system. Product activation is
explicit, and inspection is possible without process startup. Stable instance
IDs preserve data across updates without trusting manifest names as ownership.

Costs include a new public catalog, startup-specific lifecycle handling and a
new Skill projection. Users are responsible for stable IDs and installed package
availability. Older Orbit versions may refuse records containing new Skill
projections. Supporting stdio does not make arbitrary MCP schemas compatible.

Package containment does not provide an OS sandbox or freeze script bytes after
launch. Concurrent package updates are unsupported while Runs use the package;
observed changes are rejected. A package is still executable code once startup
is authorized. This decision does not claim general supply-chain isolation.

## Context and Problem Statement

At `a816567fc16b5e36698a1546fa873fd3f88ea1a9`, Orbit has no portable plugin loader.
MCP settings lack a package context, and the manager throws on initialization
failure. More importantly, its managed startup calls `executePrepared`, whose
unknown outcome requests Run stop. Merely continuing the manager loop is not a
correct implementation of independent discovery. Skill metadata and snapshot
validation also have a narrower contract than portable Skills.

The [research note](../research/2026-09-24-agent-plugins-compatibility.md)
records inspected symbols, tests and limitations. Current published main could
not be checked because the remote lookup failed with DNS resolution.

## Decision Drivers

Portable local reuse; no implicit execution authority; deterministic provenance;
preserved persistent records; component-level diagnostics; owned cleanup;
shared CLI/GUI/library behavior; bounded initial delivery.

## External Implementation Research

On 2026-09-24, inspected Agent Plugins 1.0.0 and its manifest/MCP schemas,
loading/runtime guides and the Agent Skills specification. The latter defines
Skill content; Agent Plugins defines its package discovery. The stdio-first
transport scope is permitted; installation and user presentation remain host
policy. No claim is made that arbitrary native vendor plugin formats are portable.

Codex `8c68d4c87dc54d38861f5114e920c3de2efa5876`,
`codex-rs/codex-mcp/src/connection_manager.rs`, demonstrates aggregate discovery
that skips unavailable tool lists and retains server identity. Adopt availability
isolation as a design comparison, not as proof of Orbit cleanup guarantees.

Pi `781152fc24841dc54b22284514604048ebe5e2c9`,
`packages/coding-agent/src/core/{skills.ts,resource-loader.ts,extensions/types.ts}`,
demonstrates resource composition, Skill diagnostics and native executable tool
registration. Preserve provenance/diagnostics, but do not copy recursive scanning
or treat its native Extension API as the portable plugin contract. Inspected
snapshot blobs and source links are recorded in the research. No external runtime
test or assessment of either product's complete Agent Plugins support occurred.

## Considered Options

1. Document the standard only: does not deliver the requested interoperability.
2. Import JSON once into native settings: loses package identity, data lifecycle
   and failure semantics; rejected as an adequate implementation.
3. Support MCP only: smaller compliant component scope, but omits the requested
   reuse of Skills and the existing chapter connection.
4. Support local Skills and stdio with shared managed execution: accepted scope.
5. Add remote transports, marketplaces and native hooks now: independent design,
   authentication and distribution work; defer rather than make it a prerequisite.

## Implementation and Confirmation

Before source changes, obtain author acceptance or explicit delegation for this
record, record the review and decision date, and commit acceptance. Implement in
reviewable units: loader/validation and Skill compatibility; startup/composition
and product integration; maintained documentation/book updates and verification.
Commit implementation before recording its full hashes in a finalization commit.

Required confirmation includes:

- Manifest exception handling, unsupported versions, component absence/wrong
  kind, closed server entries and version mismatch; no network schema access.
- Immediate Skill discovery, sibling failure isolation, bounded reads, symlink
  containment, replacement detection and resource-reader escape refusal.
- Optional metadata, minimal bodies, old/new snapshot reopen, derivation tamper
  rejection, stale selection/request bindings and unchanged execution permissions.
- Single-pass placeholder expansion, unknown literal placeholders, reserved env
  collisions including Windows casing, executable search, per-server cwd and
  persistent data retention across a simulated package update/relocation.
- A real stdio fixture launched from a different workspace, with a healthy
  server alongside failed startup/handshake/unsupported entries; surviving
  contributions and process cleanup must be observable.
- Failure after possible startup effects: siblings still load, subsequent
  execution remains blocked, and unknown effects/cleanup cannot be erased by
  catches. Cancellation, time limits, journal failure and denied startup also
  need explicit tests.
- Cross-plugin/native naming collisions, no double startup, per-Run ownership,
  CLI inspection/exec, interactive Skill selection and authenticated GUI behavior.
- No secret env contents in diagnostics or product output.

Run `headers:check`, `build` and full `npm test` sequentially; inspect formatter
differences. Run package-consumer validation for the new public exports. Record
platform and live-integration limits separately from passing local tests. Map
the official conformance checklist to actual tests before claiming compatibility.
If startup isolation violates managed invariants, revise this ADR before shipping.

Update maintained architecture, glossary/concepts where affected, Skills/tools
and settings/CLI guides. After implementation verification, update book chapter
13 with packaging concepts, discovery and Orbit behavior, and chapter 12's changed
Skill compatibility statements. Add a package-to-Skill/MCP diagram, preserve the
existing chapter structure, proofread and validate chapter/full-book artifacts
according to the book contract. Do not describe proposed behavior as implemented.

## Follow-up Work

Remote transports/authentication, plugin marketplaces, download/update/uninstall
commands, vendor-native extension namespaces, full MCP schema vocabulary,
resource snapshots and model-driven automatic Skill selection remain separate.
No tag, release, push or storefront publication is authorized by this decision.
Existing parent ADR verification deferrals remain unchanged.

## References

- [Compatibility research](../research/2026-09-24-agent-plugins-compatibility.md)
- [Agent Plugins specification 1.0.0](https://agent-plugins.org/specification)
- [Loading and discovery](https://agent-plugins.org/client-implementers/loading-and-discovery)
- [MCP runtime](https://agent-plugins.org/client-implementers/mcp-runtime)
- [Conformance checklist](https://agent-plugins.org/client-implementers/conformance)
- [Agent Skills specification](https://agentskills.io/specification)
- [Run-scoped Skill selection](2026-09-09-run-scoped-skill-selection.md)
- [Descriptive Skill metadata](2026-09-21-skill-descriptive-metadata.md)
- [Prepared operation authorization](2026-09-07-prepared-operation-authorization.md)
- [Managed Run lifecycle](2026-09-07-managed-run-lifecycle.md)
