"""Result accounting tests with no Harbor installation or external services."""
import json
from pathlib import Path
import tempfile
import unittest

from e2e.terminal_bench.summarize import summarize
from e2e.terminal_bench.metrics import final_metrics, phase_usage, provider_cache_usage


class SummaryTests(unittest.TestCase):
    def test_cache_usage_is_known_only_with_complete_valid_provider_counts(self):
        event = {"type": "model.response.completed", "data": {"usage": {"inputTokens": 100, "outputTokens": 5},
                 "response": {"prompt_eval_cached_count": 70}}}
        events = [{"type": "model.request.started"}, event]
        self.assertEqual(provider_cache_usage(events), {
            "cacheUsageComplete": True, "cacheTokens": 70, "uncachedInputTokens": 30})
        for value in [None, -1, 101, True]:
            event["data"]["response"]["prompt_eval_cached_count"] = value
            self.assertIsNone(provider_cache_usage(events)["cacheTokens"])
        event["data"]["response"]["prompt_eval_cached_count"] = 0
        self.assertEqual(provider_cache_usage(events)["cacheTokens"], 0)
        self.assertFalse(provider_cache_usage(events + [{"type": "model.request.started"}])["cacheUsageComplete"])

    def test_recap_usage_keeps_its_phase_after_timeout(self):
        events = [{"type": "model.request.started"},
                  {"type": "model.response.completed", "data": {"usage": {"inputTokens": 10, "outputTokens": 5}}},
                  {"type": "context.summary.started"}, {"type": "model.request.started"},
                  {"type": "context.summary.failed"},
                  {"type": "model.response.completed", "data": {"usage": {"inputTokens": 50, "outputTokens": 20}}}]
        totals = phase_usage(events)
        self.assertEqual(totals["summaryInputTokens"], 50)
        self.assertEqual(totals["summaryOutputTokens"], 20)
        self.assertEqual(totals["workerInputTokens"], 10)
        self.assertEqual(totals["phaseResponsesAccounted"], 2)

    def test_final_logs_include_responses_after_the_runtime_snapshot(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "events.jsonl"
            events = [{"type": "model.request.started"},
                      {"type": "turn.cancelled"},
                      {"type": "model.response.completed", "data": {"usage": {"inputTokens": 10, "outputTokens": 5}}},
                      {"type": "context.summary.validation-failed"}, {"type": "context.summary.truncated"}]
            path.write_text("\n".join(json.dumps(e) for e in events))
            metrics = final_metrics(path)
            self.assertTrue(metrics["usageComplete"])
            self.assertEqual(metrics["inputTokens"], 10)
            self.assertEqual(metrics["summaryValidationFailures"], 1)
            self.assertEqual(metrics["summaryTruncations"], 1)
            path.write_text(json.dumps({"type": "model.request.started"}))
            self.assertFalse(final_metrics(path)["usageComplete"])
            self.assertIsNone(final_metrics(path)["peakInputTokens"])

    def test_missing_and_failed_trials_stay_in_the_plan(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config = {"jobs_dir": str(root), "job_name": "job", "agents": [{"name": "nop"}],
                      "tasks": [{"path": "/dataset/first"}, {"path": "/dataset/missing"}]}
            path = root / "config.json"
            path.write_text(json.dumps(config))
            trial = root / "job" / "first__trial"
            trial.mkdir(parents=True)
            (trial / "result.json").write_text(json.dumps({
                "config": {"task": config["tasks"][0]},
                "exception_info": {"exception_type": "SetupError"}}))
            rows = summarize(path)
            self.assertEqual(len(rows), 2)
            self.assertTrue(rows[0]["recorded"])
            self.assertEqual(rows[0]["exceptionType"], "SetupError")
            self.assertIsNone(rows[0]["reward"])
            self.assertFalse(rows[1]["recorded"])
            self.assertIsNone(rows[1]["metrics"])


if __name__ == "__main__":
    unittest.main()
