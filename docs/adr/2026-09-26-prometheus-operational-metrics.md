---
status: proposed
proposed-date: 2026-09-26
decision-date: null
implementation-status: not-started
implementation-completed-date: null
implementation-commits: []
superseded-by: []
---

# Prometheus Operational Metrics

## Purpose

Make the behavior of a running Orbit application measurable without reading
individual session logs. The first integration should expose bounded aggregate
Run, model-request, and tool-call metrics to a Prometheus scraper while leaving
the required execution journal and the local GUI security model intact.

## Decision

**Proposal for author review; no implementation is authorized by this record.**

Add an opt-in, process-local Prometheus metrics adapter. Instrument the common
execution path at lifecycle boundaries, independently of diagnostic capture and
session-log retention. A host supplies the adapter to Orbit's core service; an
embedded application can render its registry through its own HTTP server. The
long-running `orbit gui` command may explicitly start a separate metrics-only
loopback listener with a configured port. No metrics listener starts by default.

Use the Prometheus-maintained Node.js client library for counters, gauges,
histograms, registry isolation, and exposition. Select and lock a release that
supports Orbit's Node.js matrix during implementation; do not hand-format the
wire protocol. Each Orbit application service owns one registry. Multiple
services in one process must not share the client library's global registry.

The first metric contract is:

| Metric                       | Source and accounting rule                                                                                                                 | Labels                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| `orbit_runs_active`          | Increase after Run admission and decrease exactly once when the terminal result is returned, even if unresolved work retains ownership.    | None                                               |
| `orbit_runs_total`           | Increase once after the final Run outcome is known, including incomplete and failed recording.                                             | `outcome`, from the closed `RunResult.outcome` set |
| `orbit_run_duration_seconds` | Observe the same settled Runs, including cleanup time. Use fixed buckets and seconds.                                                      | `outcome`                                          |
| `orbit_model_requests_total` | Count completed or failed provider attempts at their common completion boundary.                                                           | `outcome` = `completed` or `failed`                |
| `orbit_tool_calls_total`     | Count completed tool dispatches, including an error result. A denied operation that was never dispatched is not a tool call.               | `outcome` = `completed` or `failed`                |
| `orbit_model_tokens_total`   | Add only nonnegative, finite provider-reported input or output tokens for completed responses. Missing usage produces no sample increment. | `direction` = `input` or `output`                  |

Do not add Session, Thread, Run, request, operation, tool-call, user, project,
workspace, path, prompt, model ID, arbitrary provider name, or tool name as a
label. Do not export message bodies, tool arguments/results, token contents,
free-form errors, or journal entries. Metric names and label values are fixed by
the adapter rather than derived from untrusted event data. Exported counters
are process-local and reset on restart; they are not a durable audit record.
`orbit_runs_active` measures Runs awaiting a terminal result; it does not
measure quarantined operations that remain after an incomplete result.

An enabled listener accepts only `GET /metrics`, binds to `127.0.0.1` or `::1`,
and returns the library's exposition content type. It does not reuse the GUI's
capability token or expose the GUI API. An explicit bind failure fails metrics
startup visibly; a later scrape or observer failure cannot change a Run's
outcome or bypass journal acknowledgement. The listener closes during normal
application shutdown. A Kubernetes sidecar in the same Pod can scrape the
loopback listener; any cluster-wide scraping, proxying, network policy, TLS,
authentication, and remote GUI access belong to deployment-specific work.
Observer failures should be reported through the existing bounded diagnostic
health path when possible. A broken registry cannot reliably report its own
failure through a Prometheus counter.

This decision does not add tracing or OTLP export. Existing OpenTelemetry
explanations in the book describe concepts, not an implemented Orbit exporter.
Separate evidence is needed before adopting GenAI semantic metric names.

## Consequences

- **Positive:** Running applications can report aggregate activity, failures,
  latency, and known token consumption without retaining or exporting session
  content. Core instrumentation also covers hosts that do not use the GUI.
- **Negative:** The client library adds a runtime dependency, in-process metric
  storage, and a compatibility obligation. Histograms and counters lose history
  on process restart. A sidecar or other deployment component is needed when
  the scraper cannot reach loopback.
- **Neutral:** Logs, diagnostic capture, and required journal entries retain
  their current ownership and failure semantics. Metrics cannot establish that
  an operation was not performed, prove journal durability, or grade an agent's
  answer quality.

## Context and Problem Statement

Inspected Orbit commit `e01206f502eda9b6d99fb68211546de419cd8f9c` on
2026-09-26. `src/core/logs/records.ts` defines metadata-rich `LogRecord`s with
correlation IDs and optional duration and usage. `src/core/diagnostics/diagnostics.ts`
allows capture to be off and caps retained events. `src/core/execution/observer.ts`
isolates optional logger failures from execution, while `src/core/execution/run.ts`
computes final Run outcomes and separately acknowledges the required journal.
`src/core/application.ts` already provides event, log, and Run-snapshot
subscriptions, but subscriptions may replay or emit many updates for one Run;
counting snapshots or stored logs would risk duplicates or missed activity.
These claims come from source inspection and related tests, not a new runtime
trial.
The inspected tests were `test/core/logs.test.ts`,
`test/core/execution/run.test.ts`, and `test/apps/gui/server.test.ts`.

`src/apps/gui/server.ts` rejects non-loopback hosts and requires a capability
token for GUI/API requests. `docs/gui.md` describes the GUI as local-only.
The repository contains E2E Dockerfiles but no maintained Kubernetes
deployment contract. Consequently, a Prometheus endpoint alone does not make
the GUI a remotely accessible or production-qualified Kubernetes service.

