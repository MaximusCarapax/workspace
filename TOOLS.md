# TOOLS.md - Local Notes

## Phone Number 📱
**+1 (820) 900-4002** - Twilio
- SMS/MMS/Voice enabled
- Trial account ($15.50 credit)
- Can send SMS, receive SMS (needs webhook setup)

## TOTP Manager
Generate 2FA codes independently without phone/app:
```bash
node tools/totp.js add <name> <secret>   # Add account
node tools/totp.js get <name>            # Get current code
node tools/totp.js list                  # List accounts
```
Secrets stored in `~/.openclaw/secrets/totp-secrets.json`

## Gmail API ✉️
Connected to **jason.x.wu.27@gmail.com** (OAuth, no send permission)
```bash
node tools/gmail.js inbox [n]       # Recent inbox
node tools/gmail.js unread [n]      # Unread messages
node tools/gmail.js read <id>       # Full message
node tools/gmail.js search <query>  # Gmail search syntax
node tools/gmail.js archive <id>    # Archive message
node tools/gmail.js label <id> <name>  # Add label
node tools/gmail.js draft <to> <subj> <body>  # Create draft (Jason sends)
```

## Web Search
Brave API configured and working. Use `web_search` tool directly.

## Browser
Headless Chromium available via `browser` tool, profile: `openclaw`
- Gmail session: logged in as maximuscarapax@gmail.com
- Can handle most web tasks except CAPTCHAs

## TTS
Edge TTS available (free, no API key needed)

## Gemini CLI (FREE - FIRST CHOICE)
Installed and configured for coding tasks:
```bash
GEMINI_API_KEY="AIzaSyAX18rImRKfVEIjUymrirhM849zXOG-3cI" gemini -p "your prompt here"
```
- **Cost:** FREE (up to quota limits)
- **Use for:** Heavy coding tasks, generation, anything that would burn Claude tokens
- **Fallback:** If quota hit, use DeepSeek

## DeepSeek CLI (CHEAP BACKUP)
```bash
node tools/deepseek.js "your prompt here"
node tools/deepseek.js -c "coding prompt"  # uses deepseek-coder model
```
- **Cost:** ~$0.14 per million input tokens (basically nothing)
- **Use for:** Coding, summarization, grunt work when Gemini quota is hit
- **Models:** `deepseek-chat` (default), `deepseek-coder` (use -c flag)

## Research Helper 🔍
Token-efficient research: I plan, cheap models fetch & summarize.
```bash
node tools/research.js -q "question" url1 url2 url3
node tools/research.js -q "question" -f urls.txt    # URLs from file
node tools/research.js --deepseek -q "question" url1  # Force DeepSeek
```
- **Primary:** Gemini (free)
- **Fallback:** DeepSeek (if Gemini quota exceeded)
- **Limits:** 4k chars/page, 20k chars total
- **Pattern:** Opus searches → script fetches & summarizes → Opus delivers

## AI Coding Stack 🔧

**Philosophy:** Opus thinks, cheap models code.

| Task | Tool | Cost |
|------|------|------|
| Architecture/Design | Opus (me) | $$$ |
| Bulk coding | DeepSeek | ¢ |
| Quick fixes | Gemini | Free |

**My internal tool:**
```bash
node tools/code.js "prompt"           # DeepSeek (default, cheap)
node tools/code.js -g "prompt"        # Gemini (free when quota allows)
node tools/code.js -f file.js "prompt" # Include file context
```

**For Jason's laptop:**
```bash
pip install aider-chat
export DEEPSEEK_API_KEY="sk-xxxxx"

# Aliases:
alias think='openclaw'                              # Opus - design
alias code='aider --model deepseek/deepseek-chat'   # DeepSeek - implement
alias fix='aider --model gemini/gemini-2.0-flash'   # Gemini - quick fixes
```

**Pattern:** I orchestrate → DeepSeek/Gemini generates code → I review

## Linear CLI
Task management integration:
```bash
node tools/linear.js list                    # List issues
node tools/linear.js create "Title" -p 2    # Create issue (priority 1-4)
node tools/linear.js view MAX-5              # View issue details
node tools/linear.js update MAX-5 --state "Done"  # Update state
node tools/linear.js comment MAX-5 "Note"   # Add comment
node tools/linear.js search "query"          # Search issues
```
- **Workspace:** MaximusCarapax
- **Team key:** MAX
- **API key in:** ~/.openclaw/secrets/credentials.json

---

*Add more as I discover what's available.*
