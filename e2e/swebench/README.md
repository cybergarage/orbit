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
The local report `e2e/results/2026-09-25-verified.md` records all planned outcomes
when retained. Results and generated patches are ignored by Git and must be
preserved separately; these manifests contain the inputs needed to rerun cases.
