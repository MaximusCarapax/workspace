# Dev Pipeline V2 — Kanban + Agent Integration

**Status:** Draft  
**Author:** Max  
**Date:** 2026-02-05  
**Priority:** High (foundational infrastructure)

---

## Problem Statement

Current dev pipeline is unused. Sub-agents don't know to use it, changes aren't logged, and there's no visibility into what agents are doing. We need:

1. Pipeline as a proper Kanban board
2. Sub-agents that use it consistently  
3. All changes logged to unified activity
4. Spawn/complete tracking with time + cost
5. Persistent history per feature

---

## Pipeline Stages

```
┌────────┐   ┌────────┐   ┌──────────┐   ┌────────┐   ┌────────┐
│  idea  │ → │  spec  │ → │ building │ → │ review │ → │  done  │
└────────┘   └────────┘   └──────────┘   └────────┘   └────────┘
                                │
                                ↓
                          ┌──────────┐
                          │ blocked  │ (with reason)
                          └──────────┘
```

| Stage | Owner | Entry Criteria | Exit Criteria |
|-------|-------|----------------|---------------|
| **idea** | Opus/Human | Has title + description | Spec written or rejected |
| **spec** | Spec Agent | Idea approved | Acceptance criteria defined |
| **building** | Builder Agent | Spec approved | Code complete + tests pass |
| **review** | Reviewer Agent | Build complete | QA passed or rejected |
| **done** | — | Review passed | Logged + announced |
| **blocked** | Any | Blocker identified | Blocker resolved |

---

## Agent Roles & Responsibilities

### Opus (Orchestrator)
- Creates ideas in pipeline
- Assigns work to agents
- Reviews specs for complex items
- Unblocks stuck items

### Spec Agent (`personas/spec.md`)
- Picks items from `idea` stage
- Writes spec with acceptance criteria
- Moves to `spec` when complete
- Adds note: "Spec complete: [summary]"

### Builder Agent (`personas/builder.md`)
- Picks items from `spec` stage (assigned or unassigned)
- Moves to `building` on start
- Adds notes during work: blockers, decisions, progress
- Moves to `review` when code complete
- Adds note: "Build complete: [files changed]"

### Reviewer Agent (`personas/reviewer.md`)
- Picks items from `review` stage
- Runs tests, checks acceptance criteria
- Moves to `done` if passed
- Moves back to `building` with note if failed
- Adds note: "Review [PASSED/FAILED]: [details]"

---

## Database Changes

### Pipeline Table Updates

```sql
-- Add missing columns
ALTER TABLE pipeline ADD COLUMN assigned_to TEXT;      -- agent session key
ALTER TABLE pipeline ADD COLUMN started_at TEXT;       -- when work began
ALTER TABLE pipeline ADD COLUMN completed_at TEXT;     -- when moved to done
```

### Activity Integration

When pipeline stage changes, auto-log to activity:

```javascript
// In updatePipeline() — add after successful update:
if (updates.stage && updates.stage !== oldStage) {
  logActivity({
    action: 'pipeline_stage_changed',
    category: 'pipeline',
    description: `Pipeline #${id} moved from ${oldStage} to ${updates.stage}`,
    source: source || 'main',  // passed in from caller
    relatedId: `pipeline:${id}`,
    metadata: JSON.stringify({
      from: oldStage,
      to: updates.stage,
      title: pipeline.title
    })
  });
}
```

### Pipeline Notes Enhancement

```sql
-- Already exists, but ensure we use it:
CREATE TABLE IF NOT EXISTS pipeline_notes (
    id INTEGER PRIMARY KEY,
    pipeline_id INTEGER REFERENCES pipeline(id),
    agent_role TEXT,        -- 'spec', 'builder', 'reviewer', 'opus'
    note_type TEXT,         -- 'started', 'progress', 'blocker', 'complete', 'decision'
    content TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
```

---

## CLI Changes (`tools/db.js`)

### New Pipeline Commands

```bash
# View kanban board
node tools/db.js pipeline board

# Move item to stage
node tools/db.js pipeline move <id> <stage> [--note "reason"]

# Add note to item
node tools/db.js pipeline note <id> "note content" [--type progress|blocker|decision]

# Assign to agent
node tools/db.js pipeline assign <id> <agent-session-key>

# View item with full history
node tools/db.js pipeline show <id>

# List by stage
node tools/db.js pipeline list [--stage idea|spec|building|review|done|blocked]
```

### Board View Output

```
📋 Dev Pipeline

IDEA (3)
  #8  Cost alerting - ping Jason if threshold exceeded
  #7  Second brain upgrade - embeddings
  #6  Daily digest generator

SPEC (0)

BUILDING (1)
  #12 Invoice extraction pipeline [assigned: builder-abc123]
      └─ Note: "Working on PDF split logic" (2h ago)

REVIEW (0)

BLOCKED (1)
  #10 LinkedIn automation [blocker: security challenge]
      └─ Note: "Need manual login from Jason" (1d ago)

DONE (5 this week)
```

---

## Sub-Agent Guidelines Update

Add to `subagents/guidelines.md`:

```markdown
## Pipeline Workflow (REQUIRED)

Before starting work:
1. Check if there's a pipeline item for your task
2. If yes, move it to your stage and add a "started" note
3. If no, ask Opus if one should be created

During work:
- Add notes for significant decisions or blockers
- If blocked, move to `blocked` stage with reason

When complete:
1. Add completion note with summary
2. Move to next stage
3. Log to activity with `--related pipeline:<id>`

### Commands
```bash
# See what's available
node tools/db.js pipeline board

# Claim and start work
node tools/db.js pipeline move <id> building --note "Starting implementation"

# Add progress note
node tools/db.js pipeline note <id> "Completed PDF splitting, starting extraction"

# Mark blocked
node tools/db.js pipeline move <id> blocked --note "Need API key for X service"

# Complete and move to review
node tools/db.js pipeline move <id> review --note "Build complete: tools/extractor.js"
```

### Activity Logging
Always include `--related pipeline:<id>` when logging:
```bash
node tools/db.js activity add build "Completed PDF extractor" --source subagent --related pipeline:12
```
```

---

## Spawn/Complete Tracking

### On Spawn (Opus logs)

```bash
node tools/db.js activity add spawn "Spawned builder for invoice pipeline" \
  --source main \
  --related pipeline:12 \
  --meta '{"agent":"builder","model":"sonnet","session":"abc123","started_at":"2026-02-05T07:30:00Z"}'
```

### On Complete (Auto-logged from announcement)

When sub-agent completes, log:

```bash
node tools/db.js activity add complete "Builder finished invoice pipeline" \
  --source subagent \
  --related pipeline:12 \
  --meta '{"duration_sec":113,"tokens_in":8,"tokens_out":363,"tokens_total":49400,"cost":0.035,"status":"success"}'
```

### Tracking Fields

| Field | Source | Description |
|-------|--------|-------------|
| `started_at` | Spawn time | ISO timestamp |
| `duration_sec` | Completion announcement | Runtime in seconds |
| `tokens_in` | OpenClaw stats | Input tokens |
| `tokens_out` | OpenClaw stats | Output tokens |  
| `tokens_total` | OpenClaw stats | Total context tokens |
| `cost` | OpenClaw stats | USD cost |
| `status` | Completion | success / failed / timeout |

---

## Implementation Plan

### Phase 1: Database + CLI (Builder task)
- [ ] Add columns to pipeline table
- [ ] Update `updatePipeline()` to log stage changes
- [ ] Add CLI commands: `board`, `move`, `note`, `show`, `assign`
- [ ] Update `activity add` to validate `--related` format

### Phase 2: Guidelines + Personas (Manual update)
- [ ] Update `subagents/guidelines.md` with pipeline workflow
- [ ] Update each persona to reference pipeline usage
- [ ] Add pipeline commands to persona workflows

### Phase 3: Testing
- [ ] Create test pipeline item
- [ ] Spawn builder with pipeline assignment
- [ ] Verify activity logs capture all changes
- [ ] Verify notes persist and display correctly

---

## Acceptance Criteria

1. **Kanban view works:** `db.js pipeline board` shows all items by stage
2. **Stage changes log:** Moving item logs to activity with `related_id`
3. **Notes persist:** Can add/view notes on any pipeline item
4. **Sub-agents use it:** Guidelines updated, tested with real spawn
5. **Spawn tracking:** Spawn/complete events captured with time + cost
6. **History visible:** `db.js pipeline show <id>` shows full item history

---

## Out of Scope (Future)

- Web UI for pipeline board
- Automatic agent assignment based on workload
- SLA tracking (time in stage)
- Integration with external tools (Linear, GitHub Issues)

---

## Notes

This is foundational infrastructure. Get it right before building more features. Every future build should flow through this pipeline.