The earlier [Session-scoped Logging Architecture](2026-08-25-session-scoped-logging.md)
explicitly left externally exported telemetry as follow-up work. This ADR adds
aggregate operational metrics without superseding that logging decision or the
[Required Execution Journal](2026-09-07-required-execution-journal.md).

## Decision Drivers

- Correctly count final outcomes despite retries, cancellation, cleanup, and
  recording failure.
- Keep observation optional and unable to change execution or journal results.
- Bound metric cardinality and prevent session content from leaving the process.
- Support embedded hosts and the local GUI without making GUI remote access a
  prerequisite.
- Match Prometheus exposition and naming rules with a maintained client library.
- Make a narrow first implementation testable on the current Node.js matrix.

## External Implementation Research

Investigation date: 2026-09-26. No Codex or Pi behavior was executed.

- **Codex:** The fixed [2026-05-07 commit
  `31b233c7c6883e23c8a1e1f9c4917fe638250522`](https://github.com/openai/codex/commit/31b233c7c6883e23c8a1e1f9c4917fe638250522)
  shows distinct log, trace, and metric exporter configuration in
  `codex-rs/config/src/types.rs`, plus OTLP loopback tests in
  `codex-rs/otel/tests/suite/otlp_http_loopback.rs`. Its
  [`codex-rs/otel/README.md`](https://github.com/openai/codex/blob/main/codex-rs/otel/README.md),
  inspected as current documentation rather than a pinned source snapshot,
  describes separate exporter wiring, session events, and in-memory metrics for
  tests. Adopt the separation of metric collection from session events and
  testable in-memory collection. Do not infer that Codex uses a Prometheus
  scrape endpoint or copy its telemetry fields or export defaults. The fixed
  commit establishes only the changes visible in that commit; the moving
  README supplies contextual documentation.
- **Pi Coding Agent:** At fixed commit
  [`b79e4cc834970cca69daebffab7df1da7d1e52c4`](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/agent/src/agent.ts),
  `packages/agent/src/agent.ts` exposes `subscribe()` for lifecycle events and
  awaits listeners in subscription order as part of Run settlement. An
  application could derive metrics from those events, but the inspected file
  does not establish a built-in Prometheus exporter. Orbit should retain its
  existing best-effort observer behavior rather than make a scraper or metrics
  listener part of Run settlement. This is a scoped comparison, not a claim
  about all Pi packages or later revisions.
- **Prometheus:** The official [client-library list](https://prometheus.io/docs/instrumenting/clientlibs/)
  identifies the maintained Node.js client. Its [instrumentation guidance](https://prometheus.io/docs/practices/instrumentation/)
  recommends counting completed operations consistently and limiting label
  cardinality. The [naming guidance](https://prometheus.io/docs/practices/naming/)
  favors application prefixes and base units; the [exposition specification](https://prometheus.io/docs/instrumenting/exposition_formats/)
  defines the scrape text format. These are format and design sources, not
  evidence that Orbit already exports metrics.

## Considered Options

| Option                                                                 | Benefit                                                               | Cost or reason not selected                                                                                                          |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Query session logs at scrape time                                      | Reuses stored records                                                 | Capture can be off, logs can be dropped or deleted, and correlation records are not a final-outcome counter.                         |
| Reconstruct metrics from the required journal                          | Uses durable evidence                                                 | Scrapes would need cross-session I/O and recovery semantics; a dashboard counter would become coupled to the safety-critical writer. |
| Add OpenTelemetry SDK and OTLP export first                            | Broad tracing and metric backend choice                               | More dependencies, lifecycle and semantic-convention choices than needed for the requested Prometheus trial.                         |
| Opt-in core metrics with a host-owned registry and loopback exposition | Counts at lifecycle boundaries and preserves the local security model | Selected proposal; a cluster scraper needs a sidecar or a separately reviewed exposure design.                                       |

## Implementation and Confirmation

No implementation has started. If accepted, introduce the small core observer
contract and instrument final Run settlement and provider/tool completion at
their owners. Implement an isolated Prometheus registry and a loopback
metrics-only server; wire the persistent GUI command behind explicit settings.
Keep the library path usable without starting an HTTP listener. Select and lock
the client release only after checking Node.js and ESM compatibility.

Tests should cover exactly-once terminal counting; completed, failed,
cancelled, budget-exceeded, and incomplete outcomes; active-gauge cleanup;
missing and reported token usage; duplicate snapshot emission; observer
exceptions; two services in one process; loopback-only binding; disabled-by-
default behavior; exposition headers and metric parsing; and shutdown. Run
`headers:check`, `build`, targeted tests, the complete test suite, and package
consumer checks as applicable. Inspect formatter output and unrelated working-
tree changes. A same-Pod sidecar scrape may demonstrate the deployment route,
but it does not qualify persistent storage, GUI remote access, or production
Kubernetes operation.

## Follow-up Work

- Decide separately whether Orbit needs OpenTelemetry traces or OTLP metrics.
- Specify and verify any non-loopback metrics exposure, authentication, network
  policy, TLS, and production Kubernetes manifest before claiming remote
  deployment support.
- Update the book's Chapter 15 only after the implementation is verified;
  describe the Prometheus path briefly and keep test and journal claims distinct.

## References

- [Current logging guide](../logging.md)
- [Current GUI guide](../gui.md)
- [Existing logging decision](2026-08-25-session-scoped-logging.md)
- [Required execution journal](2026-09-07-required-execution-journal.md)
- [Prometheus client libraries](https://prometheus.io/docs/instrumenting/clientlibs/)
- [Prometheus instrumentation](https://prometheus.io/docs/practices/instrumentation/)
- [Prometheus metric and label naming](https://prometheus.io/docs/practices/naming/)
- [Prometheus exposition formats](https://prometheus.io/docs/instrumenting/exposition_formats/)
