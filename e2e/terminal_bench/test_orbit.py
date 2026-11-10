"""Adapter boundary tests; require the pinned Harbor environment, never a model."""
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from harbor.models.agent.context import AgentContext
from e2e.terminal_bench.orbit import OrbitAgent
from e2e.terminal_bench.job import make_job, SOURCE


class OrbitAdapterTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bundle = self.root / "bundle.tar.gz"
        self.bundle.write_bytes(b"test bundle")
        self.digest = hashlib.sha256(b"test bundle").hexdigest()

    def agent(self, **overrides):
        return OrbitAgent(logs_dir=self.root, model_name="fake-model",
                          bundle=str(self.bundle), bundle_sha256=self.digest, **overrides)

    def test_rejects_changed_bundle_and_invalid_elapsed(self):
        self.bundle.write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "digest mismatch"):
            self.agent()
        with self.assertRaisesRegex(ValueError, "elapsed_sec"):
            self.agent(elapsed_sec=0)

    async def test_run_uses_task_workspace_and_single_bash_action(self):
        agent = self.agent(arm="sac")
        agent.exec_as_agent = AsyncMock(side_effect=[
            SimpleNamespace(return_code=0, stdout="/task dir\n"),
            SimpleNamespace(return_code=0),
        ])
        environment = SimpleNamespace(upload_file=AsyncMock(), download_file=AsyncMock())
        context = AgentContext()
        await agent.run("Fix the task.", environment, context)
        config = json.loads((self.root / "orbit-config.json").read_text())
        self.assertEqual(config["workspace"], "/task dir")
        self.assertFalse(config["copyFixture"])
        self.assertEqual(config["toolset"], "bash")
        self.assertEqual(config["executionActionMode"], "single")
        self.assertEqual(config["compactionArm"], "sac")
        self.assertEqual(context.metadata["process_exit_code"], 0)
        environment.download_file.assert_awaited_once()

    async def test_worker_crash_is_infrastructure_failure(self):
        agent = self.agent()
        agent.exec_as_agent = AsyncMock(side_effect=[
            SimpleNamespace(return_code=0, stdout="/app\n"),
            SimpleNamespace(return_code=1),
        ])
        with self.assertRaisesRegex(RuntimeError, "normal result"):
            await agent.run("Task", SimpleNamespace(upload_file=AsyncMock()), AgentContext())

    def test_job_rejects_changed_dataset_and_keeps_serial_no_retry_configuration(self):
        (self.root / "manifest.json").write_text(json.dumps({"bundleSha256": self.digest}))
        args = (self.root, self.root, "fixture", ["fix-git"], "suffix", "fake-model", 42, 300)
        with patch("e2e.terminal_bench.job.subprocess.check_output", side_effect=["wrong"]):
            with self.assertRaisesRegex(ValueError, "revision mismatch"):
                make_job(*args)
        with patch("e2e.terminal_bench.job.subprocess.check_output", side_effect=[SOURCE["datasetCommit"], "dirty"]):
            with self.assertRaisesRegex(ValueError, "local modifications"):
                make_job(*args)
        with patch("e2e.terminal_bench.job.subprocess.check_output", side_effect=[SOURCE["datasetCommit"], ""]):
            config = make_job(*args)
        self.assertEqual(config["n_attempts"], 1)
        self.assertEqual(config["n_concurrent_trials"], 1)
        self.assertEqual(config["retry"]["max_retries"], 0)

    def test_partial_usage_does_not_become_complete_accounting(self):
        agent = self.agent()
        context = AgentContext()
        (self.root / "result.json").write_text(json.dumps({
            "evaluation": {"usageComplete": False, "inputTokens": 10, "outputTokens": 3}}))
        agent.populate_context_post_run(context)
        self.assertIsNone(context.n_input_tokens)
        self.assertIsNone(context.cost_usd)
        (self.root / "result.json").write_text(json.dumps({
            "evaluation": {"usageComplete": True, "inputTokens": 10, "outputTokens": 3}}))
        agent.populate_context_post_run(context)
        self.assertEqual(context.n_input_tokens, 10)
        self.assertEqual(context.n_output_tokens, 3)
        self.assertIsNone(context.n_cache_tokens)


if __name__ == "__main__":
    unittest.main()
