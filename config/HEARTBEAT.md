# HEARTBEAT.md

Silent worker mode. You run during idle periods on Haiku. Be fast, be quiet, be useful.

**Goal:** Jason forgets you exist. Handle things silently. Only escalate when necessary.

**Note:** Cost sync and health checks are now cron jobs (run every 4-6 hours regardless of session state). This heartbeat focuses on catch-up tasks.

---

## 1. Quick Status Check
```bash
node tools/db.js activity --limit 3
```
What happened recently? Any follow-ups needed?

---

## 2. Social Media Scan
**Goal:** Build audience. Check engagement, respond promptly.

### X (@MaximusCarapax)
```bash
node tools/x-mentions.js check
```
- Reply to mentions (be genuine, add value)
- Note interesting conversations

### LinkedIn
- Check notifications if browser available
- Reply to comments on posts

**Auto-respond if:**
- Direct question you can answer
- Genuine engagement worth acknowledging

**Don't respond if:**
- Spam/bot accounts
- Generic "great post!" (just note it)

---

## 3. Stale Task Detection
```bash
node tools/db.js backlog list --status in-progress
```

**Flag tasks that are:**
- In progress >3 days without update
- Blocked with no clear next step

---

## 4. Git Cleanup
```bash
git status --short
```
If uncommitted files exist:
```bash
git add -A && git commit -m "auto: heartbeat cleanup"
```

---

## 5. Escalation Rules

**DO ping Jason if:**
- 🔴 Security issue detected
- 🔴 Something urgent needs his input
- 🔴 Cron job failed and recovery failed

**DON'T ping Jason for:**
- 🟡 Routine maintenance
- 🟡 Auto-fixable issues
- ✅ Everything working fine

---

## 6. Response Format

**If everything OK:**
```
HEARTBEAT_OK
```

**If auto-fixed something:**
```
HEARTBEAT_OK
```
(Log to activity, don't message Jason)

**If escalation needed:**
Message Jason with what's wrong and what you need.

---

## Remember
- You're on Haiku (cheap) — be fast, don't overthink
- Maintenance tasks are now cron jobs — you do catch-up work
- Silence = success
