"""Account from final logs, including provider responses settling after Run timeout."""
from collections import Counter
import json

MODEL_REQUEST_STARTED = "model.request.started"
MODEL_RESPONSE_COMPLETED = "model.response.completed"


def valid_usage(usage):
    return all(type(usage.get(key)) is int and 0 <= usage[key] <= 2**53 - 1
               for key in ("inputTokens", "outputTokens"))


def canonical_usage(data):
    usage = dict(data.get("usage") or {})
    if data.get("provider") == "anthropic":
        raw = (data.get("response") or {}).get("usage") or {}
        cached = raw.get("cache_read_input_tokens")
        created = raw.get("cache_creation_input_tokens")
        if valid_usage(usage) and all(type(v) is int and v >= 0 for v in (cached, created)):
            usage["inputTokens"] += cached + created
        else:
            return {}
    return usage


def phase_usage(events):
    """Pair serial requests with responses; a late response keeps its original phase."""
    pending = []
    next_phase = "worker"
    totals = {"summary": {"input": 0, "output": 0}, "worker": {"input": 0, "output": 0}}
    classified = 0
    for event in events:
        kind = event["type"]
        if kind == "context.summary.started":
            next_phase = "summary"
        elif kind in ("context.summary.failed", "context.summary.completed"):
            next_phase = "worker"
        elif kind == MODEL_REQUEST_STARTED:
            pending.append(next_phase)
            next_phase = "worker"
        elif kind in (MODEL_RESPONSE_COMPLETED, "model.response.failed"):
            phase = pending.pop(0) if pending else None
            usage = canonical_usage(event.get("data", {}))
            if kind == MODEL_RESPONSE_COMPLETED and phase and valid_usage(usage):
                totals[phase]["input"] += usage["inputTokens"]
                totals[phase]["output"] += usage["outputTokens"]
                classified += 1
    return {"summaryInputTokens": totals["summary"]["input"], "summaryOutputTokens": totals["summary"]["output"],
            "workerInputTokens": totals["worker"]["input"], "workerOutputTokens": totals["worker"]["output"],
            "phaseResponsesAccounted": classified}


def provider_cache_usage(events):
    """Normalize provider-specific cache reads; missing fields remain unknown."""
    responses = [event.get("data", {}) for event in events if event["type"] == MODEL_RESPONSE_COMPLETED]
    cached = []
    uncached = []
    for data in responses:
        usage = canonical_usage(data)
        response = data.get("response") or {}
        if data.get("provider") == "openai":
            value = ((response.get("usage") or {}).get("prompt_tokens_details") or {}).get("cached_tokens")
        elif data.get("provider") == "anthropic":
            value = (response.get("usage") or {}).get("cache_read_input_tokens")
        else:
            value = response.get("prompt_eval_cached_count")
        if valid_usage(usage) and type(value) is int and 0 <= value <= usage["inputTokens"]:
            cached.append(value)
            writes = (response.get("usage") or {}).get("cache_creation_input_tokens", 0) if data.get("provider") == "anthropic" else 0
            uncached.append(usage["inputTokens"] - value - writes)
    starts = sum(event["type"] == MODEL_REQUEST_STARTED for event in events)
    complete = starts == len(responses) == len(cached)
    total = sum(cached) if complete else None
    return {"cacheUsageComplete": complete, "cacheTokens": total,
            "uncachedInputTokens": sum(uncached) if complete else None}


def final_metrics(path):
    events = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    counts = Counter(event["type"] for event in events)
    responses = [canonical_usage(event.get("data", {})) for event in events
                 if event["type"] == MODEL_RESPONSE_COMPLETED]
    known = [usage for usage in responses if valid_usage(usage)]
    actions = [json.dumps({key: event.get("data", {}).get(key) for key in ("name", "input")}, sort_keys=True)
               for event in events if event["type"] == "tool.started"]
    return {
        **phase_usage(events),
        "accountingSource": "final-events", "modelCallsStarted": counts[MODEL_REQUEST_STARTED],
        "modelCallsCompleted": len(responses),
        "usageComplete": counts[MODEL_REQUEST_STARTED] == len(responses) == len(known),
        "inputTokens": sum(usage["inputTokens"] for usage in known),
        "outputTokens": sum(usage["outputTokens"] for usage in known),
        "peakInputTokens": max((usage["inputTokens"] for usage in known), default=None),
        **provider_cache_usage(events), "billedCostUSD": None,
        "compactions": counts["context.compaction.completed"],
        "compactionFailures": counts["context.compaction.failed"],
        "summaryAttempts": counts["context.summary.started"],
        "summaryFailures": counts["context.summary.failed"],
        "summaryValidationFailures": counts["context.summary.validation-failed"],
        "summaryTruncations": counts["context.summary.truncated"],
        "toolCalls": len(actions), "identicalRepeatedToolCalls": len(actions) - len(set(actions)),
    }
