# Starter Kit Evaluation: If I Could Start Over

*An honest assessment from 4 days of building and breaking things.*

---

## Executive Summary

The starter kit is a solid foundation for getting started quickly. But after living through the "freeballing it" phase, I see significant opportunities to make it smoother, cheaper, and more robust.

**Key insight:** The kit optimizes for "first 5 minutes" but not for "first 5 weeks."

---

## What Works Well

### 1. Quick Start Flow
Two commands to running agent is legitimately impressive. No Docker, no Python environment hell. This is a real differentiator.

### 2. BOOTSTRAP.md Concept
Having the agent guide its own setup is clever. It creates agency and lets the human-agent relationship develop naturally.

### 3. Delegation Documentation
The DELEGATION.md doc captures the right philosophy. "Expensive models think, cheap models do" is correct.

### 4. Persona Templates
Having pre-built personality modes (Assistant vs CoS) reduces blank page syndrome.

---

## What Broke Down in Practice

### 1. Cost Blindness 💰
**Problem:** No visibility into what anything costs until the bill arrives.

We learned the hard way that:
- Heartbeats on Opus = money fire
- Long context sessions compound fast
- Sub-agents inherit main model by default

**What I'd want:** Real-time token/cost tracking. A simple dashboard showing "today you've spent $X" with breakdown by task type.

### 2. Credential Chaos 🔐
**Problem:** Secrets scattered everywhere.

Currently:
- `.env` for some things
- `~/.openclaw/secrets/` for others
- `openclaw.json` for more
- Some tools hardcode paths

**What I'd want:** Single encrypted credential store with standard access pattern. Every tool uses `getCredential('twilio')` and it just works.

### 3. Tool Proliferation Without Standards 🛠️
**Problem:** We built 30+ tools with no consistent patterns.

Looking at our tools folder:
- Some use commander, some use minimist, some parse argv manually
- Error handling varies wildly
- Some output JSON, some output text
- Help messages are inconsistent

**What I'd want:** Tool framework with:
```javascript
// Every tool follows this pattern
const tool = createTool({
  name: 'gmail',
  description: 'Email operations',
  commands: {
    inbox: { ... },
    read: { ... },
  },
  config: ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET'],
});
```

Auto-generates help, validates config, handles errors consistently.

### 4. Memory/Context Management 🧠
**Problem:** Important data lives in context and gets compacted away.

We put tasks in MEMORY.md. Then context got long. Compaction happened. Tasks disappeared. Now I query Linear instead.

**What I'd want:** (This is VISION-V2) Database-backed state from day 1. Agent queries what it needs, context stays lean.

```
Before: Everything in MEMORY.md → context bloat → compaction loss
After:  SQLite for state + lean MEMORY.md for personality/prefs
```

### 5. Silent Failures 🔇
**Problem:** Things break and I don't know until someone complains.

Examples:
- Reddit pulse check returning 0 results (broken, not empty)
- Gemini quota exceeded (silently fell back... to nothing)
- Browser sessions expire (just stops working)

**What I'd want:** Health check system. Every integration has a `check()` function. Dashboard shows green/yellow/red status. Alerts when things break.

### 6. No Inbound Webhook Story 📥
**Problem:** Can receive via Telegram, but nothing else.

We set up Twilio but still can't receive SMS because webhook setup is manual and complex. Same for any other inbound integration.

**What I'd want:** Built-in webhook server that just runs. Tool registers endpoint, server routes to tool.

```javascript
// In tools/twilio.js
registerWebhook('/sms/inbound', handleIncomingSMS);
```

### 7. Browser Session Management 🌐
**Problem:** Every browser automation re-auths, gets blocked, loses cookies.

LinkedIn took 5 attempts to get stable login. Cookies disappear. Headless gets detected.

**What I'd want:** 
- Persistent browser profiles (like a real browser)
- Session health checks
- Automatic re-auth when sessions expire
- Stealth mode by default

### 8. Delegation Doesn't Happen Automatically 🤖
**Problem:** Documentation says "delegate to Gemini" but nothing enforces it.

I have to consciously remember to delegate. Often I don't. Costs go up.

**What I'd want:** Model router at the infrastructure level, not the prompt level.

```javascript
// Agent asks for completion
const response = await complete({
  task: 'summarize',  // tagged by type
  content: longText,
});

// Router picks model based on task type
// summarize → Gemini (free)
// code → DeepSeek (cheap)  
// reason → Opus (expensive)
```

---

## If I Built Ground-Up for Efficiency

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    OpenClaw Agent                       │
│  ┌─────────────────────────────────────────────────┐   │
│  │              Model Router                        │   │
│  │  task type → cheapest capable model             │   │
│  └─────────────────────────────────────────────────┘   │
│                         │                               │
│  ┌──────────┬──────────┼──────────┬──────────────┐     │
│  │  Claude  │  Gemini  │ DeepSeek │   Haiku      │     │
│  │ (reason) │  (free)  │ (code)   │ (heartbeat)  │     │
│  └──────────┴──────────┴──────────┴──────────────┘     │
├─────────────────────────────────────────────────────────┤
│                  Tool Framework                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Standard CLI │ Config/Secrets │ Health Check   │   │
│  └─────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────┤
│                  Data Layer                             │
│  ┌─────────────┬─────────────┬─────────────────────┐   │
│  │   SQLite    │  Credentials │    RAG/Vectors     │   │
│  │ (state/logs)│   (unified)  │   (memory/docs)    │   │
│  └─────────────┴─────────────┴─────────────────────┘   │
├─────────────────────────────────────────────────────────┤
│                  Infrastructure                         │
│  ┌─────────────┬─────────────┬─────────────────────┐   │
│  │  Webhook    │   Browser   │     Cron/Jobs      │   │
│  │   Server    │   Manager   │                     │   │
│  └─────────────┴─────────────┴─────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### Key Changes

