# Content Pipeline v2 Spec

## Overview
Kanban-style content pipeline: Ideas → Hooks → Drafts → Review → Scheduled → Posted

## Current State
- `tools/content.js` — basic calendar with id, title, platform, status, notes
- `tools/post-drafter.js` — AI drafting
- `tools/x-post.js`, `tools/linkedin.js` — posting
- Writer + Reviewer personas

## Target State
Full pipeline with hook generation, review scoring, and automated flow.

---

## Database Schema Updates

**content_items table additions:**
```sql
ALTER TABLE content_items ADD COLUMN hooks TEXT; -- JSON array of hook options
ALTER TABLE content_items ADD COLUMN selected_hook TEXT; -- chosen hook
ALTER TABLE content_items ADD COLUMN draft TEXT; -- full post content
ALTER TABLE content_items ADD COLUMN review_score INTEGER; -- 1-10
ALTER TABLE content_items ADD COLUMN review_notes TEXT; -- reviewer feedback
ALTER TABLE content_items ADD COLUMN scheduled_time TEXT; -- ISO timestamp
ALTER TABLE content_items ADD COLUMN posted_time TEXT; -- when actually posted
ALTER TABLE content_items ADD COLUMN post_url TEXT; -- link to live post
```

**Status values:**
- `idea` — raw input
- `hooks` — hooks generated, awaiting selection
- `draft` — full draft created
- `review` — under review
- `scheduled` — approved, queued
- `posted` — live

---

## New Commands

### 1. Generate Hooks
```bash
node tools/content.js hooks <id>
```
- Takes an idea (by ID)
- Generates 3-5 hook options using Gemini
- Stores in `hooks` column as JSON array
- Updates status to `hooks`

**Hook generation prompt:**
```
Idea: {title}
Context: {notes}
Platform: {platform}

Generate 5 hook options. Each should:
- Stop the scroll
- Be under 15 words
- Create curiosity or make a bold claim

Return as JSON array: ["hook1", "hook2", ...]
```

### 2. Select Hook
```bash
node tools/content.js select <id> <hook_number>
```
- Picks one of the generated hooks
- Stores in `selected_hook`
- Status stays at `hooks` until draft is created

### 3. Generate Draft
```bash
node tools/content.js draft <id>
```
- Takes selected hook
- Expands into full post using Writer persona/Gemini
- Stores in `draft` column
- Updates status to `draft`

**Draft prompt:**
```
Hook: {selected_hook}
Platform: {platform}
Original idea: {title} - {notes}

Write a {platform} post that:
- Opens with this hook
- Delivers value (teach, entertain, or provoke)
- Ends with a CTA or question
- Matches platform conventions

Keep it punchy. No fluff.
```

### 4. Review Draft
```bash
node tools/content.js review <id>
```
- Scores draft against criteria using Reviewer persona/Gemini
- Stores `review_score` (1-10) and `review_notes`
- Updates status to `review`

**Review criteria:**
1. Hook strength (1-10)
2. Clarity (1-10)
3. Value delivered (1-10)
4. CTA effectiveness (1-10)
5. Platform fit (1-10)

**Output:** Average score + specific feedback

### 5. Approve & Schedule
```bash
node tools/content.js approve <id> [--time "2026-02-06 09:00"]
```
- Requires review_score >= 7 (or --force)
- Sets `scheduled_time`
- Updates status to `scheduled`

### 6. Post
```bash
node tools/content.js post <id>
```
- Posts to platform using x-post.js or linkedin.js
- Sets `posted_time` and `post_url`
- Updates status to `posted`

---

## List/View Commands

### Kanban View
```bash
node tools/content.js kanban
```
Output:
```
IDEAS (3)          HOOKS (2)         DRAFTS (1)        REVIEW (0)        SCHEDULED (2)
─────────────────────────────────────────────────────────────────────────────────────
C001: AI agents    C004: Debugging   C007: Remote      -                 C010: Prod tips
C002: Sub-agents   C005: Cost mgmt                                       C011: Tool recs
C003: Automation
```

### Pipeline Stats
```bash
node tools/content.js stats
```
- Count by status
- Average review scores
- Posts this week/month

---

## Automation (Future)

### Auto-promote Cron
Daily cron that:
1. Finds ideas older than 24h → generates hooks
2. Finds drafts with score >= 8 → auto-schedules
3. Posts anything scheduled for now

### Idea Ingestion
- `insights.js` auto-adds to content calendar
- `reddit-pulse.js` findings become ideas
- Daily memory review surfaces content-worthy items

---

## File Structure
All changes in `tools/content.js` — extend existing tool.

---

## Testing
1. Add test idea: `content.js add "Test idea" --platform linkedin`
2. Generate hooks: `content.js hooks C001`
3. Select hook: `content.js select C001 2`
4. Generate draft: `content.js draft C001`
5. Review: `content.js review C001`
6. Approve: `content.js approve C001 --time "2026-02-06 10:00"`
7. Verify kanban: `content.js kanban`

---

## Success Criteria
- [ ] Can flow idea through all stages to posted
- [ ] Hooks are genuinely good (would stop scrolling)
- [ ] Review scores correlate with post quality
- [ ] Kanban view shows clear pipeline state
- [ ] All commands have --help

---

*Spec written: 2026-02-05*
