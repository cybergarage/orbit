# Retaining the expanded summary allowance — live diagnostic, 2026-09-29

Orbit now retains `outputReserve` when correcting an empty or incomplete response that was generated after output expansion. It re-estimates the corrected prompt against that allowance's input budget and does not retry a known exhausted smaller output allowance. A length failure at the reserve proceeds to the existing smaller complete-group path. Correction feedback is preserved during expansion. This local recovery fix changes no public API, persistence format or authorization rule and needs no new ADR.

Core commit: `f7d7fe496e4052a49783fd0b26145349da9dc4e5`. Headers and build passed, full suite **1,059 tests**, compaction suite **56**, host checks **19**, direct checker **4**, semantic checks **11**. New deterministic cases cover allowance sequencing, unchanged original source, corrective input-budget refusal and splitting after corrective exhaustion. Existing deadline, cancellation and model-call budget tests remain passing. There is no agent round cap.

| Condition | Summary allowances | Compaction | Estimated tokens | Direct observations | Runtime |
| --- | --- | --- | --- | --- | --- |
| Natural output | 2048 | 46.96 s | 10,066 → 1,222 | Pass, 2/2 saves | Completed, quiescent |
| Injected truncation, then missing category; retry | 2048 → 4096 → 4096 | 42.04 s | 10,066 → 1,221 | Pass, 2/2 saves | Completed, quiescent |

The second row injects the first two summary responses; the third summary and consumer use actual `ornith-1.5:9b`. These two injected responses consume core invocations but have no provider tokens. The consumer reports both acknowledged saves and no tests/behavioral verification. Provider input/output totals were **12,247/756** and **12,311/778**. The prompt contract uses existing JSON mode, not provider-enforced JSON Schema. A format-valid summary alone is not proof of semantic accuracy.

The first injected-condition attempt is also retained as an **environment error**. Docker disconnected with unexpected EOF and the container exited 255 (`OOMKilled=false`). After Docker recovered, logs were copied and the stopped container removed. The logs show correction at 4096, a real 4096 response truncated after 201.42 seconds, then smaller-source recovery. No final result was written; the recovered event file contains an invalid partial line. This attempt is not a successful runtime, and incomplete events cannot establish final quiescence or usage. No cause for the Docker restart has been established. The successful row is a fresh retry, not a replacement that hides the interrupted attempt.

These are single controlled diagnostics with different source UUIDs and host conditions. The timing difference is not a causal performance comparison or a SWE-bench success-rate estimate. The independent checker verifies derived-record correspondence; current file state and behavioral correctness remain separate facts.

[Curated JSON](2026-09-29-summary-output-allowance-live.json) records accepted summaries, answers, requests, the interrupted attempt, full commit, image, model identity and generation settings. Model digest `e5df7dcdd8a263994df62d610317e07be0d6af23f96fcbd8543273058fce575e`, Q4_K_M, Ollama 0.34.4; context 32,768; summary 2,048; reserve 2,048 normally / 4,096 for the expanded condition; seed 42, temperature 0.6, top-p 0.95, thinking disabled. Docker 29.8.0 ARM64, 4,107,141,120 bytes VM memory. Each diagnostic uses a fresh persistent Session, workspace and disposable container, with a 300-second deadline.

## Reproduction

Follow the [live reopened diagnostic](../../docs/e2e-evaluation.md#live-reopened-projection-diagnostic) on this commit. Run once without a fault, then in a new container/output directory with `-e ORBIT_E2E_SUMMARY_FAULT=expanded-missing`. Copy `/output` before removing the container and run the direct checker. Inspect allowances, validation feedback, checkpoint activation, source correspondence and runtime independently. Keep interrupted attempts and retry identities separate. Raw journals and private paths remain ignored under `tmp/e2e/`.
