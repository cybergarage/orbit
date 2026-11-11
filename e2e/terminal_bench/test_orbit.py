"""Adapter boundary tests; require the pinned Harbor environment, never a model."""
import hashlib
import json
import shlex
import shutil
import subprocess
import time
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from harbor.models.agent.context import AgentContext
from harbor.agents.installed.base import NonZeroAgentExitCodeError
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

    @unittest.skipUnless(shutil.which("timeout"), "GNU timeout is required")
    def test_deadline_kills_term_ignoring_descendants_before_grading(self):
        marker = self.root / "late-write"
        command = 'trap "" TERM; sleep 3; touch ' + shlex.quote(str(marker))
        result = subprocess.run(["timeout", "--signal=TERM", "--kill-after=1s", "1s",
                                 "bash", "-c", command], capture_output=True, timeout=10)
        self.assertIn(result.returncode, [-9, 137])
        time.sleep(2)
        self.assertFalse(marker.exists())

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
        environment = SimpleNamespace(default_user="agent", upload_file=AsyncMock(), download_file=AsyncMock())
        context = AgentContext()
        await agent.run("Fix the task.", environment, context)
        config = json.loads((self.root / "orbit-config.json").read_text())
        self.assertEqual(config["workspace"], "/task dir")
        self.assertFalse(config["copyFixture"])
        self.assertEqual(config["toolset"], "bash")
        self.assertEqual(config["executionActionMode"], "single")
        self.assertEqual(config["compactionArm"], "sac")
        self.assertEqual(context.metadata["process_exit_code"], 0)
        self.assertEqual(environment.download_file.await_count, 2)
        command = agent.exec_as_agent.call_args.kwargs
        self.assertIn("timeout --signal=TERM --kill-after=5s 330s", command["command"])
        self.assertEqual(command["timeout_sec"], 340)

    async def test_cloud_credentials_are_not_in_configuration_or_commands(self):
        agent = self.agent(provider="openai", model_calls=16, window=32768, output_tokens=4096)
        agent.exec_as_agent = AsyncMock(side_effect=[SimpleNamespace(return_code=0, stdout="/app\n"), SimpleNamespace(return_code=0)])
        agent.exec_as_root = AsyncMock()
        agent._upload_config_text = AsyncMock()
        environment = SimpleNamespace(default_user="agent", upload_file=AsyncMock(), download_file=AsyncMock())
        with patch.dict("os.environ", {"ORBIT_TEST_OPENAI_API_KEY": "fake-private-key"}):
            await agent.run("Task", environment, AgentContext())
        config = (self.root / "orbit-config.json").read_text()
        self.assertNotIn("fake-private-key", config)
        self.assertEqual(json.loads(config)["modelCalls"], 16)
        self.assertEqual(agent._upload_config_text.call_args.kwargs["content"], "fake-private-key")
        self.assertNotIn("fake-private-key", str(agent.exec_as_agent.call_args_list))
        self.assertIn("rm -f", agent.exec_as_root.call_args.kwargs["command"])

    def test_cloud_requires_explicit_call_limit(self):
        with self.assertRaisesRegex(ValueError, "model calls"):
            self.agent(provider="openai")

    async def test_worker_crash_is_explicit_and_allows_harbor_verification(self):
        agent = self.agent()
        agent.exec_as_agent = AsyncMock(side_effect=[
            SimpleNamespace(return_code=0, stdout="/app\n"),
            SimpleNamespace(return_code=1),
        ])
        with self.assertRaisesRegex(NonZeroAgentExitCodeError, "normal result"):
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
        events = [{"type": "model.request.started"}, {"type": "model.response.completed", "data": {
            "usage": {"inputTokens": 10, "outputTokens": 3}, "response": {"prompt_eval_cached_count": 7}}}]
        (self.root / "events.jsonl").write_text("\n".join(json.dumps(event) for event in events))
        agent.populate_context_post_run(context)
        self.assertEqual(context.n_cache_tokens, 7)
        self.assertEqual(context.n_input_tokens, 10)


if __name__ == "__main__":
    unittest.main()
