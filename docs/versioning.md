# Versions and compatibility

Orbit is published as `@cybergarage/orbit`. The executable remains `orbit`.
Use exact dependency versions and commit the application lockfile while the
runtime is in its 0.x development series.

## Release milestones

| Version | Intended milestone |
| --- | --- |
| `0.6.x` | Initial public releases with a documented application entry point, runnable consumer example and package validation |
| `0.8.0` | Book publication milestone, with the book and examples identifying their matching Orbit release |
| `0.8.1` | Published npm package and updated book baseline with a Run-bound operation executor and named execution settings |
| `1.0.0` | A complete OpenClaw/Hermes-style application built on Orbit, accompanied by an explicit stable API and compatibility contract |

Version 0.8.1 was published to npm on 2026-10-02. Its tarball matches the
validated release artifact, and the npm `latest` tag points to 0.8.1. The
technical book references v0.8.1 at commit
`bf3f7c4e752de24fd51524633114d48600af5eb3`; its source links, execution API
explanations, and EPUB have been updated and checked against that baseline.
Book storefront publication remains a separate author decision.
The 1.0 milestone is a plan, not available functionality or a promised date.
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

Within a 0.x minor series, patches are intended for compatible corrections.
Breaking public API changes move to a new minor series and must be described
with migration guidance. The project still treats 0.x APIs as evolving; pinning
the exact version makes upgrades a deliberate application decision.

Public exports include low-level trusted extension machinery. Their presence
does not mean an arbitrary direct invocation receives the guarantees of a
managed Agent Run. Prefer the boundaries in [Building an agent](building-agents.md).

Storage formats have their own versions; package `0.8.0` does not imply Session
format 8. Upgrading or downgrading software never authorizes mixed-version
writers. Stop writers, retain data and follow the applicable
[storage](session-storage.md), [execution](execution.md), and
[interrupted-context](interrupted-context.md) migration instructions. Do not
assume that reinstalling an older npm version reverses a storage migration.
