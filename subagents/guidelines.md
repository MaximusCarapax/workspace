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
