# Local Agent Plugins

Orbit loads explicitly selected local Agent Plugins 1.0.0 directories. Supported
components are Skills and stdio MCP servers. Streamable HTTP and legacy SSE are
validated and reported as unsupported; Orbit does not substitute another
transport. Package loading does not install software or grant tool permissions.
The format reference is [Agent Plugins](https://agent-plugins.org/specification).

## Enable and inspect

```sh
orbit plugins list --plugin reports=./reports-plugin --json
orbit skills --plugin reports=./reports-plugin --json
orbit exec --plugin reports=./reports-plugin --skill ID@DIGEST 'Review the report'
orbit gui --plugin reports=./reports-plugin
orbit --plugin reports=./reports-plugin
```

Replace `ID@DIGEST` with a candidate from the Skill listing. Interactive mode uses
`/skills` and `/skill ID@DIGEST`; the GUI uses its Skill picker. Explicit
`--skill-root` flags replace workspace Skill roots but retain enabled plugins.
`plugins list` does not start servers, create data directories or print Skill
bodies or MCP environment values. GUI clients can read metadata and diagnostics
from the capability-protected `/api/plugins?threadId=...` endpoint.

Repeat `--plugin ID=DIRECTORY` for separate instances. IDs use 1–64 lowercase
ASCII letters, digits and hyphens, starting/ending with a letter or digit.
Relative directories resolve against the launch directory, including when GUI
Projects later choose a different workspace. Duplicate instance IDs are errors;
manifest names do not control instance ownership.

Data defaults to `~/.orbit/plugins/data/ID`. Set `--plugin-data-dir DIRECTORY`
to choose another root. Keep the same root and ID to retain data across package
updates or relocation. Separate installations need separate IDs. The data root
must be outside the package, and a redirected instance directory cannot escape
that root. Orbit creates data before server startup and does not delete it.

## Package and library interface

A package has a root `plugin.json`, optional immediate Skills under `skills/`,
and optional `mcp.json`. Orbit recognizes the canonical 1.0.0 schema identifiers
locally. A fatal manifest error rejects that package. Component/server errors
are reported at their own scope; missing optional components are ordinary absence.
Unknown manifest fields and unsupported client extensions do not acquire behavior.
See the [loading rules](https://agent-plugins.org/client-implementers/loading-and-discovery).

```ts
import {Agent, PluginCatalog} from '@cybergarage/orbit'

const catalog = new PluginCatalog([{id: 'reports', directory: '/opt/example/reports-plugin'}], {
  dataRoot: '/var/example/plugin-data',
})
const plugins = await catalog.load() // optionally pass an existing SkillCatalog
const listing = await plugins.skillCatalog.list()
const agent = new Agent({plugins})
try {
  // Use agent.startRun(..., {skills: [{id, digest}]}) with explicit selections.
  // Supply the usual host policy and approval responder for MCP startup/calls.
} finally {
  await agent.close()
  await plugins.skillCatalog.settle()
}
```

`inspect()` returns copied metadata, diagnostics, Skill roots and server
configuration; integrations must avoid logging raw server environments.
`load()` binds those contributions to an Agent. Changes to package configuration
require loading a new runtime between Runs. Skill changes require relisting and
explicit reselection. A catalog validates configuration again before each Run.
It does not hot-reload or restart servers after failure.

`readResource(instanceId, relativePath, limit?)` reads a UTF-8 package resource
under filesystem-resolved containment, defaulting to 64 KiB and capped at 1 MiB.
It neither executes scripts nor grants ordinary tools extra readable/writable
roots. Hosts choose how to present references. Resources are live package files,
not part of persisted SKILL.md snapshots.

## Execution and diagnostics

The stdio adapter resolves package commands and working directories, expands the
two portable placeholders once, and supplies instance environment/data. Each
startup uses the normal managed confirmation mechanism. Startup approval binds
the resolved configuration and executable; individual calls need their own
approval. The workspace remains the operation's host authorization/lease scope;
the preview identifies the actual subprocess cwd. Enabling a package never adds
its directory to ordinary file-tool permissions.

Plugin server identities are `plugin:INSTANCE:SERVER`. Model tool names are
`plugin_` plus the first 56 hexadecimal SHA-256 characters of the JSON array
`[serverIdentity, originalToolName]`. Remote calls use the original name.
Registry collisions are errors, including collisions with native/custom tools.
These names identify a configured contribution, not an immutable external service.

An invalid or denied server does not suppress healthy siblings. A failed
initialization after dispatch can have unknown external effects; Orbit continues
independent discovery but refuses model/tool dispatch if any operation remains
unknown. Cleanup remains owned by the Run. Process exit does not prove the
absence of external effects; use the existing explicit reconciliation mechanism.
Cancellation, budget exhaustion and journal failures still stop the Run. Native
MCP settings retain fail-fast discovery. See [Execution](execution.md).

The package path check is not an OS sandbox. Do not modify a package while a Run
uses it: observed path/content changes are refused, but Orbit cannot freeze code
that a child process reads after launch. Use OS isolation for subprocess access
restrictions. Skill `allowed-tools` is informational, never an authority grant.

## Bounds and compatibility

Inspection permits at most 64 explicitly configured instances, 1 MiB per JSON
file and 256 server entries per package. Existing Skill defaults still apply
(8 roots, 128 candidates, 64 KiB per Skill, 2 MiB listing bytes and 4 selections),
as do Run server/time limits. A bound failure is diagnostic, not a complete
successful listing. Internal package aliases are resolved and escaping targets
are refused. Plain workspace Skill roots keep their stricter identity checks.

Portable Skill fields and plugin provenance use projection v3 when necessary.
New readers retain v1/v2 validation; old readers may reject new snapshots.
Supplementary resources are not automatically loaded or persisted. Orbit's
existing MCP JSON Schema vocabulary and tool-list limitations still apply;
this format support does not imply universal MCP server compatibility.
Remote transports, marketplaces, automatic updating, native hooks and automatic
Skill selection are outside this implementation.

## Conformance evidence

The [client checklist](https://agent-plugins.org/client-implementers/conformance)
is mapped to the following local tests. The normative specification takes
precedence over that checklist. This is a stdio-first implementation, not a
claim that all MCP transports or vendor extensions are supported.

| Area | Implementation and executable evidence |
| --- | --- |
| Directory and manifest | `test/core/plugins.test.ts`: side-effect-free inspection, manifest exceptions, invalid identity/data roots, oversized files and component kinds. The loader recognizes only the canonical 1.0.0 identifiers, without fetching schemas. |
| Component discovery | The same suite checks absent components, immediate Skill children, invalid siblings, internal aliases, stale paths and resource escapes. Existing `skill-selection.test.ts` covers listing/selection byte limits. |
| MCP descriptors | Tests cover independent entries, version mismatch, reserved environment names, one-pass expansion, unsupported transports, invalid remote URL/headers and persistent instance data across relocation. |
| MCP execution | A real Node stdio child verifies package cwd, injected environment, original remote names and process exit. Injected clients verify failed startup isolation, denial, unknown outcomes, cancellation, budget exhaustion and journal failure. |
| Host integration | CLI inspection and fixed-model execution, Ink selection, authenticated GUI inspection and Project runtime propagation have integration tests. Package-consumer validation checks the public export. |

Only 1.0.0 is recognized; unsupported versions are rejected rather than assigned
new semantics. Existing v1/v2 Skill snapshots keep their exact validation,
while portable metadata/provenance use v3. Local validation does not cover live
provider selection quality, Windows process behavior or remote authentication.
