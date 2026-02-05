# Hume-Twilio Bridge Server

## Problem
Hume's direct `/v0/evi/twilio` endpoint doesn't support tool use (including `hang_up`). 
When the AI says "goodbye", the call stays connected because the tool can't actually execute.

## Solution
Build a bridge server that sits between Twilio and Hume EVI:

```
[Caller] <---> [Twilio] <---> [Bridge Server] <---> [Hume EVI WebSocket]
```

## Requirements

### Core Functionality
1. Accept Twilio Media Streams (WebSocket audio from incoming/outgoing calls)
2. Connect to Hume EVI via their WebSocket API
3. Pass audio bidirectionally (handle format conversion if needed)
4. Listen for `tool_call` messages from Hume
5. When `hang_up` tool is called → use Twilio API to end the call

### Audio Handling
- Twilio: mulaw 8kHz mono
- Hume: likely needs PCM 16-bit or similar
- May need real-time conversion

### Endpoints
- `POST /voice/incoming` - TwiML response to start Media Stream
- `WS /media-stream` - Receive Twilio audio, proxy to Hume

### Deployment
- Run on Zeabur (maxcarapax.zeabur.app)
- Or as part of existing Express server

## Status
- [x] Spec created
- [ ] Bridge server built
- [ ] Tool call handling implemented  
- [ ] Deployed to Zeabur
- [ ] Tested with real calls

## Resources
- Hume EVI WebSocket: https://dev.hume.ai/docs/speech-to-speech-evi
- Twilio Media Streams: https://www.twilio.com/docs/voice/media-streams
- Hume examples: https://github.com/HumeAI/hume-api-examples

## Date
2026-02-05
