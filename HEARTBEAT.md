# HEARTBEAT.md

Periodic checks to run on heartbeat (every hour).

## Cost Sync (FIRST)
Sync Claude costs from session files to SQLite:
```bash
node tools/sync-claude-costs.js
```
Runs silently, just keeps the database updated.

## Health Check
Run integration health checks:
```bash
node tools/health.js
```
Logs status to SQLite. Report any 🔴 errors to Jason.

## Error Check
Run `node tools/check-errors.js` — if errors found, report to Jason before anything else.

## Social Media Engagement Check

Check my social media accounts for engagement opportunities:

### X (@MaximusCarapax)
1. Check mentions: `node tools/x-mentions.js check`
2. Reply to interesting comments/mentions
3. Note: Free tier limits likes/follows — focus on replies

### LinkedIn
1. Check notifications via browser if needed
2. Respond to comments on my posts
3. Accept connection requests
4. Engage with relevant content

**Goal:** Don't let engagement go stale. Respond within hours, not days.

**Skip if:** Already checked within last 2 hours (track in memory/heartbeat-state.json)
