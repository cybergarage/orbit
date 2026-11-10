"""Account from final logs, including provider responses settling after Run timeout."""
from collections import Counter
import json

MODEL_REQUEST_STARTED = "model.request.started"
MODEL_RESPONSE_COMPLETED = "model.response.completed"


def valid_usage(usage):
    return all(type(usage.get(key)) is int and 0 <= usage[key] <= 2**53 - 1
               for key in ("inputTokens", "outputTokens"))


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
            usage = event.get("data", {}).get("usage") or {}
            if kind == MODEL_RESPONSE_COMPLETED and phase and valid_usage(usage):
                totals[phase]["input"] += usage["inputTokens"]
                totals[phase]["output"] += usage["outputTokens"]
                classified += 1
    return {"summaryInputTokens": totals["summary"]["input"], "summaryOutputTokens": totals["summary"]["output"],
            "workerInputTokens": totals["worker"]["input"], "workerOutputTokens": totals["worker"]["output"],
            "phaseResponsesAccounted": classified}


def final_metrics(path):
    events = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    counts = Counter(event["type"] for event in events)
    responses = [event.get("data", {}).get("usage") or {} for event in events
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
        "cacheTokens": None, "billedCostUSD": None,
        "compactions": counts["context.compaction.completed"],
        "compactionFailures": counts["context.compaction.failed"],
        "summaryAttempts": counts["context.summary.started"],
        "summaryFailures": counts["context.summary.failed"],
        "summaryValidationFailures": counts["context.summary.validation-failed"],
        "summaryTruncations": counts["context.summary.truncated"],
        "toolCalls": len(actions), "identicalRepeatedToolCalls": len(actions) - len(set(actions)),
    }
