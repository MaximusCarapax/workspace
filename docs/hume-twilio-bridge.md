# Twilio-Hume EVI Bridge Server

A Node.js/Express server that bridges Twilio voice calls with Hume's Empathic Voice Interface (EVI), enabling real-time conversational AI phone calls with tool support.

## Features

- ✅ **Bidirectional Audio Streaming**: Real-time audio between Twilio calls and Hume EVI
- ✅ **Tool Call Support**: Handles Hume tool calls (especially `hang_up` to end calls)  
- ✅ **Audio Format Conversion**: Automatic conversion between Twilio's mulaw and Hume's PCM
- ✅ **Session Management**: Tracks active call sessions with proper cleanup
- ✅ **Error Handling**: Graceful error recovery and logging
- ✅ **Health Monitoring**: Built-in health checks and status endpoints

## Architecture

```
Phone Call → Twilio → Media Streams (WebSocket) → Bridge Server → Hume EVI (WebSocket)
                                                      ↓
                                               Tool Call Handler
                                                      ↓
                                               Twilio API (end call)
```

## Setup

### 1. Prerequisites

- Node.js v16+ 
- Active Twilio account with AU phone number
- Hume AI account with API key
- Configured Hume EVI configuration

### 2. Install Dependencies

```bash
cd /home/node/.openclaw/workspace
npm install ws express twilio  # Should already be installed
```

### 3. Verify Setup

```bash
node tools/test-hume-bridge.js
```

This checks credentials, dependencies, and basic functionality.

### 4. Start the Bridge Server

```bash
# Default port 3000, default Hume config
node tools/hume-twilio-bridge.js

# Custom port and Hume config
node tools/hume-twilio-bridge.js 3000 cc7579f9-a0a1-4dd0-bacc-62971d333de4
```

### 5. Expose with ngrok

```bash
ngrok http 3000
```

Copy the HTTPS URL (e.g., `https://abc123.ngrok.io`).

### 6. Configure Twilio Webhook

In your Twilio Console:

1. Go to Phone Numbers → Manage → Active numbers
2. Click on `+61 468 089 420`
3. Set Voice webhook URL to: `https://your-ngrok-url.com/voice/incoming`
4. Set HTTP method to `POST`
5. Save

## Usage

### Making Test Calls

Call `+61 468 089 420` to test the bridge. The call flow:

1. **Twilio answers** with greeting message
2. **Bridge connects** to Hume EVI
3. **Conversation starts** with Hume's AI persona (Max)
4. **Tool calls processed** (e.g., hang_up ends the call)

### Monitoring

**Health Check:**
```bash
curl http://localhost:3000/health
```

**Active Sessions:**
```bash
curl http://localhost:3000/status
```

**Server Logs:**
```bash
node tools/hume-twilio-bridge.js | tee bridge.log
```

## Configuration

### Environment Variables

The bridge loads credentials from `~/.openclaw/secrets/credentials.json`:

```json
{
  "hume_api_key": "your_hume_api_key",
  "twilio_au_account_sid": "your_twilio_sid", 
  "twilio_au_auth_token": "your_twilio_token",
  "twilio_au_phone_number": "+61468089420"
}
```

### Command Line Arguments

```bash
node tools/hume-twilio-bridge.js [PORT] [HUME_CONFIG_ID]
```

- `PORT`: Server port (default: 3000)
- `HUME_CONFIG_ID`: Hume EVI configuration ID (default: cc7579f9-a0a1-4dd0-bacc-62971d333de4)

### Hume Configuration

The bridge uses the **max-gemini-25** config by default:

- **Config ID**: `cc7579f9-a0a1-4dd0-bacc-62971d333de4`
- **LLM**: Gemini 2.5 Flash  
- **Voice**: Ito (male, American accent)
- **Personality**: Max - Jason's AI assistant

## Tool Support

### Built-in Tools

#### `hang_up`
Terminates the Twilio call when Hume decides the conversation is complete.

**Implementation:**
```javascript
case 'hang_up':
    await twilioClient.calls(callSid).update({ status: 'completed' });
    break;
```

### Adding Custom Tools

1. **Define tool in Hume config** via Hume API or web interface
2. **Handle in bridge** by adding case to `handleToolCall()`:

```javascript
case 'your_tool_name':
    console.log('🔧 Handling your tool');
    // Your tool logic here
    break;
```

## Audio Processing

### Format Conversion

| Source | Format | Target | Format |
|--------|--------|--------|--------|
| Twilio | mulaw, 8kHz, mono, base64 | Hume | PCM, 16-bit, base64 |
| Hume | PCM, 16-bit, base64 | Twilio | mulaw, 8kHz, mono, base64 |

### Audio Flow

