# Alignment Checklist

Quick verification that new work follows established patterns.

---

## When to Run

| Trigger | Checklist |
|---------|-----------|
| New tool created | Full |
| New persona/template | Full |
| Model routing changes | Routing section only |
| Major refactor | Full |
| Bug fix | Lite (test + commit) |
| Config change | Routing + test |

**Rule of thumb:** If it touches delegation, models, or adds new capabilities → full check.

---

## Full Checklist

### 1. Model Routing ✓
- [ ] Uses `gemini-2.5-flash-lite` for summarization (not 2.0-flash, not direct Gemini)
- [ ] Uses DeepSeek via aider for coding (not Opus, not Gemini)
- [ ] Uses OpenAI `text-embedding-3-small` for embeddings
- [ ] No direct `generativelanguage.googleapis.com` calls (use OpenRouter)

### 2. Tool References ✓
- [ ] Aider path correct: `/home/node/.local/bin/aider --model deepseek/deepseek-chat`
- [ ] Tool paths exist and are correct
- [ ] API keys loaded from correct locations (credentials.js, .env, secrets/)

### 3. Delegation Rules ✓
- [ ] Opus plans/judges, doesn't generate code directly
- [ ] Coding → aider/DeepSeek
- [ ] Summarization → Gemini 2.5-flash-lite
- [ ] Research → tools/research.js with -s flag
- [ ] Matches patterns in `MEMORY.md` and `subagents/guidelines.md`

### 4. File Conventions ✓
- [ ] Tools in `tools/`
- [ ] Libs in `lib/`
- [ ] Personas in `subagents/personas/`
- [ ] Specs in `specs/`
- [ ] Docs in `docs/`
- [ ] Daily logs in `memory/YYYY-MM-DD.md`

### 5. Output Formats ✓
- [ ] Follows persona output structure (if applicable)
- [ ] Consistent with similar tools
- [ ] Errors are clear and actionable

### 6. No Conflicts ✓
- [ ] No duplicate functionality with existing tools
- [ ] No overlapping personas (check existing: dev, qa, spec, researcher, builder, writer, reviewer)
- [ ] No hardcoded values that should be configurable

### 7. Tests ✓
- [ ] Runs without error
- [ ] Produces expected output
- [ ] Edge cases handled (empty input, missing keys, etc.)

### 8. Documentation ✓
- [ ] TOOLS.md updated if new tool
- [ ] Help text included (`-h` flag)
- [ ] Comments for non-obvious logic

---

## Lite Checklist (Bug Fixes)

- [ ] Fix doesn't break existing functionality
- [ ] Tests pass
- [ ] Committed with clear message

---

## How to Run

**Manual (during review):**
```
Read through checklist, verify each item
```

**Automated (future):**
```bash
# TODO: Create tools/alignment-check.js
node tools/alignment-check.js [file-or-folder]
```

---

## Examples

**New tool created:**
1. Run full checklist
2. Test with real input
3. Update TOOLS.md
4. Commit

**Persona added:**
1. Check model references in persona
2. Test via spawn
3. Verify no duplicate roles
4. Commit

**Model routing change:**
1. Grep for old model references
2. Update all files
3. Test each tool
4. Commit

---

*Last updated: 2026-02-05*
