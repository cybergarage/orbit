# Live reopened observation projection — 2026-09-29

The real `ornith-1.5:9b` model completed a forced compaction after reopening a
persistent Session. The deterministic view retained **both acknowledged saves**;
the direct source-correspondence check passed (one view, two records). This is a
controlled runtime diagnostic, not a coding benchmark.

| Check                  | Observed result                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------- |
| Setup                  | Fixed model executes two actual built-in writes, one byte each, with a reused call ID |
| Persistence            | Version-2 Session closed and reopened before real-model compaction                    |
| Compaction             | Completed in 38.84 s; estimated request tokens 10,066 → 1,140                         |
| Independent view check | Pass, 2/2 records match canonical tool results; no omissions/unknown results          |
| Consumer               | Reports both acknowledged saves and explicitly avoids behavioral verification claims  |
| Runtime                | Completed, quiescent, no unresolved operations or cleanup errors                      |
| Model usage            | 12,016 input / 709 output tokens across summary and consumer                          |

[Curated measurements and answer](2026-09-29-core-observations-live.json) record
core source commit `912e210`, exact image ID, model digest, generation settings,
source IDs and result hashes. The host Ollama version was 0.34.4; the model used
Q4_K_M, context 32,768, output 2,048, seed 42, temperature 0.6, top-p 0.95 and
thinking disabled. Diagnostic trigger/target were **3,500/2,500**, deliberately
lower than production thresholds.

The direct checker verifies correspondence with controlled artifacts. Core
itself checks reopened journal evidence before projection; the Python checker
is not a separate cryptographic journal verifier. The model summary's cited IDs
all exist, but membership does not prove semantic entailment. Successful saves
mean acknowledgement at the recorded operations, not guaranteed current file
contents or passing tests.

The first driver attempt failed before inference because its fixed model
reported an unsupported provider identifier; `fcc69cb` corrected the fixture.
The successful driver read `result.answer` prematurely; the answer above was
recovered from the matching completed-response event. `4244fee` corrects that
capture order. Neither correction changes the core or the successful projected
view. Raw journals and runtime proofs remain under ignored local `tmp/`, not in
this curated report.

## Reproduction

Build the current local image and run the diagnostic serially with other Ollama
jobs. Use a fresh container name and an empty diagnostic output directory:

```sh
docker build -f e2e/Dockerfile -t orbit-e2e:local .
mkdir -p tmp/e2e/observations-live-replay
docker run --name orbit-observations-live-replay --user node \
  -v "$PWD/e2e/observations-live.mjs:/opt/orbit/e2e/observations-live.mjs:ro" \
  orbit-e2e:local node /opt/orbit/e2e/observations-live.mjs
docker cp orbit-observations-live-replay:/output/. tmp/e2e/observations-live-replay/
docker rm orbit-observations-live-replay
python3 e2e/core_observations.py \
  --result tmp/e2e/observations-live-replay/observations-live/result.json \
  --events tmp/e2e/observations-live-replay/observations-live/events.jsonl \
  --output tmp/e2e/observations-live-replay/check.json
```

Preserve container output before removal even on failure. The model is fixed
in this diagnostic driver. It executes real writes in `/workspace`, never the
host repository. The real-model phase has no tools and a five-minute deadline.
See [the evaluation guide](../../docs/e2e-evaluation.md) and
[the frozen-checkpoint comparisons](2026-09-29-core-observations-replay.md) for
the other measurement scopes.
