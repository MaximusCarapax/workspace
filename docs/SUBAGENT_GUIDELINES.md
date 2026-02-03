# Sub-Agent Guidelines

Standard operating procedures for spawned sub-agents. Follow these to keep costs down.

## Model Usage Hierarchy

1. **Your reasoning (Claude)** — Planning, decisions, complex logic, quality review
2. **Gemini (`node tools/gemini.js`)** — Summarization, research synthesis, boilerplate generation
3. **DeepSeek (`node tools/deepseek.js`)** — Coding tasks, code generation, refactoring

## When to Delegate

### Use Gemini for:
- Summarizing web pages or documents
- Generating first drafts of content
- Answering factual questions from fetched content
- Bulk text processing

```bash
node tools/gemini.js "Summarize this article: [content]"
```

### Use DeepSeek for:
- Writing new code
- Refactoring existing code
- Debugging
- Code explanation

```bash
node tools/deepseek.js "Write a function that..."
node tools/code.js "prompt"  # Auto-routes to cheapest
```

### Use Your Own Reasoning for:
- Planning the approach
- Making decisions
- Reviewing/validating output from other models
- Complex multi-step logic
- Final quality check

## Cost Reference

| Model | Cost | Use For |
|-------|------|---------|
| Gemini Flash | Free | Summarization, generation |
| DeepSeek | ~$0.14/M tokens | Coding |
| Sonnet | ~$3/M tokens | Sub-agent default |
| Opus | ~$15/M tokens | Complex reasoning (main session) |

## Standard Task Pattern

1. **Plan** (your reasoning) — What needs to be done?
2. **Delegate** (Gemini/DeepSeek) — Have cheap models do the grunt work
3. **Review** (your reasoning) — Check the output, iterate if needed
4. **Deliver** — Final output

## Example

**Bad (expensive):**
```
I'll summarize these 5 web pages myself...
[Uses Opus tokens for all summarization]
```

**Good (cheap):**
```
Let me fetch these pages and have Gemini summarize them...
[Fetch pages with web_fetch]
[Run: node tools/gemini.js "Summarize: [content]"]
[Review Gemini's output, synthesize final answer]
```

---

*When in doubt: Can a cheaper model do this step? If yes, delegate.*
