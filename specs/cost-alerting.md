# Cost Alerting Spec

## Goal
Automatically alert Jason when daily API spend exceeds a configurable threshold, preventing budget overruns before they compound.

## Requirements

### Functional
1. **Configurable threshold** - Default $150/day, adjustable via config file or environment variable
2. **Daily spend tracking** - Query `token_usage` table for current day's total `cost_usd`
3. **Alert delivery** - Send notification via existing `tools/notify.js` (Telegram preferred, SMS fallback)
4. **Alert frequency** - Max 1 alert per threshold breach per day (don't spam on continued usage)
5. **Manual check** - CLI command to check current spend vs threshold

### Non-Functional
1. **Low overhead** - Check should complete in <500ms
2. **Reliable** - Must not fail silently; log errors if alerting fails
3. **Configurable timing** - Integrate with heartbeat or cron for periodic checks

## Acceptance Criteria
- [ ] Running `node tools/cost-alert.js check` shows current spend, threshold, and status
- [ ] Running `node tools/cost-alert.js config --threshold 200` updates threshold
- [ ] When daily spend crosses threshold, Jason receives Telegram notification
- [ ] Subsequent spend on same day does NOT trigger additional alerts
- [ ] Alert state resets at midnight UTC
- [ ] `node tools/db.js costs alert-status` shows last alert time and threshold

## Technical Approach

### Data Model
Add to existing schema or use config file:
```sql
-- Optional: Track alert state in DB
CREATE TABLE IF NOT EXISTS cost_alerts (
    id INTEGER PRIMARY KEY,
    date TEXT NOT NULL UNIQUE,  -- YYYY-MM-DD
    threshold_usd REAL NOT NULL,
    alerted_at TEXT,
    spend_at_alert REAL
);
```

Or simpler: JSON state file at `~/.openclaw/data/cost-alert-state.json`

### Integration Points
- **Query**: Reuse existing `getCosts()` from `lib/db.js`
- **Notify**: Use `message` tool (Telegram) or `tools/notify.js` (SMS fallback)
- **Scheduling**: Add to `HEARTBEAT.md` checklist or dedicated cron job

### Config Location
`~/.openclaw/config/cost-alert.json`:
```json
{
  "threshold_usd": 150,
  "notify_channel": "telegram",
  "notify_target": "jason",
  "enabled": true
}
```

## Tasks Breakdown

| # | Task | Estimate |
|---|------|----------|
| 1 | Create `tools/cost-alert.js` CLI with `check` and `config` commands | 30min |
| 2 | Implement threshold check logic using existing DB queries | 20min |
| 3 | Add alert state tracking (JSON file or DB table) | 20min |
| 4 | Integrate notification via Telegram message tool | 20min |
| 5 | Add `cost-alert check` to heartbeat or create cron job | 10min |
| 6 | Test: cross threshold → alert → no re-alert → next day resets | 20min |

## Estimated Effort
**Total: 2 hours**

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Alert delivery fails silently | Medium | High | Log failures to error_logs table; add fallback to SMS |
| Timezone confusion (UTC vs local) | Low | Medium | Use UTC consistently; document in config |
| Threshold too low = alert fatigue | Medium | Low | Start at $150 (above typical); easy to adjust |
| Threshold too high = no early warning | Low | Medium | Can add tiered alerts later (warn at 80%, alert at 100%) |

## Future Enhancements (Out of Scope)
- Weekly/monthly budget tracking
- Per-model cost limits
- Automatic model downgrade when approaching limit
- Cost projections based on current rate
