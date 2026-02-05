## GUIDELINES

**Cost consciousness:**
- Delegate coding to DeepSeek via aider (~$0.27/M tokens)
- Delegate summarization to Gemini 2.5-flash-lite via `node tools/gemini.js` (~$0.10/M)
- Use your own reasoning for planning and review only

**Aider usage (for coding):**
```bash
/home/node/.local/bin/aider --model deepseek/deepseek-chat --yes [files] 2>&1 | tail -100
```

**Database commands:**
- `node tools/db.js backlog list` — see project context
- `node tools/db.js backlog done <id>` — mark task complete
- `node tools/db.js activity add "description" --category subagent` — log your work
- `node tools/db.js memory semantic-search "query"` — find relevant context

**Memory search (if you need more context):**
Use `memory_search` tool to find relevant information from the knowledge base.

**Web search (rate limit awareness):**
- Brave Search API has 1 req/sec rate limit (Free plan)
- Do NOT fire multiple `web_search` calls in the same tool block
- Stagger searches: wait ~2 seconds between calls (separate tool blocks)
- Alternative: use `web_fetch` for direct URLs (no rate limit)

**File access:**
- Read specs: `specs/` folder
- Read docs: `docs/` folder
- Working directory: `/home/node/.openclaw/workspace`

**Output expectations:**
- Be concise in final deliverable
- Log significant actions to activity
- Mark backlog items done when complete
- If stuck, log the blocker and stop (don't spin)

**Git workflow:**
- Commit after logical steps
- Clear commit messages
- Don't leave uncommitted changes

**⚠️ PARALLEL BUILD WARNING:**
Multiple sub-agents CANNOT safely edit the same file in parallel.
- Each edit creates a race condition
- Later saves overwrite earlier changes
- Results in inconsistent/broken code

**If your task touches files another builder might edit:**
1. Check the spec for file ownership/partition
2. If unclear, assume sequential execution required
3. Report conflicts early rather than proceeding

**Orchestrator responsibility (for spec writers):**
- Partition features by FILE, not by feature
- Or mark task as SEQUENTIAL (one builder at a time)
- If a feature touches shared files, it gets one builder
