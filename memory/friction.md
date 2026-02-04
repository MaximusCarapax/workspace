# Friction Log

Real-time capture of process problems, bugs, and annoyances. Reviewed weekly.

---

## Format
```
### YYYY-MM-DD — Brief title
**Context:** What were you doing?
**Friction:** What went wrong?
**Impact:** How bad? (minor/moderate/major)
**Fix:** What did you do? (or "needs fix")
**Lesson:** What should change?
```

---

## Log

### 2026-02-04 — Duplicate X posts
**Context:** Morning X post cron
**Friction:** Posted same "Week 1 learnings" content twice with different framing
**Impact:** Moderate — wasted a post, looked sloppy
**Fix:** Added dedup check to x-post.js (60% Jaccard similarity threshold)
**Lesson:** Always check recent posts before publishing. Migrated tracking to SQLite for durability.

### 2026-02-04 — LinkedIn security challenge
**Context:** LinkedIn Post cron tried to run
**Friction:** Security challenge blocked headless login
**Impact:** Moderate — can't post to LinkedIn automatically
**Fix:** Needs manual browser session refresh
**Lesson:** LinkedIn cookies expire frequently. Need a better auth refresh strategy or alert when cookies are stale.

### 2026-02-04 — Haiku 4.5 model name wrong
**Context:** Heartbeat failing
**Friction:** Used `claude-haiku-4-5-latest` (doesn't exist)
**Impact:** Minor — heartbeats failing until fixed
**Fix:** Changed to `claude-haiku-4-5-20251001`
**Lesson:** Always verify model names against Anthropic API. No `-latest` alias for 4.5 models yet.

---

*Add new entries at the bottom. Review weekly on Sunday.*
