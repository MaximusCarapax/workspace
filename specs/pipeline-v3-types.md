# Pipeline V3: Feature/Story Types with Rollup

**Status:** Draft  
**Author:** Max  
**Date:** 2026-02-05  
**Pipeline:** #304  
**Priority:** High (workflow improvement)

---

## Overview

Add `type` field to pipeline items to support two distinct workflows:
- **Features** — high-level product work with spec/review cycle
- **Stories** — implementation tasks with simpler todo→done cycle

Stories link to features via `parent_id`. Feature progress rolls up from story completion.

---

## Schema Changes

### Add `type` column

```sql
ALTER TABLE pipeline ADD COLUMN type TEXT DEFAULT 'feature';
-- Valid values: 'feature', 'story'
```

### Stage validation per type

```javascript
const STAGES = {
  feature: ['idea', 'spec', 'spec-review', 'building', 'live'],
  story: ['todo', 'in-progress', 'qa', 'done', 'blocked']
};
```

---

## Workflow

### Features
```
idea → spec → spec-review → building → live
```
- Spec phase generates child stories
- Moves to "building" when first story starts
- Moves to "live" when all stories done (or manual)

### Stories
```
todo → in-progress → qa → done (+ blocked)
```
- Created during feature spec phase
- Linked via `parent_id`
- Simpler cycle, no spec needed
- Assignable to builders

---

## CLI Updates

### Create with type
```bash
# Create feature (default)
pipeline create "Invoice Extractor" --type feature

# Create story linked to feature
pipeline create "PDF page splitting" --type story --parent 25
```

### Board shows both
```bash
pipeline board

📦 FEATURES
  [building] #25 Invoice Extractor (2/4 stories)
  [live] #8 Cost Alerting (3/3 stories)

📋 STORIES
  Todo:
    #101 Add retry logic (→ #25)
  In Progress:
    #102 Vision AI calls (→ #25)
  QA:
    (empty)
  Done:
    #103 PDF splitting (→ #25)
  Blocked:
    (empty)
```

### Filter by type
```bash
pipeline board --type feature   # Features only
pipeline board --type story     # Stories only
pipeline list --type story --parent 25  # Stories for feature #25
```

### Progress rollup
```bash
pipeline show 25

📦 Feature #25: Invoice Extractor
   Stage: building
   Progress: 2/4 stories done (50%)
   
   Stories:
     ✅ #103 PDF splitting [done]
     ✅ #104 JSON output [done]
     🔨 #102 Vision AI [in-progress]
     📋 #101 Retry logic [todo]
```

---

## Auto-transitions (optional)

| Trigger | Action |
|---------|--------|
| First story moves to `in-progress` | Feature moves to `building` |
| All stories reach `done` | Feature auto-moves to `live` (or prompt) |
| Story moves to `blocked` | Feature shows warning |

Can be manual-only initially, add automation later.

---

## Migration

1. Add `type` column with default `'feature'`
2. Existing items stay as features
3. Update stage validation to check type
4. Update CLI commands
5. Update board display

---

## Acceptance Criteria

1. [ ] `type` column exists with values: feature, story
2. [ ] Stage validation enforced per type
3. [ ] `pipeline create --type story --parent X` works
4. [ ] `pipeline board` shows features and stories separately
5. [ ] `pipeline show <feature>` shows story progress rollup
6. [ ] `pipeline list --type X --parent Y` filters work
7. [ ] Existing items unaffected (default to feature)

---

## Future Enhancements (Out of Scope)

- Auto-generate stories from spec (AI-assisted)
- Story points / effort estimation
- Sprint/iteration grouping
- Burndown charts
- Auto-transitions based on story state
