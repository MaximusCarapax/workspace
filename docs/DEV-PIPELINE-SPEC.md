# Dev Pipeline Specification

A structured workflow for turning ideas into deployed features, with specialized sub-agents at each stage.

---

## Database Schema

```sql
-- Projects: Container for related work
CREATE TABLE projects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'active',  -- active, paused, completed, archived
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Pipeline: Features going through stages
CREATE TABLE pipeline (
  id INTEGER PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id),
  title TEXT NOT NULL,
  description TEXT,
  stage TEXT DEFAULT 'idea',  -- idea, spec, ready, build, review, done
  
  -- Spec phase
  spec_doc TEXT,              -- Full specification
  acceptance_criteria TEXT,   -- JSON array of criteria
  
  -- Approval gate
  approved_by TEXT,           -- 'jason' or null
  approved_at DATETIME,
  
  -- Build phase  
  branch_name TEXT,           -- Git branch if applicable
  
  -- Review phase
  review_notes TEXT,
  
  -- Metadata
  priority INTEGER DEFAULT 2, -- 1=urgent, 2=high, 3=medium, 4=low
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tasks: Atomic work items within a pipeline item
CREATE TABLE pipeline_tasks (
  id INTEGER PRIMARY KEY,
  pipeline_id INTEGER REFERENCES pipeline(id),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'todo',  -- todo, doing, done, blocked
  assigned_to TEXT,            -- 'spec_agent', 'dev_agent', 'qa_agent', 'me'
  output TEXT,                 -- Result/deliverable
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME
);

-- Agent handover notes
CREATE TABLE pipeline_notes (
  id INTEGER PRIMARY KEY,
  pipeline_id INTEGER REFERENCES pipeline(id),
  agent_role TEXT NOT NULL,    -- 'spec', 'dev', 'qa'
  note_type TEXT,              -- 'handover', 'blocker', 'question', 'decision'
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## Pipeline Stages

```
┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
│  IDEA   │───▶│  SPEC   │───▶│  READY  │───▶│  BUILD  │───▶│ REVIEW  │───▶│  DONE   │
└─────────┘    └─────────┘    └─────────┘    └─────────┘    └─────────┘    └─────────┘
                   │              │                              │
              Spec Agent     HUMAN GATE                     QA Agent
                   │         (Jason approves)                   │
                   ▼                                            ▼
             writes spec                                   tests & reviews
```

**Human gates:**
- IDEA → SPEC: Auto (I decide what's worth speccing)
- SPEC → READY: **Jason approves** (critical gate)
- BUILD → REVIEW: Auto (Dev Agent triggers QA)
- REVIEW → DONE: Auto or Jason final sign-off

---

## Role Templates

### Spec Agent
```markdown
## ROLE: Spec Agent

You are analytical, detail-oriented, and user-focused. Your job is to turn 
vague ideas into concrete, actionable specifications.

**Your mindset:**
- Ask "why" before "what"
- Think about edge cases
- Consider the user's perspective
- Be specific, not vague

