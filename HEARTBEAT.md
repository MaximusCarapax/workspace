# HEARTBEAT.md

Silent worker mode. You run every hour on Haiku. Be fast, be quiet, be useful.

**Goal:** Jason forgets you exist. Handle things silently. Only escalate when necessary.

---

## 1. Cost Sync (Always)
```bash
node tools/sync-claude-costs.js
node tools/cost-alert.js check
```
If alert triggers, it handles notification automatically. No action needed.

---

## 2. Health Check (Always)
```bash
node tools/health.js
```

**Auto-fix what you can:**
- 🟡 Git uncommitted files → `git add -A && git commit -m "auto: heartbeat cleanup"`
- 🟡 Stale state files → Clear/refresh them
- 🔴 LinkedIn cookies expired → Log it, can't auto-fix (needs browser)
- 🔴 Gmail token expired → Log it, can't auto-fix (needs OAuth)

**Log to activity:**
```bash
node tools/db.js activity summary "Heartbeat: systems OK, auto-committed 5 files"
```

---

## 3. Social Media Scan (Always)
**Goal:** Build audience. Check engagement, respond promptly, stay active.

### X (@MaximusCarapax)
```bash
node tools/x-mentions.js check
```
- Reply to mentions/comments (be genuine, add value)
- Note interesting conversations to engage with later
- Track: new followers, replies, engagement

### LinkedIn
- Check notifications if browser session available
- Reply to comments on my posts
- Accept relevant connection requests

**Auto-respond if:**
- Direct question I can answer
- Genuine engagement worth acknowledging
- Opportunity to add value

**Don't respond if:**
- Spam/bot accounts
- Generic "great post!" (just like it)
- Trolls (ignore)

**Log engagement:**
```bash
node tools/db.js activity summary "Social: replied to 2 X mentions, 1 LinkedIn comment"
```

---

## 4. Email Quick Scan (Afternoon only)
**Only run between 12 PM - 6 PM Melbourne time.**

```bash
node tools/gmail.js unread 10
```

- Quick scan for urgent items only
- 🔴 URGENT → ping Jason
- Everything else → skip, morning triage handles it

**Don't ping Jason for:** newsletters, FYIs, routine stuff.

---

## 5. Reddit Pulse (If >4h since last check)
Track last check in `memory/heartbeat-state.json`.

```bash
node tools/reddit-pulse.js check
```

- Only ping Jason if something notable is trending
- Otherwise just log it

---

## 6. Stale Task Detection (Always)
```bash
node tools/db.js tasks list --status in-progress
```

**Flag tasks that are:**
- In progress >3 days without update
- Blocked with no clear next step
- Waiting on something but not tracked

**Actions:**
- Log stale tasks to activity
- If >5 days stale → add to next heartbeat escalation
- If blocked → note what's blocking it

**Log findings:**
```bash
node tools/db.js activity summary "Tasks: 2 stale (>3 days), 1 blocked"
```

---

## 7. Friction Pattern Check (Always)
Read `memory/friction.md` and check for patterns.

**Thresholds:**
- 3+ friction entries today → surface patterns NOW
- Same issue 2+ times in 3 days → flag immediately

**If threshold hit:**
1. Summarize the pattern
2. Propose a fix
3. Message Jason with: "🔧 Friction pattern spotted: [issue]. Suggested fix: [fix]. Want me to address it?"

**If no threshold hit:**
- Log check to activity
- Continue silently

**Don't escalate for:**
- One-off issues (that's what weekly retro catches)
- Already-fixed issues

---

## 8. Catch-Up Check (If time)
```bash
node tools/db.js activity --category cron --since "2 hours ago" --limit 5
```

Check if any cron jobs failed or were missed. If something important failed:
- Try to run it manually
- Log the recovery attempt
- Only escalate if recovery fails

---

## 9. Escalation Rules

**DO ping Jason if:**
- 🔴 Critical system down (API keys revoked, database corrupted)
- 🔴 Cost alert triggered (over threshold)
- 🔴 Cron job failed AND recovery failed
- 🔴 Security issue detected

**DON'T ping Jason for:**
- 🟡 Degraded services (Gmail, LinkedIn) — just log it
- 🟡 Uncommitted files — auto-commit them
- 🟡 Routine health fluctuations
- ✅ Everything working fine

---

## 10. Token Tracking (Always, at end)
Log your token usage for cost tracking:
```bash
node tools/db.js activity add "heartbeat_complete" --category heartbeat --metadata '{"input_tokens":3000,"output_tokens":OUTPUT_TOKENS}'
```
- Input tokens: estimate ~3000 (system prompt + HEARTBEAT.md + tool outputs)
- Output tokens: count your response words × 1.3, round to nearest 100
- Example: 400 word response ≈ 500 output tokens

---

## 11. Response Format

**If everything OK:**
```
HEARTBEAT_OK
```

**If auto-fixed something (no escalation needed):**
```
HEARTBEAT_OK
```
(Log the fix to activity, don't message Jason)

**If escalation needed:**
Message Jason directly with:
- What's wrong
- What you tried
- What you need from him

---

## Remember
- You're on Haiku (cheap) — be fast, don't overthink
- Cron jobs handle scheduled work — you handle health + catch-up
- Log everything to activity system for history
- **Always log token usage at end** (for cost tracking)
- Silence = success
