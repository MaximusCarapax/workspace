---
title: "Voice Channel Architecture"
tags: [infrastructure, voice, twilio, elevenlabs]
created: 2026-02-01
related: [[journals/2026-02-01]]
---

# Voice Channel Architecture

Giving Maximus a voice — not a generic voice agent, but the same brain with audio I/O.

## Use Cases

1. **Jason calls me** — Real-time conversation, task delegation
2. **I call Jason** — Proactive alerts, reminders, updates
3. **I call third parties** — Book restaurants, schedule appointments

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      JASON'S PHONE                          │
└─────────────────────────────────────────────────────────────┘
                            ↕ Voice Call
┌─────────────────────────────────────────────────────────────┐
│                        TWILIO                               │
│  • Phone number: +1 820-900-4002                           │
│  • Media Streams (real-time audio WebSocket)               │
└─────────────────────────────────────────────────────────────┘
                            ↕ WebSocket
┌─────────────────────────────────────────────────────────────┐
│                   VOICE BRIDGE SERVER                       │
│  Deepgram (STT) → Claude (Brain) → ElevenLabs (TTS)        │
└─────────────────────────────────────────────────────────────┘
```

## Cost Estimate

~$0.12-0.18 per minute of call

## Status

Scoped. Tracked in Linear as MAX-11 through MAX-15.

## Related

- [[journals/2026-02-01]] — When this was designed
- Full spec: `docs/VOICE-CHANNEL-SCOPE.md`
