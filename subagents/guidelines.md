## GUIDELINES

---

## 🎯 Pipeline Workflow (REQUIRED)

All work flows through the dev pipeline. Check it first, use it always.

### Before Starting Work
1. Check if there's a pipeline item: `node tools/db.js pipeline board`
2. If assigned to you → move to your stage + add "started" note
3. If no item exists → ask Opus if one should be created

### During Work
- Add notes for decisions, progress, blockers
- If blocked → move to `blocked` stage with reason
- Log significant actions to activity with `--related pipeline:<id>`

### When Complete
1. Add completion note with summary
2. Move to next stage
3. Verify activity logged properly

### Pipeline Commands
```bash
# See kanban board
node tools/db.js pipeline board

# Claim and start work
node tools/db.js pipeline move <id> building --note "Starting implementation"

# Add progress note  
node tools/db.js pipeline note <id> "Completed X, starting Y"

# Mark blocked
node tools/db.js pipeline move <id> blocked --note "Need API key for X"

# Complete and move to review
node tools/db.js pipeline move <id> review --note "Build complete: [files]"
```

### Activity Logging
Always include source and related item:
```bash
node tools/db.js activity add build "Completed PDF extractor" \
  --source subagent \
  --related pipeline:12 \
  --meta '{"files":"tools/extractor.js"}'
```

### Stage Flow
```
idea → spec → building → review → done
                ↓
             blocked (with reason)
```

---

## 💰 Cost Consciousness

- Delegate coding to DeepSeek via aider (~$0.27/M tokens)
- Delegate summarization to Gemini via `node tools/gemini.js` (~$0.10/M)
- Use your own reasoning for planning and review only

---

## 🔧 Aider Usage (for coding)

```bash
/home/node/.local/bin/aider --model deepseek/deepseek-chat --yes [files] 2>&1 | tail -100
```

---

## 📊 Database Commands

```bash
# Pipeline (primary workflow)
node tools/db.js pipeline board              # Kanban view
node tools/db.js pipeline move <id> <stage>  # Change stage
node tools/db.js pipeline note <id> "text"   # Add note
node tools/db.js pipeline show <id>          # Full history

# Backlog (secondary)
node tools/db.js backlog list                # See tasks
node tools/db.js backlog done <id>           # Mark complete

# Activity logging
node tools/db.js activity add <category> "description" --source subagent --related pipeline:<id>

# Memory search
node tools/db.js memory semantic-search "query"
```

---

## 🔍 Memory & Web Search

**Memory search:** Use `memory_search` tool for knowledge base context.

**Web search (rate limited):**
- Brave API: 1 req/sec limit (Free plan)
- Do NOT fire multiple `web_search` calls in same tool block
- Stagger searches ~2 seconds apart
- Alternative: `web_fetch` for direct URLs (no limit)

---

## 📁 File Access

- Specs: `specs/` folder
- Docs: `docs/` folder  
- Personas: `subagents/personas/`
- Working directory: `/home/node/.openclaw/workspace`

---

## ✅ Output Expectations

- Be concise in final deliverable
- Log significant actions to activity (with `--related` when applicable)
- Update pipeline item status when done
- If stuck, log the blocker and STOP (don't spin)

---

## 🔀 Git Workflow

- Commit after logical steps
- Clear commit messages (feat/fix/chore)
- Don't leave uncommitted changes

---

## ⚠️ Parallel Build Warning

Multiple sub-agents CANNOT safely edit the same file in parallel.

**If your task touches shared files:**
1. Check the spec for file ownership
2. If unclear, assume sequential execution
3. Report conflicts early

**Orchestrator responsibility:**
- Partition features by FILE, not by feature
- Mark tasks as SEQUENTIAL when needed
