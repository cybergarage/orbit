"""Account from final logs, including provider responses settling after Run timeout."""
from collections import Counter
import json


def final_metrics(path):
    events = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    counts = Counter(event["type"] for event in events)
    responses = [event.get("data", {}).get("usage") or {} for event in events
                 if event["type"] == "model.response.completed"]
    known = [usage for usage in responses if all(type(usage.get(key)) is int and
             0 <= usage[key] <= 2**53 - 1 for key in ("inputTokens", "outputTokens"))]
    actions = [json.dumps({key: event.get("data", {}).get(key) for key in ("name", "input")}, sort_keys=True)
               for event in events if event["type"] == "tool.started"]
    return {
        "accountingSource": "final-events", "modelCallsStarted": counts["model.request.started"],
        "modelCallsCompleted": len(responses),
        "usageComplete": counts["model.request.started"] == len(responses) == len(known),
        "inputTokens": sum(usage["inputTokens"] for usage in known),
        "outputTokens": sum(usage["outputTokens"] for usage in known),
        "peakInputTokens": max((usage["inputTokens"] for usage in known), default=None),
        "cacheTokens": None, "billedCostUSD": None,
        "compactions": counts["context.compaction.completed"],
        "compactionFailures": counts["context.compaction.failed"],
        "summaryAttempts": counts["context.summary.started"],
        "summaryFailures": counts["context.summary.failed"],
        "summaryValidationFailures": counts["context.summary.validation-failed"],
        "toolCalls": len(actions), "identicalRepeatedToolCalls": len(actions) - len(set(actions)),
    }
