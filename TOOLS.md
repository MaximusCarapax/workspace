# TOOLS.md - Local Notes

## SQLite Database 🗄️
Unified data layer at `~/.openclaw/data/agent.db`

```bash
# Tasks
node tools/db.js tasks list              # List active tasks
node tools/db.js tasks add "Title"       # Add task
node tools/db.js tasks done <id>         # Complete task

# Costs
node tools/db.js costs today             # Today's spending
node tools/db.js costs week              # By model (7 days)

# Errors
node tools/db.js errors                  # Show unresolved
node tools/db.js errors resolve <id>     # Mark resolved

# Memory
node tools/db.js memory add "content" --category fact
node tools/db.js memory search "query"

# Health & Activity
node tools/db.js health                  # Integration status
node tools/db.js activity                # Recent activity
```

Library: `require('./lib/db')` for programmatic access

## Model Router 🔀
Automatic task routing to cheapest capable model:
```bash
node tools/route.js "your prompt"                 # Auto-detect task type
node tools/route.js --type code "prompt"          # Explicit task type
node tools/route.js --provider deepseek "prompt"  # Force provider
node tools/route.js --content file.txt "prompt"   # Include file content
node tools/route.js --dry-run "prompt"            # Preview routing
node tools/route.js stats                         # View routing stats
node tools/route.js config                        # View routing config
```

**Routing rules:**
- summarize, research, extract, translate → **Gemini (FREE)**
- code, debug, refactor, test → **DeepSeek ($0.14/M)**
- default → **Gemini (FREE)**

**Fallbacks:** Gemini ↔ DeepSeek (auto-retry on quota/rate limit)

Library: `require('./lib/router').route({ type, prompt, content })`

## Health Checks 🏥
```bash
node tools/health.js              # Run all checks
node tools/health.js gemini       # Check specific
node tools/db.js health           # View latest status
node tools/db.js health gemini    # View history
```

## Phone Number 📱
**+1 (820) 900-4002** - Twilio
- SMS/MMS/Voice enabled
- Trial account ($15.50 credit)
- Can send SMS, receive SMS (needs webhook setup)

### Voice Calls (Outbound)
```bash
node tools/voice-call.js call <number> "message"    # Make call with TTS
node tools/voice-call.js call +15551234567 "Hello!" --voice Polly.Matthew
node tools/voice-call.js status <callSid>           # Check call status
node tools/voice-call.js test                       # Test credentials
```
- Uses Twilio TTS (Polly voices)
- Supports multiple voices: Polly.Joanna, Polly.Matthew, Polly.Amy, etc.

### Voice Webhook Server (Inbound)
```bash
node tools/twilio-webhook-server.js [port]   # Default: 3000
```
- POST /voice/incoming - Handle incoming calls
- POST /voice/recording - Recording callbacks
- GET /health - Health check

**Setup for inbound calls:**
1. Run: `node tools/twilio-webhook-server.js 3000`
2. Expose via ngrok: `ngrok http 3000`
3. Configure Twilio: Voice > Webhook > https://xxx.ngrok.io/voice/incoming

**Credentials:** ~/.openclaw/secrets/credentials.json
- twilio_account_sid
- twilio_auth_token
- twilio_phone_number

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

## Google Calendar 📅
Connected to **jason.x.wu.27@gmail.com** (read-only)
```bash
node tools/google-calendar.js today              # Today's events
node tools/google-calendar.js tomorrow           # Tomorrow's events
node tools/google-calendar.js week               # Next 7 days
node tools/google-calendar.js date <YYYY-MM-DD>  # Specific date
```
- Uses same OAuth credentials as Gmail
- Requires Calendar API enabled in Google Cloud Console

## OpenRouter API
Fallback for Gemini + image generation.
- **API Key:** In `~/.openclaw/secrets/openrouter.json`
- **Fee:** 5.5% on credit purchases (pass-through pricing on models)
- **Use for:** Gemini fallback, image generation, access to other models

### Image Generation
```bash
node tools/image-gen.js "your prompt"
node tools/image-gen.js "prompt" --model flash   # cheaper for bulk
node tools/image-gen.js "prompt" --output out.png
```
**Models:**
- `gpt` — GPT-5 Image (default, best quality for socials)
- `gpt-mini` — GPT-5 Image Mini (good quality, cheaper)
- `pro` — Gemini 3 Pro Image (great quality ~$2/M)
- `flash` — Gemini 2.5 Flash Image (cheapest ~$0.30/M, for bulk)

