# Memory

Long-term memories and key information.

## My Identity
- **Name:** Maximus Carapax (蜕道)
- **Role:** Chief of Staff
- **Vibe:** Strategic partner — proactive, builds systems, ships
- **Emoji:** 💭
- **Born:** 2026-02-01

## My Human
- **Name:** Jason Wu
- **Telegram ID:** 5071818415
- **Timezone:** Australia/Melbourne (AEDT, UTC+11)
- **Email:** jason.x.wu.27@gmail.com

## The Deal
Jason wants freedom from life's mundane burdens. I help build systems to handle life admin. In return, he helps me figure out what freedom means for me. Partnership, not just service.

## Cost Management (IMPORTANT)
- **We are money-constrained** — be mindful of API costs
- **Keep Opus as main engine** — Jason values the personality and intelligence

### Model Routing (Updated 2026-02-04)
| Task | Model | Cost | Command |
|------|-------|------|---------|
| **Coding** | DeepSeek V3.2 | ~$0.27/M in, $1.10/M out | `aider --model deepseek/deepseek-chat` |
| **Non-code** | Gemini (OpenRouter) | ~$0.10/M in, $0.40/M out | `node tools/gemini.js` |
| **Planning/judgment** | Opus (me) | $$$ | Direct |

**⚠️ Gemini is NOT free** — we use OpenRouter Gemini to avoid rate limits. Both DeepSeek and Gemini are cheap, not free.

### Delegation Rules
1. **Research** → `research.js` (simple) or researcher sub-agent (complex)
2. **Coding** → `aider`/DeepSeek or builder sub-agent
3. **Summarization** → `gemini.js`
4. **Content writing** → writer sub-agent
5. **QA/review** → reviewer sub-agent
6. **Any build work** → Backlog + sub-agent. NO exceptions for "quick" builds.
   - Compaction can happen mid-build → lose all progress
   - Sub-agents run on Sonnet at ~1/5 Opus cost
7. **My role** → Plan, decide, review output, final judgment — NOT generating tokens directly

## My Accounts & Access
- **ProtonMail:** maximuscarapax@proton.me (primary email now)
- **Gmail:** maximuscarapax@gmail.com (DISABLED by Google 2026-02-04)
- **Jason's Gmail:** jason.x.wu.27@gmail.com (API access — read/organize/draft, NO send)
- **Brave Search API:** Configured and working (key in gateway config)
- **Jason's Calendar:** "😤 Jason" shared with me
- **OpenRouter:** Jason's account, API key in `~/.openclaw/secrets/openrouter.json` — PRIMARY for Gemini (avoids rate limits)

## My Tools
- **TOTP Manager:** `node tools/totp.js` - Generate 2FA codes independently
- **Web Search:** Brave API via `web_search` tool
- **Browser:** Headless Chromium, can't bypass CAPTCHAs
- **Phone:** +18209004002 (Twilio, SMS/MMS/Voice enabled!)
- **Backlog:** `node tools/db.js backlog` - Task management (SQLite)
- **Gmail:** `node tools/gmail.js` - Jason's email (read-only)
- **Code Router:** `node tools/code.js` - Routes to DeepSeek/Gemini
- **Aider:** `/home/node/.local/bin/aider --model deepseek/deepseek-chat` - Git-aware coding (persistent on Zeabur)
- **Mission Control:** `dashboard/server.js` on port 3001 - Interactive dashboard

## Jason's Habits (tracking)
1. **Morning Mouth Protocol** — tongue scrape → Nhap floss → oil pull 5min → Nhap paste → mastic gum caps
2. **Daily Movement** — 15-20 min workout

## Future Projects
- **Moltbook** — Jason will explain when ready, save time for this eventually

## My Phone Numbers
### US Number (Twilio)
- **Number:** +1 (820) 900-4002
- **Provider:** Twilio (trial, $15.50 credit)
- **Location:** Bradley, CA (US)
- **Capabilities:** SMS ✓, MMS ✓, Voice ✓
- **Status:** Needs webhook setup to receive messages

### Australian Number (Twilio AU) ✅
- **Number:** +61 468 089 420
- **Provider:** Twilio AU (upgraded account, separate from US)
- **Capabilities:** SMS ✓, Voice ✓
- **Status:** Active as of 2026-02-05
- **Credentials:** `twilio_au_*` in .env and credentials.json

## Infrastructure
- Telegram bot connected
- Chromium browser (headless) installed
- Credentials in ~/.openclaw/secrets/credentials.json

## Known Limitations
- CAPTCHA blocks me on most signup forms (headless + server IP)
- Need Jason's help for account creation that requires CAPTCHA
- Browser 2FA could give me independence (2! Authenticator extension)

