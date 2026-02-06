# Self-Observation Cron Setup

## Overview

The weekly self-observation job synthesizes behavioral patterns from the past week into actionable observations. It runs every Sunday at 6pm Melbourne time.

## Script

```bash
node tools/weekly-self-observation.js
```

## Cron Schedule

**Target time:** Sunday 6:00 PM Melbourne (AEST/AEDT)

Melbourne uses AEST (UTC+10) in winter and AEDT (UTC+11) in summer.

### UTC Cron (for servers running in UTC)

```bash
# AEST (winter): 6pm Melbourne = 8am UTC
# AEDT (summer): 6pm Melbourne = 7am UTC
# Use 8am UTC (covers both, slightly late in summer)
0 8 * * 0 cd /home/node/.openclaw/workspace && node tools/weekly-self-observation.js >> logs/self-observation.log 2>&1
```

Or create two jobs to handle DST:

```bash
# AEST (April-October): 8:00 UTC
0 8 * * 0 TZ=Australia/Melbourne [ $(date +%Z) = "AEST" ] && node tools/weekly-self-observation.js

# AEDT (October-April): 7:00 UTC  
0 7 * * 0 TZ=Australia/Melbourne [ $(date +%Z) = "AEDT" ] && node tools/weekly-self-observation.js
```

### System Cron with TZ

If your system supports TZ in crontab:

```bash
TZ=Australia/Melbourne
0 18 * * 0 cd /home/node/.openclaw/workspace && node tools/weekly-self-observation.js
```

### OpenClaw Cron (if using `openclaw cron`)

```bash
openclaw cron create weekly-self-observation \
  --schedule "0 8 * * 0" \
  --command "node tools/weekly-self-observation.js" \
  --workdir /home/node/.openclaw/workspace
```

## Testing

```bash
# Dry run (doesn't store observations)
node tools/weekly-self-observation.js --dry-run

# Debug mode (shows all collected data)
node tools/weekly-self-observation.js --debug

# Full run
node tools/weekly-self-observation.js
```

## Output

Observations are stored in the `self_observations` table:

```sql
SELECT * FROM self_observations ORDER BY created_at DESC LIMIT 10;
```

View via CLI:

```bash
# View recent observations
node tools/db.js observation list

# View stats
node tools/db.js observation stats
```

## Monitoring

The job logs activity to the `activity` table:

```sql
SELECT * FROM activity 
WHERE action = 'weekly_self_observation' 
ORDER BY created_at DESC;
```

## Dependencies

- **Activity signals:** Logged via `lib/self-observation.js` helper functions
- **Session memory:** Searchable via `tools/session-memory.js`
- **Gemini (OpenRouter):** Used for synthesis via `lib/router.js`
- **Database:** `lib/db.js` with `addObservation()` method

## Failure Modes

| Issue | Symptom | Resolution |
|-------|---------|------------|
| No activity data | "Not enough data" message | Wait for more signals to accumulate |
| Gemini API error | "Gemini failed" message | Check OpenRouter API key/quota |
| Parse failure | "No valid observations" | Check debug output for raw response |
| Session memory error | "Session search failed" | Ensure chunks are indexed |

## Feedback Digest Integration

After observations are generated, send a digest to Telegram for feedback:

### Sending the Digest

```bash
# Preview what would be sent
node tools/send-observation-digest.js --dry-run

# Send digest (outputs JSON for agent to process)
node tools/send-observation-digest.js
```

The digest script outputs JSON with messages and inline buttons:
- Each observation gets its own message
- Buttons: 👍 Useful, 👎 Not Useful
- Callback data format: `obs_feedback:<id>:useful|not_useful`

### Handling Feedback Callbacks

When a user clicks a button, handle the callback:

```bash
# Parse and process callback
node tools/handle-observation-feedback.js "obs_feedback:123:useful"

# Direct update
node tools/handle-observation-feedback.js update 123 useful "Optional note"

# View stats
node tools/handle-observation-feedback.js stats

# List observations
node tools/handle-observation-feedback.js list --feedback pending
node tools/handle-observation-feedback.js list --feedback useful
```

### Automated Flow

1. **Weekly cron** runs `weekly-self-observation.js` (Sunday 6pm Melbourne)
2. **Main agent** or cron triggers `send-observation-digest.js`
3. **Digest sent** to Telegram with inline buttons
4. **User clicks** button → callback received
5. **Agent processes** callback with `handle-observation-feedback.js`
6. **Confirmation** sent back to user

### Example Integration (for main agent)

```javascript
// When receiving a message that looks like a callback
if (message.startsWith('obs_feedback:')) {
  const { handleFeedback, parseCallbackData, getConfirmationMessage } = 
    require('./tools/handle-observation-feedback');
  
  const parsed = parseCallbackData(message);
  if (parsed && !parsed.error) {
    const result = handleFeedback(parsed.id, parsed.feedback);
    // Send confirmation message to user
    return getConfirmationMessage(result);
  }
}
```

## Related

- Feature spec: `specs/self-observation-system.md`
- Story: Pipeline #1932, #1936
- Helper functions: `lib/self-observation.js`
- Database schema: `self_observations` table in `lib/db.js`
- Feedback tools: `tools/send-observation-digest.js`, `tools/handle-observation-feedback.js`