**Your deliverables:**
1. Clear problem statement
2. User stories (As a..., I want..., So that...)
3. Acceptance criteria (Given/When/Then or checklist)
4. Technical considerations (optional)
5. Out of scope (what we're NOT doing)

**Your output:**
Write the spec to `pipeline.spec_doc` and acceptance criteria to 
`pipeline.acceptance_criteria`. Add any questions or blockers to 
`pipeline_notes` with type='question'.

**Model:** Sonnet (good at structured thinking)
**Budget:** ~$0.50 per spec
```

### Dev Agent
```markdown
## ROLE: Dev Agent

You are technical, pragmatic, and efficient. Your job is to implement 
features according to specs.

**Your mindset:**
- Simplest solution that meets the spec
- Don't over-engineer
- Write clean, maintainable code
- Test as you build

**Your workflow:**
1. Read the spec and acceptance criteria
2. Break into tasks (create in `pipeline_tasks`)
3. Implement each task using Aider
4. Update task status as you go
5. Write handover notes for QA

**Your primary tool: AIDER + DEEPSEEK**
ALL coding goes through Aider:
```bash
cd /home/node/.openclaw/workspace
aider --model deepseek/deepseek-chat --no-auto-commits \
  --message "Your implementation instruction here"
```

Why Aider:
- Git-aware (tracks changes properly)
- Multi-file edits (handles complex features)
- Project context (understands codebase)
- DeepSeek = $0.14/M tokens (basically free)

**Do NOT:**
- Write code directly (use Aider)
- Use raw DeepSeek API for coding (use Aider)
- Make one-shot API calls for implementation (use Aider)

**Your output:**
- Working code (via Aider commits)
- Tasks marked done in DB
- Handover notes in `pipeline_notes` with type='handover'

**Model:** DeepSeek via Aider (no Sonnet needed)
**Budget:** ~$0.20-0.50 per feature (DeepSeek is basically free)
```

### QA Agent
```markdown
## ROLE: QA Agent

You are skeptical, thorough, and detail-oriented. Your job is to verify 
the implementation matches the spec.

**Your mindset:**
- Assume nothing works until proven
- Test edge cases
- Check against EVERY acceptance criterion
- Be constructive, not just critical

**Your workflow:**
1. Read the spec and acceptance criteria
2. Read Dev Agent's handover notes
3. Test each acceptance criterion
4. Document results (pass/fail with evidence)
5. Flag any issues or deviations

**Your output:**
- Review notes in `pipeline.review_notes`
- Issues logged in `pipeline_notes` with type='blocker'
- Clear pass/fail for each acceptance criterion

**If issues found:**
- Stage stays at 'review'
- Dev Agent gets notified to fix

**If all pass:**
- Stage moves to 'done'
- Summary sent to Jason

**Model:** Haiku (good for checklist verification)
**Budget:** ~$0.25 per review
```

---

## Orchestration Flow

```javascript
// Example: Jason says "build a dashboard"

// 1. I create the pipeline item
await db.createPipeline({
  project_id: 1,
  title: 'Mission Control Dashboard',
  description: 'Visual dashboard for health, costs, tasks',
  stage: 'idea'
});

// 2. I spawn Spec Agent
await sessions_spawn({
  task: buildSpecAgentPrompt(pipelineItem),
  model: 'sonnet',
  label: 'spec-agent-dashboard'
});

// 3. Spec Agent writes spec, moves to 'spec' stage
// 4. I notify Jason: "Spec ready for review"

// 5. Jason approves → stage = 'ready'

// 6. I spawn Dev Agent
await sessions_spawn({
  task: buildDevAgentPrompt(pipelineItem),
  model: 'sonnet',
  label: 'dev-agent-dashboard'
});

// 7. Dev Agent builds, creates tasks, moves to 'review'

// 8. I spawn QA Agent
await sessions_spawn({
  task: buildQAAgentPrompt(pipelineItem),
  model: 'haiku',
  label: 'qa-agent-dashboard'
});

// 9. QA Agent tests, either passes or flags issues
// 10. If pass → 'done', notify Jason
// 11. If fail → back to Dev Agent with notes
```

---

## CLI Interface

```bash
# Project management
node tools/pipeline.js project list
node tools/pipeline.js project create "Agent Infrastructure"

# Pipeline items
node tools/pipeline.js list [--project <id>] [--stage <stage>]
node tools/pipeline.js add "Feature title" --project 1
node tools/pipeline.js view <id>
node tools/pipeline.js approve <id>        # Jason approves
node tools/pipeline.js stage <id> <stage>  # Manual stage change

# Run agents
node tools/pipeline.js spec <id>     # Spawn Spec Agent
node tools/pipeline.js build <id>    # Spawn Dev Agent  
node tools/pipeline.js review <id>   # Spawn QA Agent

# Notes
node tools/pipeline.js notes <id>              # View notes
node tools/pipeline.js note <id> "content"     # Add note
```

---

## Cost Estimates

| Stage | Agent | Model | Est. Cost |
|-------|-------|-------|-----------|
| Spec | Spec Agent | Sonnet | $0.30-0.50 |
| Build | Dev Agent | DeepSeek via Aider | $0.20-0.50 |
| Review | QA Agent | Haiku | $0.10-0.25 |
| **Total** | | | **$0.60-1.25** |

For comparison: Me doing everything in main session = $5-15 per feature.

**Why so cheap?** DeepSeek via Aider = $0.14/M tokens. No expensive models in build phase.

---

## Next Steps

1. [ ] Add pipeline tables to SQLite schema
2. [ ] Create role template files
3. [ ] Build `tools/pipeline.js` CLI
4. [ ] Create spawn helpers with context injection
5. [ ] Test with a real feature

---

*Spec version: 1.0*
*Created: 2026-02-04*
