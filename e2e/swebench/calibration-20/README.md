# Cloud calibration SWE-bench selection

These ten Verified cases were selected before gold controls or cloud model runs
for the [64-call calibration protocol](../../cloud-calibration-20.json).

Use the existing supported repository/version environments: Django 4.2,
pytest 7.2 and Sphinx 5.0. Exclude all six previously selected IDs in the parent
directory. Include the one remaining pytest case and one remaining Sphinx case;
select eight Django cases by ascending SHA-256 of
`orbit-cloud-calibration-20-v1:<instance_id>`. Selection reads only instance ID,
repository, version and base commit. It does not use patches, tests, difficulty,
gold results or model results. Official image digests are pinned before grading.

This is a convenience sample dominated by Django, not a random sample of
Verified or a model-quality qualification. Retain unsuccessful controls and do
not silently replace tasks. Exclude calibration tasks from later held-out
quality claims. Gold patches and hidden tests remain in ignored host-only data.
