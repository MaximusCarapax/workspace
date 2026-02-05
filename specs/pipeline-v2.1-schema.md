# Pipeline V2.1 — Live Stage + Relational Links

**Status:** Draft  
**Author:** Max  
**Date:** 2026-02-05  
**Pipeline:** #38  
**Priority:** High (infrastructure)

---

## Overview

Extend the pipeline to support production lifecycle:
- `live` stage for shipped features
- Parent/child relationships for incidents linked to features
- Health check field for monitoring

---

## Schema Changes

### 1. Add `live` to stages

```sql
-- Update CHECK constraint for stage
ALTER TABLE pipeline DROP CONSTRAINT IF EXISTS pipeline_stage_check;
-- New stages: idea, spec, spec-review, building, qa, final-review, done, live
```

Note: SQLite doesn't support DROP CONSTRAINT directly. Need to recreate table or handle in code validation.

**Simpler approach:** Just update the code validation, don't enforce at DB level.

### 2. Add `parent_id` for relational links

```sql
ALTER TABLE pipeline ADD COLUMN parent_id INTEGER REFERENCES pipeline(id) ON DELETE SET NULL;
CREATE INDEX idx_pipeline_parent ON pipeline(parent_id);
```

**Use cases:**
- Incident linked to parent feature: `parent_id = feature_id`
- Sub-task of larger epic: `parent_id = epic_id`
- Enhancement to existing feature: `parent_id = original_feature_id`

### 3. Add `health_check` field (optional)

```sql
ALTER TABLE pipeline ADD COLUMN health_check TEXT;  -- JSON config
```

**Example health_check config:**
```json
{
  "type": "command",
  "command": "node tools/invoice-extractor.js --help",
  "expect": "exit_code:0",
  "frequency": "daily"
}
```

---

## Updated Stages Flow

```
idea → spec → spec-review → building → qa → final-review → done → live
                                                            │
                                                            ↓
                                                    (monitored, can spawn incidents)
```

**Stage definitions:**

| Stage | Description |
|-------|-------------|
| idea | Problem + context defined |
| spec | Detailed solution + acceptance criteria |
| spec-review | Opus approves spec matches intent |
| building | Implementation in progress |
| qa | QA agent testing |
| final-review | Security, quality, patterns check |
| done | Code complete, ready to ship |
| live | In production, being monitored |

---

## CLI Updates

```bash
# Move to live (after done)
node tools/db.js pipeline move <id> live --note "Shipped to production"

# Create incident linked to parent
node tools/db.js pipeline create "Fix timeout in extractor" --parent 25

# Show with children
node tools/db.js pipeline show <id> --children

# List live features
node tools/db.js pipeline list --stage live

# Board shows live count
node tools/db.js pipeline board
# Output includes: 🟢 LIVE (5)
```

---

## Implementation

### lib/db.js changes:

1. Add migration for `parent_id` column
2. Add migration for `health_check` column
3. Update `createPipeline()` to accept `parentId`
4. Add `getChildItems(pipelineId)` function
5. Update stage validation to include new stages

### tools/db.js changes:

1. Add `--parent <id>` flag to create command
2. Add `--children` flag to show command
3. Update board to show LIVE stage
4. Add `--stage live` filter support

---

## Acceptance Criteria

1. [ ] Can move items to `live` stage
2. [ ] Can create items with `parent_id` link
3. [ ] `pipeline show <id> --children` shows linked items
4. [ ] `pipeline board` shows LIVE section
5. [ ] Activity logs capture live transitions
6. [ ] Can query items by parent: `--parent <id>`

---

## Future (not in this PR)

- Health check cron job
- Project-level dashboard
- Automatic incident creation on health failure
- BAU reporting view
