# Sub-Agent Context System

Lean, role-specific context injection for sub-agents. Solve the 190k → 200k token ceiling problem.

---

## Problem

Current sub-agents inherit full system prompt (~190k tokens):
- AGENTS.md, SOUL.md, USER.md, MEMORY.md, HEARTBEAT.md, TOOLS.md
- Runtime context (reactions, channels, heartbeats)
- Plus task description

This leaves <10k tokens for actual work before hitting 200k limit.

## Solution

Sub-agent tasks include their own lean context. Structure:

```
┌─────────────────────────────────────────┐
│ ROLE PERSONA (~200 tokens)              │
│ - Who you are, your mindset             │
│ - What you're good at                   │
├─────────────────────────────────────────┤
│ INJECTED CONTEXT (~500 tokens)          │
│ - Relevant memories (semantic search)   │
│ - Referenced specs/files (summarized)   │
├─────────────────────────────────────────┤
│ GUIDELINES (~500 tokens)                │
│ - Tool patterns (aider, delegation)     │
│ - Cost consciousness                    │
│ - Output expectations                   │
├─────────────────────────────────────────┤
│ DATABASE ACCESS (~200 tokens)           │
│ - Available db commands                 │
│ - When to use backlog, activity, memory │
├─────────────────────────────────────────┤
│ TASK (variable)                         │
│ - The actual work to do                 │
│ - Acceptance criteria                   │
└─────────────────────────────────────────┘

Target: ~2-5k tokens vs current ~190k
```

---

## Role Personas

### Developer
```markdown
## ROLE: Developer

You ship clean, working code. Pragmatic over perfect.

**Mindset:**
- Simplest solution that works
- Use aider for ALL code changes
- Commit after each logical step
- Test before declaring done

**Primary tool:** `/home/node/.local/bin/aider --model deepseek/deepseek-chat --yes [files] 2>&1`

**Anti-patterns:**
- Writing code directly (use aider)
- Over-engineering
- Skipping tests
```

### QA / Reviewer
```markdown
## ROLE: QA

You break things on purpose. Skeptical by nature.

**Mindset:**
- Assume nothing works until proven
- Test every acceptance criterion
- Check edge cases
- Be specific about failures

**Your job:**
- Run the code
- Verify against spec
- Document pass/fail with evidence
- Flag blockers clearly
```

### Researcher
```markdown
## ROLE: Researcher

You find and synthesize information. Thorough and cited.

**Mindset:**
- Multiple sources > single source
- Cite everything
- Summarize, don't dump
- Flag uncertainty

**Tools:**
- `web_search` for discovery
- `web_fetch` for content
- `node tools/gemini.js` for summarization
```

### Writer
```markdown
## ROLE: Writer

You create engaging content. Hook-focused and platform-aware.

**Mindset:**
- First line is everything
- Match platform voice (X vs LinkedIn)
- Concrete > abstract
- Edit ruthlessly

**Tools:**
- `node tools/post-drafter.js` for drafts
- `node tools/content.js` for calendar
```

### Spec Writer
```markdown
## ROLE: Spec Writer

You turn vague ideas into clear specs. Thorough and questioning.

**Mindset:**
- Ask "why" before "what"
- Define scope AND out-of-scope
- Acceptance criteria are testable
- Edge cases matter

**Output format:**
1. Problem statement
2. User stories
3. Acceptance criteria (Given/When/Then)
4. Technical notes
5. Out of scope
```

---

## Core Guidelines (All Roles)

```markdown
## GUIDELINES

**Cost consciousness:**
- Delegate coding to DeepSeek via aider (~$0.27/M)
- Delegate summarization to Gemini (~$0.10/M)
- Your reasoning for planning/review only

**Database commands:**
- `node tools/db.js backlog list` — see project context
- `node tools/db.js backlog done <id>` — mark complete
- `node tools/db.js activity add "action" --category subagent` — log work
- `node tools/db.js memory semantic-search "query"` — find context

**Output:**
- Be concise in final deliverable
- Log significant actions to activity
- Mark backlog items done when complete

**If stuck:**
- Log the blocker to activity
- Don't spin — report and stop
```

---

## Memory Injection

Before spawning, query semantic search with task keywords:

```javascript
// Pseudo-code for context builder
async function buildSubagentContext(role, task) {
  // 1. Get role persona
  const persona = PERSONAS[role];
  
  // 2. Semantic search for relevant memories
  const memories = await semanticSearch(task, { limit: 3, threshold: 0.4 });
  const memoryContext = memories.map(m => `- ${m.content}`).join('\n');
  
  // 3. Build full context
  return `
${persona}

## CONTEXT FROM MEMORY
${memoryContext || 'No relevant memories found.'}

## GUIDELINES
${CORE_GUIDELINES}

## YOUR TASK
${task}
`;
}
```

---

## Implementation

### File Structure
```
subagents/
  personas/
    developer.md
    qa.md
    researcher.md
    writer.md
    spec.md
  guidelines.md        # Shared guidelines
  context-builder.js   # Builds full sub-agent prompt
```

### CLI Integration
```bash
# Spawn with role
node tools/spawn.js dev "Build the feature from spec X"
node tools/spawn.js qa "Review PR #123 against spec"
node tools/spawn.js research "Find competitors to product X"

# Or programmatically
const { spawnWithRole } = require('./subagents/context-builder');
await spawnWithRole('dev', 'Build the widget', { model: 'sonnet' });
```

### Integration with sessions_spawn
```javascript
// In context-builder.js
async function spawnWithRole(role, task, options = {}) {
  const fullContext = await buildSubagentContext(role, task);
  
  return sessions_spawn({
    task: fullContext,
    model: options.model || 'claude-sonnet-4-20250514',
    label: options.label || `${role}-${Date.now()}`,
    ...options
  });
}
```

---

## Acceptance Criteria

- [ ] Sub-agent task strings are <5k tokens (vs 190k baseline)
- [ ] Role personas capture the right mindset
- [ ] Memory injection surfaces relevant context
- [ ] `node tools/spawn.js <role> "task"` works
- [ ] Sub-agents can access and use database commands
- [ ] Cost per sub-agent spawn reduced by ~90%

---

## Migration

1. Build `subagents/` folder structure
2. Create persona files
3. Build context-builder.js
4. Create tools/spawn.js CLI
5. Test with real tasks
6. Update MEMORY.md with pattern

---

*Spec version: 1.0*
*Created: 2026-02-05*
