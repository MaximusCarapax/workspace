# Voice Channel for Maximus — Project Scope

**Goal:** Add voice as a first-class interaction channel. Jason can call me, I can call Jason, and I can call third parties on Jason's behalf.

---

## Use Cases

### 1. Jason Calls Me
- Dials +1 820-900-4002
- We have a real-time conversation
- He delegates tasks: "Add X to Linear", "Remind me about Y", "What's on my calendar?"
- I execute and confirm

### 2. I Call Jason
- I detect something needing attention (urgent email, upcoming meeting, reminder)
- I initiate outbound call to Jason's number
- We discuss, he gives direction, I act

### 3. I Call Third Parties
- Jason says "Book me a table at XYZ for Friday 7pm"
- I look up the number, place the call
- Have a conversation with the restaurant/business
- Complete the task, report back to Jason

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      JASON'S PHONE                          │
└─────────────────────────────────────────────────────────────┘
                            ↕ Voice Call
┌─────────────────────────────────────────────────────────────┐
│                        TWILIO                               │
│  • Phone number: +1 820-900-4002                           │
│  • Inbound/Outbound call routing                           │
│  • Media Streams (real-time audio WebSocket)               │
└─────────────────────────────────────────────────────────────┘
                            ↕ WebSocket (audio stream)
┌─────────────────────────────────────────────────────────────┐
│                   VOICE BRIDGE SERVER                       │
│                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    │
│  │   DEEPGRAM  │    │   CLAUDE    │    │ ELEVENLABS  │    │
│  │    (STT)    │ → │   (BRAIN)   │ → │    (TTS)    │    │
│  │  Audio→Text │    │  + Tools    │    │  Text→Audio │    │
│  └─────────────┘    └─────────────┘    └─────────────┘    │
│                            ↕                                │
│                    OpenClaw Session                         │
│                  (Memory, Tools, Context)                   │
└─────────────────────────────────────────────────────────────┘
```

---

## Components

### 1. Twilio Integration
- **Credentials:** Account SID + Auth Token (Jason has these)
- **Inbound webhook:** Receives calls to our number
- **Outbound API:** Initiates calls to any number
- **Media Streams:** WebSocket for real-time bidirectional audio

### 2. Speech-to-Text (STT)
- **Provider:** Deepgram (fast streaming, ~$0.0043/min)
- **Alternative:** OpenAI Whisper API (~$0.006/min)
- **Requirements:** Streaming support, low latency, handles interruptions

### 3. Text-to-Speech (TTS)
- **Provider:** ElevenLabs
- **Pricing:** ~8-10¢/min (Conversational AI rate) or per-character
- **Requirements:** Streaming output, natural voice, low latency
- **Voice:** Need to select/create "my voice"

### 4. Conversation Orchestration
- **Turn management:** Know when to speak vs listen
- **Interruption handling:** Stop speaking if Jason interrupts
- **Context tracking:** Remember what we're discussing
- **Tool execution:** Can call tools mid-conversation

### 5. OpenClaw Integration
- **Option A:** Voice as new channel plugin (like Telegram)
- **Option B:** Bridge server calls back to OpenClaw API
- **Requirements:** Same tools, same memory, same me

---

## Technical Decisions Needed

| Decision | Options | Recommendation |
|----------|---------|----------------|
| STT Provider | Deepgram vs Whisper | Deepgram (faster streaming) |
| TTS Provider | ElevenLabs vs alternatives | ElevenLabs (quality + we know it) |
| Hosting | OpenClaw sandbox vs external | Need investigation |
| Voice persona | Clone vs preset | Start with preset, clone later |
| Integration | OpenClaw plugin vs standalone | Standalone first, plugin later |

---

## Estimated Costs (Per Minute of Call)

| Component | Cost/min |
|-----------|----------|
| Twilio (outbound US) | ~$0.014 |
| Twilio (inbound) | ~$0.0085 |
| Deepgram STT | ~$0.005 |
| ElevenLabs TTS | ~$0.08-0.10 |
| Claude API | ~$0.02-0.05 (varies) |
| **Total** | **~$0.12-0.18/min** |

A 5-minute call ≈ $0.60-0.90

---

## Phases

### Phase 1: Foundation (4-6 hrs)
- [ ] Store Twilio credentials securely
- [ ] Build `tools/twilio.js` for SMS + basic calls
- [ ] Set up ElevenLabs account + API key
- [ ] Set up Deepgram account + API key
- [ ] Test: Send SMS, make call with pre-generated TTS

**Deliverable:** I can text Jason and call him with a pre-recorded message.

### Phase 2: Inbound Real-Time Calls (8-12 hrs)
- [ ] Build WebSocket server for Twilio Media Streams
- [ ] Integrate Deepgram streaming STT
- [ ] Integrate ElevenLabs streaming TTS
- [ ] Basic conversation loop (listen → think → speak)
- [ ] Deploy to publicly accessible URL

**Deliverable:** Jason calls me, we have a basic real-time conversation.

### Phase 3: Full Integration (6-8 hrs)
- [ ] Connect voice server to my OpenClaw session
- [ ] Tool access during calls (Linear, calendar, email, etc.)
- [ ] Implement outbound call initiation
- [ ] Proactive calling triggers (cron, alerts, etc.)

**Deliverable:** Full bidirectional voice with my complete capabilities.

### Phase 4: Third Party Calls (4-6 hrs)
- [ ] Number lookup / contact management
- [ ] Robust conversation handling for external humans
- [ ] Confirmation flows (before committing to bookings, etc.)
- [ ] Call outcome reporting

**Deliverable:** I can call businesses and complete tasks on Jason's behalf.

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Latency too high | Poor UX, awkward pauses | Use streaming for STT+TTS, optimize pipeline |
| Third parties confused by AI | Failed tasks | Clear introduction, human-like conversation style |
| Costs add up | Budget overrun | Set usage alerts, review monthly |
| Hosting complexity | Deployment friction | Start with simple ngrok/tunnel, formalize later |
| Voice doesn't sound right | Uncanny valley | Test voices, consider custom clone |

---

## Dependencies

**Need from Jason:**
- [ ] Twilio Account SID + Auth Token
- [ ] Approval for ElevenLabs paid tier (if needed)
- [ ] Approval for Deepgram account

**Technical:**
- [ ] Public URL for webhooks (ngrok or proper hosting)
- [ ] Persistent server process for WebSocket handling

---

## Success Criteria

1. **Phase 1 complete:** I can send "Hello Jason" via SMS and call with TTS
2. **Phase 2 complete:** Jason calls, asks "What's the weather?", I answer correctly
3. **Phase 3 complete:** I proactively call Jason about an incoming email
4. **Phase 4 complete:** I successfully book a reservation at a real restaurant

---

## Estimated Total Effort

**25-35 hours** of focused work across all phases.

Could be compressed to ~1 week if prioritized, or spread over 2-3 weeks alongside other work.

---

*Created: 2026-02-01*
*Author: Maximus Carapax*
