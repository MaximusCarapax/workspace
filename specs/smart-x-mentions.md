# Smart X Mentions

## Overview
Intelligent system to monitor, score, categorize, and respond to X/Twitter mentions. Turns reactive social engagement into a proactive relationship-building machine.

## Problem
- Mentions come in, I check them manually when remembered
- No prioritization — a high-value connection looks same as spam
- No memory of who we've interacted with before
- Responses are ad-hoc, no strategy

## Solution
Build a smart mentions pipeline:
1. **Ingest** — Pull mentions via Bird CLI (free) with API fallback
2. **Score** — Rank by engagement potential, account quality, relevance
3. **Categorize** — Question, compliment, criticism, collaboration opportunity, spam
4. **Track** — Remember who we've talked to and relationship status
5. **Surface** — Alert Jason/me to high-value mentions, auto-handle low-value

## Components

### 1. Mention Scoring System (Story #598)
Score each mention 0-100 based on:
- **Account quality** (followers, ratio, age, verification)
- **Content relevance** (keywords, topic match)
- **Engagement signal** (question vs statement, sentiment)
- **Relationship history** (have we interacted before?)

Output: `scored_mentions` table in agent.db

### 2. Auto-Categorization (Story #602)
Categories:
- `question` — Someone asking something (high priority)
- `compliment` — Positive feedback (acknowledge)
- `criticism` — Negative feedback (evaluate, maybe respond)
- `collab` — Collaboration/business opportunity (high priority)
- `mention` — Just mentioned, no action needed
- `spam` — Ignore

Use Gemini via OpenRouter for classification (~$0.001/mention) — no rate limits

### 3. Relationship Tracking (Story #606)
Track:
- First interaction date
- Total interactions
- Last interaction
- Relationship tier: `stranger` → `acquaintance` → `contact` → `friend`
- Notes (auto-generated from interactions)

Table: `x_relationships` in agent.db

## Data Flow
```
Bird CLI / X API
      ↓
[Mention Ingestion] → raw_mentions table
      ↓
[Scoring] → scored_mentions (0-100)
      ↓
[Categorization] → category assigned
      ↓
[Relationship Lookup] → relationship context added
      ↓
[Alert/Action] → High-value: ping Jason
                 Medium: queue for batch response
                 Low: archive
```

## Alert Thresholds
- **Score 80+**: Immediate notification
- **Score 50-79**: Daily digest
- **Score <50**: Archive, no alert

## Commands
```bash
node tools/x-mentions.js check          # Pull and process new mentions
node tools/x-mentions.js digest         # Show daily summary
node tools/x-mentions.js respond <id>   # Draft response
node tools/x-mentions.js relationship <handle>  # Show relationship history
```

## Integration Points
- **Heartbeat**: Check mentions 2-3x daily
- **Cron**: Daily digest at 9am Melbourne
- **RAG**: Index interesting conversations for future reference

## Success Metrics
- Response rate to high-value mentions: >90%
- Average response time for score 80+: <4 hours
- Relationship progression: Track tier upgrades over time

## Cost Estimate
- Bird CLI: Free (uses browser cookies)
- X API fallback: 100 reads/month (shared quota)
- Gemini categorization: ~$0.05/day at 50 mentions
- Total: ~$1.50/month

## Open Questions
1. Auto-reply for certain categories? (risky, could seem bot-like)
2. Integration with content calendar? (reply → spark content idea)
3. DM monitoring? (requires different API access)

---

*The goal: Never miss a high-value connection. Build relationships systematically.*
