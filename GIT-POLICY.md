# Git Policy

Rules for when and how to commit/push changes.

## When to Push

✅ **DO push when:**
- Completing a feature or fix
- After testing tools/scripts work
- Documentation updates
- Config changes (non-secret)
- End of work session (checkpoint)

❌ **DON'T push when:**
- Work is half-done or broken
- Contains API keys, tokens, or secrets
- Debugging/experimental code
- Large binary files (>10MB)
- Sensitive personal data

## Security Checks

### Pre-commit Hook (Automatic)
Every commit runs `tools/git-security-check.js` which scans for:
- API keys (Google, AWS, OpenAI, Anthropic, etc.)
- Tokens (GitHub, Slack, Discord, Telegram)
- Private keys
- Passwords in URLs
- Other secret patterns

**If secrets detected:** Commit is blocked. Fix or use `--fix` flag.

### Push Wrapper
Use `node tools/git-push.js` instead of raw `git push`:
- Runs full security scan
- Shows what's being pushed
- Notifies Jason after push

```bash
node tools/git-push.js              # Normal push + notify
node tools/git-push.js --dry-run    # Preview only
```

## Secret Handling

### Where secrets belong:
- `.env` file (gitignored)
- `~/.openclaw/secrets/` directory
- Environment variables

### Where secrets DON'T belong:
- Memory files (`memory/*.md`)
- TOOLS.md, MEMORY.md
- Any `.md` file
- Any `.js` source file
- Commit messages

### If you need to document a secret:
```markdown
# Wrong ❌
API Key: AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# Right ✅
API Key: [in .env as GEMINI_API_KEY]
```

## Commands

```bash
# Check staged files for secrets
node tools/git-security-check.js

# Check ALL tracked files
node tools/git-security-check.js --all

# Auto-redact and re-stage
node tools/git-security-check.js --fix

# Secure push with notification
node tools/git-push.js
```

## Bypassing (Emergency Only)

```bash
git commit --no-verify  # Skip pre-commit hook
```

**Only use if:** You're 100% certain there are no secrets and the scanner has a false positive.

---

*Created 2026-02-04 after API key exposure incident.*