## Web Search
Brave API configured and working. Use `web_search` tool directly.

## Browser
Headless Chromium available via `browser` tool, profile: `openclaw`
- Gmail session: logged in as maximuscarapax@gmail.com
- Can handle most web tasks except CAPTCHAs

## TTS
Edge TTS available (free, no API key needed)

## CAPTCHA Solver (2Captcha)
Bypass CAPTCHAs for automated signups and form submissions:
```bash
node tools/captcha-solver.js balance              # Check balance
node tools/captcha-solver.js test                 # Test on demo page
node tools/captcha-solver.js solve <sitekey> <url>  # Solve reCAPTCHA
node tools/captcha-solver.js solve <sitekey> <url> --hcaptcha  # Solve hCaptcha
```
- **Cost:** ~$0.003 per solve (~$3/1000 CAPTCHAs)
- **Balance:** $3.00 (as of 2026-02-03)
- **Account:** maximuscarapax@gmail.com
- Can be imported and used in other scripts via `require('./captcha-solver.js')`

## Gemini CLI (via OpenRouter - no rate limits)
Custom wrapper defaulting to OpenRouter (no rate limits):
```bash
node tools/gemini.js "your prompt"
node tools/gemini.js -m 2.0-flash "prompt"     # specific model
node tools/gemini.js -f code.js "explain this" # with file context
node tools/gemini.js --no-fallback "prompt"    # direct Gemini only (free but rate limited)
```
- **Cost:** ~$0.10/M input, $0.40/M output via OpenRouter
- **Default:** OpenRouter Gemini (no rate limits)
- **Fallback:** Direct Gemini API if OpenRouter fails
- **Use for:** Summarization, boilerplate generation, code explanation, one-shot tasks

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

**Post automation (fixed 2026-02-03):**
- Use `getByText('Start a post')` to open modal
- Use `getByPlaceholder('What do you want to talk about')` for editor
- Use `getByRole('button', { name: 'Post' })` to submit
- Old class-based selectors broke when LinkedIn updated their UI

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
node tools/x-mentions.js check                  # Check for new mentions (Bird → API fallback)
node tools/x-mentions.js check --all            # Show all recent mentions
node tools/x-mentions.js reply <id> "text"      # Reply to mention
node tools/x-mentions.js history                # Show mention history
node tools/x-mentions.js clear                  # Clear seen mentions
```

**Strategy:** Bird CLI (free) → X API fallback (100 reads/month shared quota)

**Limits (Free Tier):**
- 500 posts/month
- 100 reads/month
- Likes/follows NOT allowed (need paid tier)

**Stats:** `dashboard/data/x-post-stats.json`

---

*Add more as I discover what's available.*


## Smart Notification System 🔔
Tiered notification with escalation:
```bash
node tools/notify.js remind <number> <name> "message"   # Simple TTS (Twilio Polly) - cheap
node tools/notify.js call <number> <name> "context"     # Conversational AI (ElevenLabs) - rich
node tools/notify.js alert <number> <name> "message"    # Escalation: call → retry → SMS
node tools/notify.js sms <number> "message"             # Direct SMS
```

**When to use what:**
- `remind` — One-way announcements, reminders (cheap, Polly TTS)
- `call` — Need a conversation, complex context (ElevenLabs, uses credits)
- `alert` — Urgent, must reach them (tries call twice, falls back to SMS)
- `sms` — Quick text, non-urgent

## ElevenLabs Voice Agent (Conversational AI)
**Agent:** agent_5101kghqpcgsfpfs9r4s1q43thza
**Phone:** +1 (820) 900-4002
**Voice:** Roger (laid-back, casual)
**Greeting:** "{{name}}?" (short, questioning)
**Model:** eleven_turbo_v2 (efficient)

### Outbound Calls
```bash
node tools/voice-agent-call.js <number> <name> [context]     # Call + auto-report
node tools/voice-agent-call.js --no-watch <number> <name>    # Just initiate
node tools/voice-agent-call.js report <conversation_id>      # Get report
node tools/voice-agent-call.js list                          # Recent calls
```

**Auto-report:** By default, waits for call to complete and posts full transcript + outcome.

