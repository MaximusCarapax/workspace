# Self-Observation System - Instrumentation Guide

## Overview

The self-observation system passively captures behavioral signals during normal operation. This document describes where and how to instrument code paths.

**Key Principle:** No extra API calls. All logging uses the existing `logActivity` function.

## Quick Start

```javascript
const selfObs = require('./lib/self-observation');

// Log a completed task
selfObs.logTaskPreference({
  taskType: 'coding',
  outcome: 'completed',
  durationMs: 45000,
  notes: 'Built new feature'
});

// Log an autonomous decision
selfObs.logAutonomousAction({
  action: 'committed code changes',
  reason: 'low risk, routine operation',
  riskLevel: 'low'
});
```

## Activity Types

| Category | Purpose | Example Signals |
|----------|---------|-----------------|
| `self_obs_task_preference` | Track what tasks I gravitate toward/avoid | Task completed, delegated, deferred |
| `self_obs_communication` | Track communication patterns | Response time, message length, tone |
| `self_obs_decision` | Track decision-making style | Autonomous vs asked permission |
| `self_obs_error` | Track errors and learnings | Mistakes, corrections, user feedback |

## Instrumentation Points

### 1. Task Preference (self_obs_task_preference)

**Where to instrument:**

| Location | What to capture | Function to use |
|----------|-----------------|-----------------|
| Sub-agent spawn | Task type being delegated | `logTaskDelegated()` |
| Sub-agent completion | Task outcome, duration | `logTaskPreference()` |
| Tool invocations | Which tools I reach for | `logTaskPreference()` |
| Pipeline stage changes | Task progression | `logTaskStart()` / `logTaskPreference()` |

**Example - Sub-agent task:**
```javascript
// When spawning a sub-agent
selfObs.logTaskDelegated({
  taskType: 'spec-review',
  delegatedTo: 'spec-reviewer',
  reason: 'Specialized task requiring focused review',
  sessionId: session.id,
  source: 'main'
});

// When sub-agent completes
selfObs.logTaskPreference({
  taskType: 'spec-review',
  outcome: 'completed',
  durationMs: Date.now() - startTime,
  sessionId: session.id,
  source: 'subagent',
  relatedId: `pipeline:${featureId}`
});
```

### 2. Communication (self_obs_communication)

**Where to instrument:**

| Location | What to capture | Function to use |
|----------|-----------------|-----------------|
| Message send | Channel, length, type | `logCommunication()` |
| HEARTBEAT_OK | Chose not to speak | `logSilence()` |
| Group chat skip | Strategic silence | `logSilence()` |

**Example - Message response:**
```javascript
const startTime = Date.now();
// ... generate response ...
const responseTime = Date.now() - startTime;

selfObs.logCommunication({
  channel: 'telegram',
  messageType: 'response',
  responseTimeMs: responseTime,
  messageLength: response.length,
  tone: detectTone(response), // optional
  sessionId: session.id
});
```

**Example - Heartbeat silence:**
```javascript
if (nothingToReport) {
  selfObs.logSilence({
    channel: 'heartbeat',
    reason: 'No actionable items, user likely busy',
    sessionId: session.id
  });
  return 'HEARTBEAT_OK';
}
```

### 3. Decision (self_obs_decision)

**Where to instrument:**

| Location | What to capture | Function to use |
|----------|-----------------|-----------------|
| Before risky actions | Decision to proceed vs ask | `logAutonomousAction()` or `logAskedPermission()` |
| File operations | Write/delete decisions | `logDecision()` |
| External actions | Email, tweets, posts | `logDecision()` |
| Tool selection | Why this tool vs another | `logDecision()` |

**Example - Autonomous file edit:**
```javascript
// Decided to edit file without asking
selfObs.logAutonomousAction({
  action: 'edited config file',
  reason: 'Minor documentation update, clearly safe',
  riskLevel: 'low',
  sessionId: session.id,
  relatedId: `file:${filePath}`
});
```

**Example - Asked permission:**
```javascript
// Decided to ask before deleting
selfObs.logAskedPermission({
  action: 'delete old backup files',
  reason: 'Destructive action, want confirmation',
  sessionId: session.id
});
```

### 4. Error (self_obs_error)

**Where to instrument:**

| Location | What to capture | Function to use |
|----------|-----------------|-----------------|
| Catch blocks | Error type, context | `logObservedError()` |
| User corrections | What I got wrong | `logUserCorrection()` |
| Self-corrections | When I notice own mistake | `logSelfCorrection()` |
| Retries | Why retry was needed | `logObservedError()` |

**Example - Tool failure:**
```javascript
try {
  await someToolCall();
} catch (err) {
  selfObs.logObservedError({
    errorType: 'tool_failure',
    description: `${toolName} failed: ${err.message}`,
    severity: 'minor',
    sessionId: session.id
  });
  // ... handle error ...
}
```

**Example - User correction:**
```javascript
// When user says "that's wrong" or corrects something
selfObs.logUserCorrection({
  whatWasWrong: 'Misunderstood the file path format',
  userFeedback: 'Use relative paths, not absolute',
  learning: 'Check path format before assuming',
  sessionId: session.id
});
```

## Querying Observations

```javascript
const selfObs = require('./lib/self-observation');

// Get recent errors
const errors = selfObs.getObservations(selfObs.OBS_CATEGORIES.ERROR, 20);

// Get decision stats for past week
const decisionStats = selfObs.getObservationStats(
  selfObs.OBS_CATEGORIES.DECISION, 
  7
);

// Get summary across all categories
const summary = selfObs.getSelfObservationSummary(7);
```

## CLI Access

```bash
# View recent self-observations
node tools/db.js activity --limit 50 | grep self_obs

# Get observations by category (via db query)
sqlite3 ~/.openclaw/data/agent.db "SELECT * FROM activity WHERE category LIKE 'self_obs%' ORDER BY created_at DESC LIMIT 20"
```

## Best Practices

1. **Be selective** - Don't log everything, focus on meaningful signals
2. **Include context** - Add `sessionId`, `source`, and `relatedId` when available
3. **Keep it passive** - Never add API calls to generate observations
4. **Batch when possible** - Aggregate multiple signals into one log entry
5. **Use severity levels** - Helps with filtering and analysis later

## Future Analysis

These observations will enable:
- Pattern detection (what tasks I avoid)
- Communication style analysis (tone, timing)
- Decision-making calibration (when to ask vs act)
- Error pattern identification (common mistakes)
- Behavioral drift detection over time

---

*Feature #1884 - Story #1921*
