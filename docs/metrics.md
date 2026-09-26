# Prometheus metrics

Orbit can collect process-local operational metrics for managed Runs, model
requests and tool calls. Collection is opt-in. Metrics do not contain prompts,
responses, tool arguments, session IDs, Run IDs, paths or arbitrary model and
tool names. They do not replace session logs or the required execution journal.

## Local GUI

Start a separate loopback metrics listener with an explicit port:

```sh
./bin/run.js gui --metrics-port 4101
```

The command prints `Orbit metrics: http://127.0.0.1:4101/metrics`. Only
`GET /metrics` is served on that listener. The GUI remains on its separate
token-protected loopback URL. Neither listener accepts a non-loopback bind.
Stop the GUI to close both listeners. The metrics listener is disabled when
`--metrics-port` is absent.

An application embedding Orbit can create a `PrometheusOperationalMetrics`
instance, pass it as `metrics` to `OrbitApplicationService` or `Agent`, and
serve `await metrics.render()` with `metrics.contentType` through its own HTTP
server. Use one instance per application service. A caller-supplied metrics
observer is best effort: exceptions do not change the Run outcome.

## Metric meanings

| Metric | Meaning |
| --- | --- |
| `orbit_runs_active` | Runs admitted but not yet returned a terminal result. Quarantined operations after an incomplete result are excluded. |
| `orbit_runs_total{outcome}` | Terminal Runs, including failed or incomplete results. Repeated snapshots and duplicate requests do not increment it. |
| `orbit_run_duration_seconds{outcome}` | Time from admission to terminal result, including cleanup. |
| `orbit_model_requests_total{outcome}` | Completed or failed provider attempts. A retry is a second attempt. |
| `orbit_tool_calls_total{outcome}` | Completed dispatches and dispatched calls returning an error. A denied, undispatched operation is excluded. |
| `orbit_model_tokens_total{direction}` | Provider-reported input or output tokens from completed responses. Missing usage is not counted as zero. |

All counters reset when the process restarts. The fixed labels have bounded
values; no session or user identity is exported. A missing series does not
prove that an operation did not run. Metrics collection is optional and cannot
provide journal durability or quality scores for an agent's answer.

The listener is intended for local scraping. A collector sidecar in the same
Kubernetes Pod can reach its loopback address. Cluster-wide access, TLS,
authentication, network policy, persistent session storage and remote GUI
access need a separate deployment design and verification.

See the [Prometheus Operational Metrics ADR](adr/2026-09-26-prometheus-operational-metrics.md)
for the rationale and scope.
