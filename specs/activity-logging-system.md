# Unified Activity Logging System Spec

## Goal
Create a comprehensive activity logging system that automatically records actions across all agent contexts (chat sessions, heartbeat polls, cron jobs, sub-agent work) to enable better productivity tracking, session recovery, and daily digest generation.

## Requirements

### Functional
1. **Unified activity service** — Single API for logging actions from any context
2. **Template integration** — All agent templates automatically log completion activities
3. **Heartbeat logging** — Each heartbeat poll logs what was checked and any findings
4. **Session summary extraction** — Capture key actions from significant work sessions
5. **Daily digest integration** — Activity log feeds digest generation
6. **Categorized logging** — Support structured categories (chat, heartbeat, cron, build, review, spec, research, content)
7. **Metadata support** — Store structured data (file paths, token counts, costs, URLs)
8. **CLI querying** — Enhanced CLI for filtering and searching activities

### Non-Functional  
1. **Performance** — Log calls should be <10ms, non-blocking
2. **Cost efficiency** — Session summaries only when beneficial (avoid LLM costs for simple activities)
3. **Storage efficiency** — Compress old activities after 30 days
4. **Backward compatibility** — Existing activity logs remain accessible

## Acceptance Criteria
- [ ] `tools/activity.js` or `lib/activity.js` provides simple `log(action, details, context)` API
- [ ] All agent templates in `templates/agents/` call activity logging before completion
- [ ] Heartbeat polls log checks performed and any findings
- [ ] Session summary hook available (manual trigger + automatic detection)
- [ ] CLI supports filtering by category, date range, and search
- [ ] Daily digest generator can query activity log for content
- [ ] Activity logging works from main sessions, heartbeats, cron jobs, and sub-agents
- [ ] Categories include: chat, heartbeat, cron, build, review, spec, research, content
- [ ] Metadata field supports JSON for structured data (costs, files, metrics)

## Technical Approach

### Activity Service Implementation
**File:** `lib/activity.js` (library) + `tools/activity.js` (standalone CLI)

**Core API:**
```javascript
const activity = require('../lib/activity');

// Simple API
activity.log(action, details, context);

// Full API
activity.log({
  action: 'task_completed',
  category: 'build', 
  description: 'Built cost-alerting tool',
  metadata: { files: ['tools/cost-alert.js'], tokens: 1250, cost: 0.003 },
  sessionId: 'agent:main:subagent:12345'
});
```

**Database Schema (existing activity table):**
- `action` — Short action identifier (task_completed, heartbeat_check, session_summary)
- `category` — Broad category (chat, heartbeat, cron, build, review, spec, research, content)  
- `description` — Human-readable description
- `metadata` — JSON for structured data (files, costs, tokens, URLs, findings)
- `session_id` — Track which agent/session logged the activity

### Template Integration
**Pattern:** Add activity logging hook to all agent templates before completion message.

**Example for builder.md:**
```markdown
## Final Message Format
After saving build notes, log activity and confirm:

```javascript
// Log build completion
require('../lib/activity').log({
  action: 'build_completed',
  category: 'build',
  description: `Built ${featureName}`,
  metadata: { 
    spec: specPath,
    files: createdFiles,
    tests: testResults
  }
});
```

✅ Build complete — notes saved to `memory/builds/{filename}.md`
...
```

### Heartbeat Logging
**Modify HEARTBEAT.md pattern:**
1. Before each check, log `heartbeat_check_start`
2. After each check, log results with `heartbeat_check_complete`
3. At end, log `heartbeat_summary` with all findings

**Example:**
```javascript
// Before cost check
activity.log('heartbeat_check_start', 'Checking API costs', { category: 'heartbeat', check: 'costs' });

// After cost check  
activity.log('heartbeat_check_complete', 'Daily costs: $2.45', { 
  category: 'heartbeat', 
  check: 'costs',
  metadata: { amount: 2.45, threshold: 5.00, status: 'ok' }
});
```

### Session Summary Hook
**Implementation:** Two approaches for capturing session summaries

**Manual trigger:**
```bash
node tools/activity.js summary "Session focused on building cost-alerting system"
```

**Automatic detection:** Monitor session for "significant work" indicators:
- Multiple file edits
- Tool executions > 10
- High token usage (>5k tokens)
- Duration > 30 minutes

**Cost consideration:** Only extract summaries for sessions with substantial work to avoid unnecessary LLM costs.

### Enhanced CLI
**Extend `node tools/db.js activity`:**
```bash
node tools/db.js activity                          # Recent (current behavior)
node tools/db.js activity --category heartbeat     # Filter by category
node tools/db.js activity --since "2026-02-01"     # Date range
node tools/db.js activity --action task_completed  # Filter by action
node tools/db.js activity --search "cost-alert"    # Text search
node tools/db.js activity summary --auto           # Auto-generate session summary
node tools/db.js activity summary "manual summary" # Manual summary
```

### Daily Digest Integration
**Query interface for digest generator:**
```javascript
const activity = require('../lib/activity');

// Get activities for digest
const yesterday = activity.getActivitiesByDate('2026-02-03');
const taskCompletions = activity.getActivitiesByAction('task_completed', { since: '2026-02-03' });
const heartbeatFindings = activity.getActivitiesByCategory('heartbeat', { since: '2026-02-03' });
```

## Tasks Breakdown
| # | Task | Estimate |
|---|------|----------|
| 1 | Create `lib/activity.js` with simple and full APIs | 2h |
| 2 | Enhance `tools/db.js activity` CLI with filters and search | 2h |
| 3 | Add session summary functionality (manual + auto-detect) | 3h |
| 4 | Update all agent templates with activity logging hooks | 1.5h |
| 5 | Modify HEARTBEAT.md and heartbeat flow for activity logging | 1h |
| 6 | Add query methods for daily digest integration | 1h |
| 7 | Create standalone `tools/activity.js` CLI tool | 1h |
| 8 | Update documentation and examples | 0.5h |

## Estimated Effort
**Total: 12 hours**

## Risks
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Performance impact from frequent logging | Low | Medium | Make logging calls non-blocking, batch if needed |
| LLM costs from auto-session summaries | Medium | Medium | Only summarize sessions with >5k tokens or >30min duration |
| Template adoption inconsistency | Medium | Low | Clear documentation, examples in each template |
| Storage bloat from verbose metadata | Low | Low | Compress activities older than 30 days |

## Open Questions
1. **Session summary trigger threshold** — What constitutes "significant work"? (5k tokens? 30 min? 10+ tool calls?)
2. **Activity retention policy** — How long to keep detailed activities? (90 days? 1 year?)
3. **Real-time digest updates** — Should activity logging trigger digest regeneration?
4. **Cross-session linking** — Should sub-agent activities link to parent session IDs?

## Implementation Notes
- Leverage existing SQLite `activity` table schema (no migrations needed)
- Use `db.logActivity()` function that already exists
- Activity service should be a thin wrapper around existing database functions
- Template updates can be done incrementally (start with spec-writer, builder, reviewer)
- Heartbeat logging can be added to current `HEARTBEAT.md` workflow without breaking changes