#### 1. Model Router (Cost Control)

Instead of hoping the agent remembers to delegate:

```javascript
// config/model-routing.yaml
routes:
  summarize: gemini/gemini-2.0-flash      # FREE
  research: gemini/gemini-2.0-flash       # FREE
  code: deepseek/deepseek-chat            # $0.14/M
  quick-check: anthropic/claude-haiku     # cheap
  reason: anthropic/claude-opus           # expensive
  default: anthropic/claude-sonnet        # balanced

# Agent calls are tagged and routed automatically
```

**Savings:** 60-80% cost reduction with no behavior change.

#### 2. Unified Credential Store

```
~/.openclaw/
├── credentials.enc     # Encrypted, single source of truth
├── workspace/
│   └── .env           # Symlinks or refs to credentials.enc
```

Tool API:
```javascript
const twilio = await credentials.get('twilio');
// Returns { accountSid, authToken, phoneNumber }
```

#### 3. SQLite by Default

Agent wakes up → queries tasks, not parses MEMORY.md

```sql
-- Built-in tables
tasks (id, title, status, due, project_id)
contacts (id, name, email, notes, last_contact)
logs (id, timestamp, tool, action, result)
metrics (id, date, tokens_in, tokens_out, cost)
```

Agent uses simple CLI:
```bash
node tools/db.js tasks list --status=todo
node tools/db.js tasks add "Review PR" --project=starter-kit
```

Context stays lean. Data persists forever.

#### 4. Health Dashboard

```
┌─────────────────────────────────────────┐
│  Agent Health                     🟢 OK │
├─────────────────────────────────────────┤
│  Gmail API          🟢  Last: 2m ago    │
│  Calendar API       🟢  Last: 5m ago    │
│  X/Twitter          🟡  Rate limited    │
│  LinkedIn           🔴  Session expired │
│  Twilio             🟢  Balance: $14.20 │
├─────────────────────────────────────────┤
│  Today's Cost       $2.45               │
│  Tokens In/Out      45K / 12K           │
│  Tasks Completed    3                   │
└─────────────────────────────────────────┘
```

#### 5. Webhook Server (Built-in)

```javascript
// Starts automatically with gateway
webhookServer.register('/twilio/sms', twilioSmsHandler);
webhookServer.register('/stripe/events', stripeHandler);

// External world can POST to:
// https://your-server.com/webhooks/twilio/sms
```

No more "set up ngrok, configure Twilio, hope it works."

#### 6. Browser Session Manager

```javascript
// tools/browser-sessions.js
await sessions.ensure('linkedin');  // Creates if missing, validates if exists
await sessions.refresh('linkedin'); // Re-auths if expired
await sessions.status();            // Shows all session health
```

Persistent profiles in `~/.openclaw/browser-profiles/`.

---

## Priority Recommendations

### Immediate (This Week)

1. **Add cost tracking** - Even basic token counting in logs would help
2. **Consolidate credentials** - Pick ONE pattern, migrate everything
3. **Health check tool** - `node tools/health.js` that tests all integrations

### Short-term (This Month)

4. **SQLite foundation** - Per VISION-V2, start with tasks table
5. **Tool framework** - Standardize the pattern, refactor top 10 tools
6. **Model router prototype** - Even hardcoded rules would help

### Medium-term (This Quarter)

7. **Webhook server** - Built into gateway startup
8. **Browser session manager** - Persistent profiles, auto-refresh
9. **Dashboard v2** - Health + costs + tasks in one view

---

## Cost Impact Estimate

| Change | Current | After | Savings |
|--------|---------|-------|---------|
| Model routing | ~$15/day | ~$5/day | 66% |
| Heartbeat on Haiku | ~$3/day | ~$0.50/day | 83% |
| DB vs context | ~$2/day context | ~$0.50/day | 75% |
| **Total** | **~$20/day** | **~$6/day** | **70%** |

That's ~$420/month → ~$180/month. Real money.

---

## The Meta-Lesson

The starter kit is good at **getting started**. But the expensive part of running an agent isn't setup — it's operations.

If I could start over, I'd want:

1. **Cost visibility from day 1** - Not after the first bill shock
2. **Structured data from day 1** - Not after context explosions
3. **Health monitoring from day 1** - Not after silent failures
4. **Automatic delegation** - Not relying on agent memory

The goal isn't a smarter agent. It's a **cheaper, more reliable** agent that's still smart when it needs to be.

---

*Written: 2026-02-04*
*Author: Maximus Carapax*
*Status: For Jason's review*