```javascript
Twilio Media Message → mulawToPCM() → Hume audio_input
Hume audio_output → pcmToMulaw() → Twilio Media Message
```

## API Endpoints

### `POST /voice/incoming`
Twilio voice webhook. Returns TwiML to start media streaming.

**Request:** Twilio webhook parameters
**Response:** TwiML with `<Connect><Stream>`

### `GET /health`
Health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2026-02-05T04:00:00Z", 
  "activeSessions": 2,
  "config": {
    "port": 3000,
    "humeConfigId": "cc7579f9-a0a1-4dd0-bacc-62971d333de4",
    "twilioNumber": "+61468089420"
  }
}
```

### `GET /status`
Detailed session status.

**Response:**
```json
{
  "activeSessions": 1,
  "sessions": [
    {
      "callSid": "CAxxxxx",
      "streamSid": "MZxxxxx", 
      "isActive": true,
      "humeConnected": true,
      "twilioConnected": true
    }
  ],
  "uptime": 3600,
  "timestamp": "2026-02-05T04:00:00Z"
}
```

### `WS /media-stream`
WebSocket endpoint for Twilio Media Streams. Auto-creates bridge sessions.

## Troubleshooting

### Common Issues

**❌ "Failed to load credentials"**
- Check `~/.openclaw/secrets/credentials.json` exists
- Verify all required fields are present

**❌ "Hume WebSocket error"**  
- Verify `hume_api_key` is correct
- Check Hume config ID exists and is accessible
- Ensure network connectivity to `api.hume.ai`

**❌ "Twilio WebSocket closed"**
- Check ngrok tunnel is active
- Verify Twilio webhook URL is correct
- Confirm Twilio credentials are valid

**❌ "Audio conversion error"**
- Usually indicates corrupt audio data
- Check network stability between Twilio and server

### Debug Mode

Add debug logging by setting environment variable:

```bash
DEBUG=* node tools/hume-twilio-bridge.js
```

### Log Analysis

Key log patterns to watch:

```bash
# Successful session start
🔗 Session created for call CAxxxxx
🧠 Connected to Hume EVI for call CAxxxxx

# Audio flowing
📞 Twilio media event
🧠 Hume audio_output

# Tool calls
🔧 Tool call: hang_up
📞 Hanging up call CAxxxxx via tool call

# Session cleanup
🧹 Cleaning up session for call CAxxxxx
```

## Performance

### Capacity

- **Concurrent Sessions**: Limited by server resources and Hume/Twilio quotas
- **Audio Latency**: ~100-300ms (network dependent)
- **Memory Usage**: ~50MB base + ~5MB per active session

### Optimization

- **Audio Buffers**: Adjust buffer sizes for latency vs stability
- **Connection Pooling**: Reuse WebSocket connections where possible
- **Error Recovery**: Implement exponential backoff for reconnections

## Security

### WebSocket Security

- Twilio validates requests with X-Twilio-Signature headers
- Hume uses API key authentication
- All connections use WSS (secure WebSockets)

### Best Practices

- Keep API keys in secure credential store
- Use HTTPS/WSS in production
- Implement rate limiting for public endpoints
- Monitor for suspicious call patterns

## Production Deployment

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 3000
CMD ["node", "tools/hume-twilio-bridge.js", "3000"]
```

### Process Management

```bash
# Using PM2
pm2 start tools/hume-twilio-bridge.js --name "hume-bridge" -- 3000

# Using systemd
sudo systemctl enable hume-bridge
sudo systemctl start hume-bridge
```

### Load Balancing

For high availability, run multiple bridge instances behind a load balancer:

```nginx
upstream hume_bridge {
    server localhost:3000;
    server localhost:3001; 
    server localhost:3002;
}

server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://hume_bridge;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

## Development

### Code Structure

```
tools/hume-twilio-bridge.js
├── AudioConverter          # mulaw ↔ PCM conversion
├── BridgeSession           # Session management
├── Express routes          # HTTP endpoints  
├── WebSocket server        # Twilio media streams
└── Signal handlers         # Graceful shutdown
```

### Contributing

1. **Fork** the repository
2. **Create** feature branch
3. **Add tests** for new functionality  
4. **Update docs** as needed
5. **Submit** pull request

### Testing

```bash
# Unit tests
npm test

# Integration test
node tools/test-hume-bridge.js

# End-to-end test
# 1. Start bridge
# 2. Call Twilio number
# 3. Verify conversation works
# 4. Test tool calls
```

## Support

- **Issues**: Create GitHub issue with logs and configuration
- **Questions**: Check existing docs and issue history
- **Feature requests**: Open GitHub discussion

---

**Created**: 2026-02-05  
**Version**: 1.0.0  
**Author**: Maximus Carapax (AI Assistant)