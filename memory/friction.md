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

### 2026-02-05 — Oversized chunks failing embeddings
**Context:** Session Memory cron runs every 5 min, trying to embed chunks
**Friction:** 6 chunks from old session (d026368f) are 25k-75k tokens — way over 8192 limit for embedding model
**Impact:** Minor — keeps logging failures, but search works via BM25
**Fix:** Needs chunking logic to enforce max size. Low priority.
**Lesson:** Should have had max-chunk-size from the start. Need to add size enforcement to chunking.

### 2026-02-05 — Sub-agents + aider = context explosion
**Context:** Spawned two builder sub-agents to implement BM25 and Knowledge Cache
**Friction:** Both hit 200K context limit within ~60s. Aider dumps full file contents into chat history, which fills the sub-agent context fast when polling.
**Impact:** Major — both builds failed, no output
**Fix:** Wrote the code directly myself instead
**Lesson:** Sub-agent + aider combo doesn't work for complex tasks. Options: (1) I drive aider directly with smaller steps, (2) skip aider and write code directly, (3) sub-agents use simpler tools. The overhead of aider's verbose output is brutal in a sub-agent context.

### 2026-02-06 — Hume voice agent parroting loop
**Context:** Outbound call to Kevin via Hume EVI
**Friction:** Max kept repeating back what Kevin said as "So you're asking..." instead of conversing. Kevin roasted him.
**Impact:** Major — call was useless, made us look bad
**Fix:** Rewrote prompt (no parroting rules), switched from Hume Native LLM to Gemini 2.5 Flash
**Lesson:** Hume's native LLM is too dumb for real conversations. Always use a real LLM (Gemini/Claude).

### 2026-02-06 — Hume transcript API response keys wrong
**Context:** Auto-transcript retrieval after calls
**Friction:** Script looked for `data.chats` but API returns `data.chats_page`. Same for events.
**Impact:** Moderate — transcripts silently failed to retrieve
**Fix:** Updated to check `chats_page || chats` and use single-chat endpoint for events
**Lesson:** Always check actual API response shape, not assume from docs.

### 2026-02-06 — Calendar timezone bug (UTC vs Melbourne)
**Context:** Created calendar event after voice call booking
**Friction:** "12pm playdate" showed as 11pm on Jason's phone. `new Date()` parsed naive datetime as UTC, then `toISOString()` sent it as UTC. TimeZone field was cosmetic only.
**Impact:** Major — wrong time on calendar
**Fix:** Pass raw datetime string without Date() conversion, let Google interpret with timeZone field
**Lesson:** Never use `new Date(naiveString).toISOString()` when you mean local time. Server is UTC.

### 2026-02-06 — Hume config PATCH vs POST confusion
**Context:** Trying to update Hume EVI config prompt
**Friction:** PATCH returned `1` but didn't create new version. POST (create new version) was the correct method.
**Impact:** Minor — wasted time debugging
**Fix:** Use POST to `/v0/evi/configs/{id}` to create new versions
**Lesson:** Hume configs are versioned — PATCH doesn't seem to work, POST creates a new version.

---

*Add new entries at the bottom. Review weekly on Sunday.*
