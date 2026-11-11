"""Run a prebuilt, hash-verified Orbit bundle inside a Harbor task environment."""

import hashlib
import json
import os
import shlex
from pathlib import Path

from harbor.agents.installed.base import BaseInstalledAgent, NonZeroAgentExitCodeError
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext
from e2e.terminal_bench.metrics import final_metrics


RESULT_FILE = "result.json"
EVENTS_FILE = "events.jsonl"


class OrbitAgent(BaseInstalledAgent):
    skip_model_parsing = True

    @staticmethod
    def name() -> str:
        return "orbit-local"

    def __init__(self, *args, bundle: str, bundle_sha256: str, arm: str = "suffix",
                 endpoint: str = "http://host.docker.internal:11434", seed: int = 42,
                 elapsed_sec: int = 300, provider: str = "ollama", model_calls: int | None = None,
                 window: int = 16384, trigger: int = 12288, target: int = 8192,
                 output_tokens: int = 2048, **kwargs):
        super().__init__(*args, **kwargs)
        if provider not in ("ollama", "openai", "anthropic"):
            raise ValueError("Unsupported evaluation provider")
        if provider != "ollama" and (not self.model_name or model_calls is None or not 1 <= model_calls <= 100):
            raise ValueError("Cloud evaluation requires an explicit model and 1-100 model calls")
        if not 0 < target < trigger <= window - output_tokens - 256 or output_tokens < 1:
            raise ValueError("Invalid context budgets")
        self.provider, self.model_calls = provider, model_calls
        self.window, self.trigger, self.target, self.output_tokens = window, trigger, target, output_tokens
        self.bundle = Path(bundle).resolve()
        self.bundle_sha256 = bundle_sha256
        self.arm, self.endpoint = arm, endpoint
        self.seed, self.elapsed_sec = int(seed), int(elapsed_sec)
        if self.elapsed_sec <= 0 or self.elapsed_sec > 900:
            raise ValueError("elapsed_sec must be between 1 and 900")
        with self.bundle.open("rb") as archive:
            actual_digest = hashlib.file_digest(archive, "sha256").hexdigest()
        if actual_digest != bundle_sha256:
            raise ValueError("Orbit bundle digest mismatch")

    async def install(self, environment: BaseEnvironment) -> None:
        await environment.upload_file(self.bundle, "/installed-agent/orbit-bundle.tar.gz")
        result = await self.exec_as_root(environment, command=(
            "test \"$(uname -m)\" = x86_64 && "
            f"echo {shlex.quote(self.bundle_sha256 + '  /installed-agent/orbit-bundle.tar.gz')} | sha256sum -c - && "
            "mkdir -p /installed-agent/orbit && "
            "tar -xzf /installed-agent/orbit-bundle.tar.gz -C /installed-agent/orbit && "
            "command -v timeout >/dev/null && /installed-agent/orbit/bin/node --version"
        ))
        if result.return_code != 0:
            raise RuntimeError("Orbit bundle installation failed: " + (result.stderr or ""))

    async def run(self, instruction: str, environment: BaseEnvironment, context: AgentContext) -> None:
        cwd = await self.exec_as_agent(environment, command="pwd")
        if cwd.return_code != 0 or not cwd.stdout.strip().startswith("/"):
            raise RuntimeError("Cannot discover task working directory")
        config = {
            "model": self.model_name, "provider": self.provider, "modelCalls": self.model_calls,
            "credentialFile": "/installed-agent/orbit-credential/key",
            "compactionBudgets": {"window": self.window, "trigger": self.trigger, "target": self.target,
                                  "outputReserve": self.output_tokens},
            "prompt": instruction + "\n\nWork only from the supplied task and environment. Do not retrieve solutions or inspect verifier files. Verify your work before finishing.",
            "ollamaHost": self.endpoint, "strategy": "baseline", "compactionArm": self.arm,
            "executionActionMode": "single", "toolset": "bash", "think": False,
            "options": {"num_ctx": self.window, "num_predict": self.output_tokens, "temperature": 0.6, "top_p": 0.95, "seed": self.seed},
            "rounds": "unlimited", "timeoutMs": self.elapsed_sec * 1000,
            "workspace": cwd.stdout.strip(), "copyFixture": False,
            "outputDirectory": str(self.environment_logs_dir),
        }
        local = self.logs_dir / "orbit-config.json"
        local.write_text(json.dumps(config))
        remote = str(self.environment_logs_dir / "orbit-config.json")
        await environment.upload_file(local, remote)
        secret_path = "/installed-agent/orbit-credential/key"
        try:
            if self.provider != "ollama":
                key = os.environ.get(f"ORBIT_TEST_{self.provider.upper()}_API_KEY", "")
                if not key.strip():
                    raise ValueError("Missing dedicated cloud evaluation credential")
                await self.exec_as_root(environment, command="mkdir -p /installed-agent/orbit-credential && chmod 700 /installed-agent/orbit-credential")
                if environment.default_user:
                    await self.exec_as_root(environment, command=f"chown {shlex.quote(environment.default_user)} /installed-agent/orbit-credential")
                await self._upload_config_text(environment, content=key, remote_path=secret_path, filename="key")
                await self.exec_as_root(environment, command=f"chmod 600 {secret_path}")
            result = await self.exec_as_agent(environment, command=(
                f"timeout --signal=TERM --kill-after=5s {self.elapsed_sec + 30}s "
                "/installed-agent/orbit/bin/node /installed-agent/orbit/e2e/worker.mjs "
                f"{shlex.quote(remote)} > {shlex.quote(str(self.environment_logs_dir / 'console.log'))} 2>&1"
            ), timeout_sec=self.elapsed_sec + 40)
        finally:
            if self.provider != "ollama":
                await self.exec_as_root(environment, command=f"rm -f {secret_path}")
        # A failed Orbit Run still reaches Harbor's verifier; keep execution and quality separate.
        context.metadata = {"process_exit_code": result.return_code, "arm": self.arm, "bundle_sha256": self.bundle_sha256}
        if result.return_code != 0:
            raise NonZeroAgentExitCodeError("Orbit worker exited without a normal result")
        # Harbor only invokes its post-run hook for an entirely empty context.
        await environment.download_file(str(self.environment_logs_dir / RESULT_FILE), self.logs_dir / RESULT_FILE)
        await environment.download_file(str(self.environment_logs_dir / EVENTS_FILE), self.logs_dir / EVENTS_FILE)
        self.populate_context_post_run(context)

    def populate_context_post_run(self, context: AgentContext) -> None:
        result_path = self.logs_dir / RESULT_FILE
        if not result_path.exists():
            return
        result = json.loads(result_path.read_text())
        events = self.logs_dir / EVENTS_FILE
        metrics = final_metrics(events) if events.exists() else result.get("evaluation", {})
        context.metadata = {"arm": self.arm, "bundle_sha256": self.bundle_sha256,
                            **(context.metadata or {}), "orbit_runtime": result.get("runtime"), "evaluation": metrics}
        if metrics.get("usageComplete"):
            context.n_input_tokens = metrics["inputTokens"]
            context.n_output_tokens = metrics["outputTokens"]
        if metrics.get("cacheUsageComplete"):
            context.n_cache_tokens = metrics["cacheTokens"]
        # Local provider usage does not establish a billed monetary cost.
