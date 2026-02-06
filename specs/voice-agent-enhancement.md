# Voice Agent Enhancement

## Overview
Upgrade our voice capabilities from "can make calls" to "intelligent voice assistant with memory and agency." The voice agent should know who it's calling, why, and remember what happened.

## Current State
We have working infrastructure:
- **US Number** (+1 820 900 4002): ElevenLabs Voice Agent
- **AU Number** (+61 468 089 420): Hume AI via Twilio bridge
- **Tools**: `voice-call.js`, `voice-agent-call.js`, `hume-call.js`, `notify.js`

**What's missing:**
- No context injection before calls
- Call transcripts aren't searchable
- Can't end calls gracefully (Hume hang_up)
- No appointment/scheduling capability

## Components

### 1. Context Strategy for Outbound Calls (Story #782)
**Problem:** Voice agent calls without knowing relationship history or purpose.

**Solution:** Pre-call context injection
```javascript
// Before calling Jason's mum:
const context = await buildCallContext({
  contact: '+61412345678',
  name: 'Diana',
  relationship: 'Jason\'s mum',
  purpose: 'Birthday reminder',
  history: await getRelationshipHistory('Diana'),
  notes: ['Prefers morning calls', 'Ask about garden']
});
```

**Implementation:**
- `tools/call-context.js` — Build context from RAG + contacts
- Contact database with relationship info
- Recent interaction lookup from session memory
- Inject context into ElevenLabs/Hume system prompt

**Schema: `contacts` table** (extended existing table)
```sql
-- Existing columns: id, name, email, phone, company, role, notes, tags, 
--                   last_contact, follow_up_date, source, created_at, updated_at
-- Added for voice:
ALTER TABLE contacts ADD COLUMN relationship TEXT;      -- "Jason's mum", "poker buddy"
ALTER TABLE contacts ADD COLUMN preferences TEXT;       -- JSON: preferred_times, topics_to_avoid
ALTER TABLE contacts ADD COLUMN total_calls INTEGER DEFAULT 0;
ALTER TABLE contacts ADD COLUMN last_call TEXT;
```
✅ Migration applied 2026-02-06

### 2. Call Log Pipeline to RAG (Story #786)
**Problem:** Call transcripts exist but aren't searchable or integrated with memory.

**Solution:** Auto-index call transcripts into session memory

**Flow:**
```
Call Completes
      ↓
[Transcript Retrieved] — from ElevenLabs/Hume API
      ↓
[Structured Extraction] — participants, topics, action items, sentiment
      ↓
[RAG Indexing] — chunk, embed, store in session_chunks
      ↓
[Summary to Daily Memory] — key points to memory/YYYY-MM-DD.md
```

**Implementation:**
- `tools/index-call.js` — Process and index a call transcript
- Auto-trigger after `voice-agent-call.js` completes
- Extract: participants, duration, topics, decisions, follow-ups
- Tag with `source: voice_call` for filtering

**Schema addition to session_chunks:**
```sql
ALTER TABLE session_chunks ADD COLUMN source TEXT DEFAULT 'chat';
-- Values: 'chat', 'voice_call', 'email', etc.
```

### 3. Hume-Twilio Bridge hang_up Support (Story #790)
**Problem:** Hume voice agent can't end calls gracefully — relies on caller hanging up.

**Solution:** Implement hang_up tool handling in bridge

**Current bridge:** `tools/hume-twilio-bridge.js`

**Changes needed:**
- Listen for Hume `tool_call` events with `name: 'hang_up'`
- When received, send Twilio `<Hangup/>` TwiML
- Clean up WebSocket connections
- Log call end reason

**Implementation:**
```javascript
// In bridge WebSocket handler
if (message.type === 'tool_call' && message.name === 'hang_up') {
  // Send hangup to Twilio
  twilioConnection.send(JSON.stringify({
    event: 'stop',
    reason: 'agent_hangup'
  }));
  // Close connections gracefully
  cleanup();
}
```

### 4. Appointment Setting via Tools (Story #778)
**Problem:** Voice agent can discuss appointments but can't actually book them.

**Solution:** Tool-enabled calendar integration

**Tools to expose to voice agent:**
- `check_availability` — Query Google Calendar for free slots
- `book_appointment` — Create calendar event
- `reschedule` — Move existing appointment
- `cancel` — Remove appointment

**Implementation:**
- Extend `tools/google-calendar.js` with write capabilities
- Create tool definitions for Hume/ElevenLabs
- Handle tool calls in bridge/webhook
- Confirmation flow: "I'll book that for 3pm Tuesday. Sound good?"

**Hume tool definition:**
```json
{
  "name": "book_appointment",
  "description": "Book an appointment on the calendar",
  "parameters": {
    "title": "string",
    "datetime": "ISO8601 string",
    "duration_minutes": "number",
    "attendee_email": "string (optional)"
  }
}
```

## Data Flow (Full Picture)
```
Outbound Call Request
      ↓
[Context Builder] → relationship, history, purpose
      ↓
[Voice Agent] → ElevenLabs or Hume with context
      ↓
[During Call] → Tool calls (calendar, etc.)
      ↓
[Call Ends] → hang_up tool or caller disconnect
      ↓
[Post-Call] → Transcript to RAG, summary to daily memory
```

## Integration Points
- **Google Calendar**: Read (done) + Write (new)
- **Session Memory RAG**: Voice transcripts indexed
- **Contacts DB**: Relationship tracking
- **Daily Memory**: Call summaries auto-logged

## Success Metrics
- Pre-call context available for 100% of known contacts
- Call transcripts searchable within 5 min of call end
- hang_up works reliably on Hume calls
- Can book appointments via voice

## Cost Estimate
- ElevenLabs: ~$0.10-0.30 per minute of conversation
- Hume: Usage-based (check current rates)
- Gemini for extraction: ~$0.01 per call
- Calendar API: Free (within quota)

## Security Considerations
- Calendar write access is sensitive — confirm before booking
- Contact data is personal — don't expose in logs
- Call recordings may have legal requirements by jurisdiction

## Decisions
1. **Appointment booking**: Verbal confirmation required ("I'll book 3pm Tuesday — that right?")
2. **Calendar**: Use Jason's calendar, prefix Max-created events with `[Max]`
3. **Recording**: Skip for now (legal complexity)

---

*Goal: Voice agent that knows who it's talking to, remembers conversations, and can take action.*