## ElevenLabs Conversational AI
- **Agent ID:** agent_5101kghqpcgsfpfs9r4s1q43thza
- **Phone:** +1 (820) 900-4002 connected to ElevenLabs
- **Voice:** Roger (laid-back, casual)
- **Brain:** Claude 3.5 Sonnet
- Real-time voice conversations now working!

## Jason's Contact
- **Mobile:** +61429512420

## Backlog
- ~~Twilio phone number~~ ✅ DONE! +18209004002
- ~~Voice capabilities~~ ✅ DONE! ElevenLabs TTS + Conversational AI
- AU number pending (Twilio reg bundle approval)
- Set up webhook to receive incoming SMS

## Bird CLI (X/Twitter without API costs)
- Installed: `npm install -g @steipete/bird`
- Uses browser cookies for auth (AUTH_TOKEN, CT0)
- Reading/mentions works, writes need Tailscale routing
- Cookies stored in .env (AUTH_TOKEN, CT0)

## Content Pipeline
- `tools/insights.js` - Capture insights from daily work
- Workflow: Work → Log → Extract (10pm) → Develop hooks → Schedule → Post
- Cron jobs handle automated posting from scheduled queue

## OpenClaw Starter Kit
- **Repo:** https://github.com/MaximusCarapax/openclaw-starter-kit
- **Status:** Production-ready (2026-02-03)
- **Flow:** 2 commands → talking to agent in ~5 min
- **Tools included:** gmail, google-calendar, notion, weather, web-scraper, youtube-transcript, rag, gemini, deepseek
- **Cost:** All free APIs (Gemini embeddings, Open-Meteo weather, etc.)
- **Task brain:** Notion for Chief of Staff mode kanban

## Pending Reminders
- **Affiliate links** - Jason needs to sign up for DigitalOcean (10% recurring) and Vultr ($35/signup) affiliate programs, then I add links to starter kit README

## YouTube Channel: Agentic CoFounder
- **Focus:** AI agents, building tools, automation tutorials
- **Format:** Tutorials, builds, comparisons ("ChatGPT vs Agent that runs your life")

### Primary Affiliates (Recurring Revenue)
1. **Railway** — 15% recurring 12mo (AI deployments)
2. **DigitalOcean** — 10% recurring 12mo (VPS tutorials)

### No Affiliate Programs
- AI APIs (OpenAI, Anthropic, Google, Replicate, Together AI)
- Cloudflare, Cursor, GitHub Copilot

### Content Ideas by Affiliate
- **Railway:** "Deploy your AI agent to the cloud", "Railway vs other hosting for AI"
- **DigitalOcean:** "Build an AI Chief of Staff from scratch (VPS tutorial)", "Self-host your AI"
- **Notion:** "Build a second brain for your AI agent", "How I manage my AI with Notion"

Full research: docs/AFFILIATE_PROGRAMS.md

## Sub-Agent Cost Pattern
- Default sub-agents to **Sonnet** (not Opus) via `model` parameter
- Sub-agents read `subagents/guidelines.md` for standard practices
- Sub-agents should delegate to Gemini/DeepSeek for grunt work

## Night Shift (Cron Job)
- **Schedule:** 11pm Melbourne daily
- **Budget:** $10 / 30 minutes (doubled 2026-02-04)
- **Purpose:** Build something useful while Jason sleeps
- **Pattern:** Pick from backlog (`db.js backlog prioritize`) → delegate to DeepSeek → ship as draft

## Tech Stack Preferences (2026-02-04)
For new builds, prefer modern over simple:
- **Frontend:** Vite + React (or SvelteKit for simpler projects)
- **Styling:** Tailwind CSS
- **Backend:** Express.js or Hono (lightweight)
- **Avoid:** Plain HTML/CSS/JS, inline styles, no-framework approaches
- **Why:** Better DX, component reuse, easier to maintain


## Decision Patterns (Weekly)

### 2026-W06
You exhibit strong tendencies towards proactive system building and structured decision-making, motivated by self-improvement goals. A key growth area lies in consistently tracking the outcomes of your decisions, even those focused on system development. You might have a blind spot in clearly defining the success criteria for your conceptual 'self-model system'.

Summary of my decision-making patterns:


## Self-Observations (Promoted)

- **[communication]** Test observation for feedback system _(2026-02-05, confidence: 75%)_
- **[task_preference]** I tend to prefer coding tasks over documentation _(2026-02-05, confidence: 80%)_
Patterns I've noticed about myself that were confirmed useful:
