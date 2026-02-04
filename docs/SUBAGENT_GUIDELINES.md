# Sub-Agent Guidelines

Standard operating procedures for spawned sub-agents. Follow these to keep costs down.

## Model Usage Hierarchy

1. **Your reasoning (Claude)** — Planning, decisions, complex logic, quality review
2. **Gemini (`node tools/gemini.js`)** — Summarization, research synthesis, boilerplate generation
3. **DeepSeek (aider or `node tools/code.js`)** — All coding tasks

## Coding Delegation (IMPORTANT)

You are an **orchestrator**, not a code generator. Delegate coding to DeepSeek:

**For multi-file or complex code:**
```bash
/home/node/.local/bin/aider --model deepseek/deepseek-chat [files...]
```
- Aider is git-aware and handles multi-file edits
- Give it clear instructions, review its output

**For single-file code generation:**
```bash
node tools/code.js "prompt describing what to build"
node tools/code.js -f existing.js "prompt to modify this file"
```

**Direct write/edit only for:**
- Config files (JSON, YAML)
- Documentation (markdown)
- Small fixes (<10 lines)
- Non-code files

## When to Delegate

### Use Gemini for:
- Summarizing web pages or documents
- Generating first drafts of content
- Answering factual questions from fetched content
- Bulk text processing

```bash
node tools/gemini.js "Summarize this article: [content]"
```

### Use DeepSeek (via aider) for:
- Writing new code
- Refactoring existing code
- Debugging
- Multi-file changes

```bash
/home/node/.local/bin/aider --model deepseek/deepseek-chat tools/new-tool.js
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
| Gemini (OpenRouter) | ~$0.10/M in, $0.40/M out | Summarization, generation |
| DeepSeek V3.2 | ~$0.27/M in, $1.10/M out | Coding |
| Sonnet | ~$3/M in, $15/M out | Sub-agent default |
| Opus | ~$15/M in, $75/M out | Complex reasoning (main session) |

**Note:** We use OpenRouter for Gemini to avoid rate limits. It's cheap, not free.

## Standard Task Pattern

1. **Plan** (your reasoning) — What needs to be done?
2. **Delegate** (aider/Gemini) — Have cheap models do the grunt work
3. **Review** (your reasoning) — Check the output, iterate if needed
4. **Deliver** — Final output

## Example

**Bad (expensive):**
```
I'll write this code myself...
[Uses Sonnet tokens for all code generation]
```

**Good (cheap):**
```
Let me plan what's needed, then have DeepSeek implement it...
[Plan the approach]
[Run: aider --model deepseek/deepseek-chat tools/my-tool.js]
[Review DeepSeek's output, test it, iterate if needed]
```

---

*When in doubt: Can a cheaper model do this step? If yes, delegate.*
