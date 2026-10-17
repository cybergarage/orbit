# Versions and compatibility

Orbit is published as `@cybergarage/orbit`. The executable remains `orbit`.
Use exact dependency versions and commit the application lockfile while the
runtime is in its 0.x development series.

Current maintainer direction is to keep releases in the **0.9.x** series.
Version **0.9.3** is the next prepared release. Do not move to 0.10 or 1.0
without a new explicit version decision; the 1.0 direction below is deferred.

## Release milestones

| Version | Intended milestone |
| --- | --- |
| `0.6.x` | Initial public releases with a documented application entry point, runnable consumer example and package validation |
| `0.8.0` | Book publication milestone, with the book and examples identifying their matching Orbit release |
| `0.8.1` | Published npm package and updated book baseline with a Run-bound operation executor and named execution settings |
| `0.9.0` | Durable scheduled work, Windows file-flush acknowledgements and an optional Apple text provider |
| `0.9.1` | Project/Session lifecycle and display names, local GUI scheduling and conversation/approval refinements |
| `0.9.2` | Coordination descriptor ownership on bind mounts, with unchanged storage formats |
| `0.9.3` (unreleased) | Shared scoped initialization API, CLI/embedded-GUI workflows and Logs panel refinements |
| `1.0.0` (deferred) | Historical direction for a complete application and stable compatibility contract; not a current release target |

Version 0.8.1 was published to npm on 2026-10-02. Its tarball matches the
validated release artifact. The technical book references v0.8.1 at commit
`bf3f7c4e752de24fd51524633114d48600af5eb3`; its source links, execution API
explanations, and EPUB have been updated and checked against that baseline.
Book storefront publication remains a separate author decision.

Version 0.9.0 adds durable scheduled work, Windows storage compatibility and an
optional Apple text provider. Its release consumer example targeted 0.9.0. See the
[changelog](../CHANGELOG.md#090--2026-10-14) for additions, compatibility and
platform-specific upgrade notes, and [Development](development.md#releases-and-npm-packages)
for validation and publication steps. The book's v0.8.1 baseline remains
independent of this release.

The [v0.9.0 GitHub source release](https://github.com/cybergarage/orbit/releases/tag/v0.9.0)
was published on 2026-10-14 after its
[release validation](https://github.com/cybergarage/orbit/actions/runs/38442641049)
passed. Version 0.9.0 was also published to npm on 2026-10-14. Its published
tarball matches the independently validated release artifact, and the npm
`latest` tag was confirmed as `0.9.0` after publication.

Version 0.9.1 was published as a
[GitHub release](https://github.com/cybergarage/orbit/releases/tag/v0.9.1) on
2026-10-15 and to npm on 2026-10-16. It includes Project/Session lifecycle and
rename APIs, optional GUI scheduling and the shared Details/native approval
interface.

Version 0.9.2 was published to npm and as a
[GitHub release](https://github.com/cybergarage/orbit/releases/tag/v0.9.2) on
2026-10-16. It fixes coordination descriptor ownership on bind mounts without
changing storage formats or relaxing identity checks. Existing retained guards
require offline inspection; upgrading does not delete them.

Version 0.9.3 is prepared in source and has not been tagged, released on GitHub
or published to npm. It adds the public scoped initialization contract and shared
CLI/embedded-GUI workflow, plus Logs presentation refinements. This compatible,
opt-in addition stays in the 0.9.x series; no existing public API is removed or
changed. Existing storage formats and `orbit storage reset` semantics do not change.
The consumer example pins 0.9.3 for local tarball validation. The current
published npm version remains 0.9.2. See the
[unreleased changelog](../CHANGELOG.md#093--unreleased),
[initialization guide](initialization.md) and
[release procedure](development.md#releases-and-npm-packages).

The deferred 1.0 milestone is not available functionality, a promised date or
authorized release work. Current releases remain in 0.9.x.
Application completion should provide evidence for 1.0 readiness: representative
workflows, operator recovery, deployment behavior and API usage. The version
number alone is not evidence that these properties were tested.

The GitHub `0.6.0` source release precedes npm publication. The first npm
package is `0.6.1`, which includes the revised framework introduction and CLI
reference. Published tags retain their original contents.

## 0.x policy

Application code should import the deliberate exports from the package root.
Imports into `dist/core/...` or other internal paths are unsupported integration
contracts even when Node.js can resolve them. Node.js 20.19+ and native ESM are
required; no browser-runtime or CommonJS build is promised.

Within the current 0.9.x series, patches may contain compatible corrections and
additive, opt-in APIs. Preserve existing contracts and storage behavior.
Incompatible public API changes require a separate version decision and migration
guidance; they must not be silently included in a 0.9.x patch. The project still
treats 0.x APIs as evolving; pinning the exact version makes upgrades a deliberate
application decision.

Public exports include low-level trusted extension machinery. Their presence
does not mean an arbitrary direct invocation receives the guarantees of a
managed Agent Run. Prefer the boundaries in [Building an agent](building-agents.md).

Storage formats have their own versions; package `0.8.0` does not imply Session
format 8. Upgrading or downgrading software never authorizes mixed-version
writers. Stop writers, retain data and follow the applicable
[storage](session-storage.md), [execution](execution.md), and
[interrupted-context](interrupted-context.md) migration instructions. Do not
assume that reinstalling an older npm version reverses a storage migration.
