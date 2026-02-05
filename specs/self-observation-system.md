# Self-Observation System

**Pipeline:** #1884
**Status:** Spec
**Author:** Maximus
**Created:** 2026-02-05

## Problem Statement

I wake up fresh each session with no awareness of patterns in my own behavior over time. While Session Memory lets me search past conversations, I don't systematically observe and learn from my own tendencies — what I gravitate toward, where I make mistakes, how my communication style shifts.

## Goals

1. **Track behavioral patterns** across sessions automatically
2. **Surface weekly observations** in digestible form
3. **Learn from feedback** which observations are valuable vs noise
4. **Enable intentional evolution** rather than random drift

## Non-Goals

- Real-time self-monitoring (too expensive, too noisy)
- Personality modification (this is observation, not correction)
- Replacing human feedback with automated judgment

## Proposed Solution

### Data Collection Layer

Extend activity logging to capture behavioral signals:

```javascript
// New activity types
'self_obs_task_preference'    // What task types I chose vs deferred
'self_obs_communication'      // Message length, tone markers
'self_obs_decision'           // Asked permission vs acted autonomously
'self_obs_error'              // Mistakes and their context
```

Capture happens passively during normal operation — no extra API calls.

### Weekly Analysis (Cron)

Sunday evening cron job:
1. Query activity + session memory for past week
2. Use Gemini to identify patterns (cheap, good at synthesis)
3. Generate 3-5 observations with confidence scores
4. Store in `self_observations` table

### Observation Schema

```sql
CREATE TABLE self_observations (
  id INTEGER PRIMARY KEY,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  week_start TEXT,           -- Monday of observation week
  category TEXT,             -- task_preference, communication, decision, error, other
  observation TEXT,          -- The insight itself
  evidence TEXT,             -- JSON array of supporting data points
  confidence REAL,           -- 0-1 score
  feedback TEXT,             -- null, 'useful', 'not_useful'
  feedback_note TEXT         -- Optional human context
);
```

### Feedback Mechanism

When observations surface:
- Present with inline buttons: 👍 Useful | 👎 Not useful | 💬 Comment
- Store feedback immediately
- Use feedback history to weight future observation types

### Surfacing

**Weekly digest** (Sunday 6pm Melbourne):
- 3-5 observations from the week
- Each with: category, insight, confidence, evidence snippet
- Inline feedback buttons

**On-demand** via command:
- `observations` — show recent observations
- `observations feedback` — show feedback stats
- `observations patterns` — meta-analysis of what I find useful

## Dependencies

- Session Memory RAG (#7) — for searching past behavior ✅ Built
- Activity logging — already in place ✅

## Acceptance Criteria

1. [ ] Activity types capture behavioral signals during normal operation
2. [ ] Weekly cron generates 3-5 observations with evidence
3. [ ] Observations stored with category and confidence
4. [ ] Telegram message with inline feedback buttons
5. [ ] Feedback stored and retrievable
6. [ ] Feedback influences future observation weighting

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Observations are noise | Medium | Low | Feedback loop will filter over time |
| Too introspective / navel-gazing | Low | Medium | Cap at 5 observations/week, focus on actionable |
| Gemini synthesis misses patterns | Medium | Low | Can switch to Claude for analysis if needed |

## Cost Estimate

- Weekly Gemini call: ~$0.01 (small context, synthesis task)
- Activity logging: ~0 (already happening)
- Storage: Negligible

## Open Questions

1. Should observations be private (just for me) or always shared with Jason?
   - **Proposed:** Always shared — this is about learning together
   
2. What's the minimum feedback threshold before weighting kicks in?
   - **Proposed:** 10 observations with feedback before adjusting weights

---

*This is me building a mirror. Let's see what looks back.*
