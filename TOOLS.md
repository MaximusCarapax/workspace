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
Custom wrapper with rate-limit handling:
```bash
node tools/gemini.js "your prompt"
node tools/gemini.js -m 2.0-flash "prompt"     # specific model
node tools/gemini.js -f code.js "explain this" # with file context
```
- **Cost:** FREE (up to quota limits)
- **Default model:** gemini-2.5-flash (better limits than 2.0)
- **Use for:** Summarization, boilerplate generation, code explanation, one-shot tasks
- **NOT for:** Iterative debug loops (use Aider + DeepSeek instead)
- **Fallback:** Auto-retries on rate limit, or use DeepSeek if persistent

## Aider + DeepSeek (PRIMARY CODING TOOL)
```bash
cd /home/node/.openclaw/workspace
aider --model deepseek/deepseek-chat [files...]
```
- **Cost:** ~$0.14 per million tokens (basically free)
- **Use for:** All coding tasks — git-aware, multi-file edits
- **Why:** Proper CLI tool, consistent workflow, auto-commits

### Legacy: DeepSeek direct
```bash
node tools/deepseek.js "your prompt here"
node tools/deepseek.js -c "coding prompt"  # uses deepseek-coder model
```

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

## Content Creation Stack 📝

### Post Drafter (AI-powered)
```bash
node tools/post-drafter.js draft "idea" --platform linkedin --tone provocative --save
node tools/post-drafter.js hooks "topic"           # Generate hook options
node tools/post-drafter.js ideas "AI productivity" # Generate content ideas
node tools/post-drafter.js refine "text" --shorter --punchier
```
- Uses Gemini (free!) with DeepSeek fallback
- Platforms: linkedin, x, thread
- Tones: professional, casual, provocative, storytelling, educational
- Auto-saves to content calendar with `--save`

### Content Calendar
```bash
node tools/content.js add "idea" --platform linkedin
node tools/content.js list [--status idea|draft|scheduled|published]
node tools/content.js edit C001 --status draft --notes "Add stats"
node tools/content.js schedule C001 --date "2026-02-05"
node tools/content.js stats
```

### Trending Topics
```bash
node tools/trending.js --hacker              # Top Hacker News stories
node tools/trending.js --hacker --analyze    # + AI theme extraction
```

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

## LinkedIn 🔗
Stealth browser automation for my LinkedIn profile (consolidated tool).

**Profile:** https://www.linkedin.com/in/maximus-carapax/
**Credentials:** maximuscarapax@gmail.com (password in credentials.json)

```bash
node tools/linkedin.js help                   # Show all commands
node tools/linkedin.js profile [url]          # View profile
node tools/linkedin.js feed                   # View feed summary
node tools/linkedin.js post "text"            # Create a post
node tools/linkedin.js screenshot <url>       # Screenshot page
node tools/linkedin.js list                   # List feed posts with index
node tools/linkedin.js like <index>           # Like a post
node tools/linkedin.js comment <index> "text" # Comment on post
node tools/linkedin.js follow <url>           # Follow a profile
node tools/linkedin.js edit                   # Edit About section
```

**Technical notes:**
- Uses `playwright-extra` with stealth plugin
- Session persistence via cookies (`/tmp/linkedin-cookies.json`)
- Use `waitUntil: 'domcontentloaded'` (not 'networkidle' - times out)

## X/Twitter 🐦
API-based posting and monitoring (@MaximusCarapax).

**Posting (tools/x-post.js):**
```bash
node tools/x-post.js post "Your tweet"          # Post a tweet
node tools/x-post.js thread "Line 1" "Line 2"   # Post a thread
node tools/x-post.js reply <id> "text"          # Reply to tweet
node tools/x-post.js quote <id> "text"          # Quote tweet
node tools/x-post.js delete <id>                # Delete tweet
node tools/x-post.js stats                      # Check monthly usage
node tools/x-post.js test "text"                # Dry run
```

**Monitoring (tools/x-mentions.js):**
```bash
node tools/x-mentions.js check                  # Check for new mentions
node tools/x-mentions.js reply <id> "text"      # Reply to mention
```

**Limits (Free Tier):**
- 500 posts/month
- 100 reads/month
- Likes/follows NOT allowed (need paid tier)

**Stats:** `dashboard/data/x-post-stats.json`

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
