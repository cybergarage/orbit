# Verified diagnostic sample

This sample was fixed before reference grading or model execution on 2026-09-25.
It is three problems, not the complete Verified benchmark. None of the selected
IDs is in Lite revision `6ec7bb89b9342f664a54a6e0a6ea6501d3437cc2`.

Selection: choose Django 4.2, pytest 7.2 and Sphinx 5.0 to span three repositories
with Python 3-era source and manageable local dependencies. For each chosen
repository/version, sort Verified instance IDs lexicographically and take the
first. Selection used repository/version/ID metadata and public issue previews,
not reference patch contents, hidden tests, gold outcomes or solver outcomes.
The version choice is a convenience sample, not random or representative.

Each JSON pins the dataset revision, base commit and official image digest.
`imageTag` records the discovery tag only; execution uses `image` by digest.
Private dataset rows (including reference/test patches) stay in ignored
`tmp/e2e/verified/<instance_id>/instance.json`, never in the solver image/mounts.

See [the operating guide](../../docs/e2e-evaluation.md) for execution.
Tracked reports, summaries and generated patches are indexed in
[`e2e/results/`](../results/README.md); raw workspaces, logs and private dataset
rows remain ignored under `tmp/e2e/`. The September 26 follow-up adds three
instances from these same supported repository versions; they are diagnostic
samples, not a representative Verified score.
