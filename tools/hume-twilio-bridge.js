#!/usr/bin/env node
/**
 * Twilio-Hume EVI Bridge Server
 * 
 * A Node.js/Express server that bridges Twilio voice calls with Hume EVI.
 * 
 * Features:
 * - Receives Twilio voice calls via Media Streams (WebSocket audio)
 * - Connects to Hume EVI via their WebSocket API
 * - Passes audio bidirectionally between Twilio and Hume
 * - Handles tool_call messages from Hume (especially hang_up)
 * - Uses Twilio API to end calls when hang_up tool is called
 * 
 * Usage:
 *   node tools/hume-twilio-bridge.js [port] [hume-config-id]
 *   
 * Examples:
 *   node tools/hume-twilio-bridge.js 3000
 *   node tools/hume-twilio-bridge.js 3000 cc7579f9-a0a1-4dd0-bacc-62971d333de4
 */

const express = require('express');
const WebSocket = require('ws');
const twilio = require('twilio');
const path = require('path');
const fs = require('fs');

// Load credentials
const credsPath = path.join(process.env.HOME || process.env.USERPROFILE, '.openclaw/secrets/credentials.json');
let credentials = {};
try {
    credentials = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
} catch (error) {
    console.error('❌ Failed to load credentials from', credsPath);
    console.error('Make sure the file exists and contains your Hume and Twilio credentials');
    process.exit(1);
}

// Configuration
const PORT = process.argv[2] || 3000;
const HUME_CONFIG_ID = process.argv[3] || 'cc7579f9-a0a1-4dd0-bacc-62971d333de4'; // max-gemini-25
const HUME_API_KEY = credentials.hume_api_key;
const TWILIO_ACCOUNT_SID = credentials.twilio_au_account_sid;
const TWILIO_AUTH_TOKEN = credentials.twilio_au_auth_token;
const TWILIO_PHONE_NUMBER = credentials.twilio_au_phone_number || '+61468089420';

if (!HUME_API_KEY || !TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    console.error('❌ Missing required credentials in credentials.json:');
    console.error('  - hume_api_key');
    console.error('  - twilio_au_account_sid');
    console.error('  - twilio_au_auth_token');
    process.exit(1);
}

const app = express();
const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// Store active sessions
const activeSessions = new Map();

// Store pending call context (keyed by toNumber, consumed when call starts)
const pendingCallContext = new Map();

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

console.log('🚀 Starting Twilio-Hume EVI Bridge Server');
console.log('📞 Twilio Number:', TWILIO_PHONE_NUMBER);
console.log('🧠 Hume Config:', HUME_CONFIG_ID);
console.log('🌐 Port:', PORT);

/**
 * Audio format conversion utilities
 */
class AudioConverter {
    /**
     * Convert Twilio's mulaw audio to linear PCM for Hume
     * @param {string} mulawBase64 - Base64 encoded mulaw audio from Twilio
     * @returns {Buffer} - Linear PCM audio buffer for Hume
     */
    static mulawToPCM(mulawBase64) {
        const mulawBuffer = Buffer.from(mulawBase64, 'base64');
        const pcmBuffer = Buffer.alloc(mulawBuffer.length * 2); // 16-bit PCM = 2 bytes per sample
        
        for (let i = 0; i < mulawBuffer.length; i++) {
            const mulawSample = mulawBuffer[i];
            const pcmSample = this.mulawDecode(mulawSample);
            pcmBuffer.writeInt16LE(pcmSample, i * 2);
        }
        
        return pcmBuffer;
    }
    
    /**
     * Convert linear PCM from Hume to mulaw for Twilio
     * @param {Buffer} pcmBuffer - Linear PCM audio buffer from Hume
     * @returns {string} - Base64 encoded mulaw audio for Twilio
     */
    static pcmToMulaw(pcmBuffer) {
        const mulawBuffer = Buffer.alloc(pcmBuffer.length / 2);
        
        for (let i = 0; i < pcmBuffer.length; i += 2) {
            const pcmSample = pcmBuffer.readInt16LE(i);
            const mulawSample = this.mulawEncode(pcmSample);
            mulawBuffer[i / 2] = mulawSample;
        }
        
        return mulawBuffer.toString('base64');
    }
    
    /**
     * Decode mulaw to linear PCM (16-bit signed)
     */
    static mulawDecode(mulaw) {
        mulaw = ~mulaw;
        const sign = (mulaw & 0x80) !== 0;
        const exponent = (mulaw >> 4) & 0x07;
        const mantissa = mulaw & 0x0F;
        
        let sample = mantissa << (exponent + 3);
        if (exponent !== 0) sample += (1 << (exponent + 2));
        
        return sign ? -sample : sample;
    }
    
    /**
     * Encode linear PCM (16-bit signed) to mulaw
     */
    static mulawEncode(pcm) {
        const BIAS = 0x84;
        const CLIP = 32635;
        
        let sign = (pcm >> 8) & 0x80;
        if (sign !== 0) pcm = -pcm;
        if (pcm > CLIP) pcm = CLIP;
        
        pcm += BIAS;
        let exponent = 7;
        for (let expMask = 0x4000; (pcm & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1) {}
        
        const mantissa = (pcm >> (exponent + 3)) & 0x0F;
        const mulaw = ~(sign | (exponent << 4) | mantissa);
        
        return mulaw & 0xFF;
    }
}

/**
 * Session manager for Twilio-Hume bridge connections
 */
class BridgeSession {
    constructor(twilioWs, callSid, callContext = null) {
        this.twilioWs = twilioWs;
        this.callSid = callSid;
        this.humeWs = null;
        this.streamSid = null;
        this.isActive = true;
        this.callContext = callContext; // Context to inject into Hume session
        
        this.setupTwilioHandlers();
        this.connectToHume();
        
        console.log(`🔗 Session created for call ${callSid}`);
        if (callContext) {
            console.log(`📋 Call context loaded: calling ${callContext.name} for "${callContext.purpose || 'general check-in'}"`);
        }
    }
    
    setupTwilioHandlers() {
        this.twilioWs.on('message', (message) => {
            try {
                const data = JSON.parse(message);
                this.handleTwilioMessage(data);
            } catch (error) {
                console.error('❌ Error parsing Twilio message:', error);
            }
        });
        
        this.twilioWs.on('close', () => {
            console.log(`📞 Twilio WebSocket closed for call ${this.callSid}`);
            this.cleanup();
        });
        
        this.twilioWs.on('error', (error) => {
            console.error('❌ Twilio WebSocket error:', error);
            this.cleanup();
        });
    }
    
    async connectToHume() {
        try {
            const humeUrl = `wss://api.hume.ai/v0/evi/chat?api_key=${HUME_API_KEY}&config_id=${HUME_CONFIG_ID}`;
            this.humeWs = new WebSocket(humeUrl);
            
            this.humeWs.on('open', () => {
                console.log(`🧠 Connected to Hume EVI for call ${this.callSid}`);
                
                // Inject call context via session_settings
                if (this.callContext) {
                    this.injectCallContext();
                }
            });
            
            this.humeWs.on('message', (message) => {
                try {
                    const data = JSON.parse(message);
                    this.handleHumeMessage(data);
                } catch (error) {
                    console.error('❌ Error parsing Hume message:', error);
                }
            });
            
            this.humeWs.on('close', () => {
                console.log(`🧠 Hume WebSocket closed for call ${this.callSid}`);
                this.cleanup();
            });
            
            this.humeWs.on('error', (error) => {
                console.error('❌ Hume WebSocket error:', error);
                this.cleanup();
            });
            
        } catch (error) {
            console.error('❌ Failed to connect to Hume:', error);
            this.cleanup();
        }
    }
    
    handleTwilioMessage(data) {
        switch (data.event) {
            case 'connected':
                console.log(`📞 Twilio connected for call ${this.callSid}`);
                break;
                
            case 'start':
                this.streamSid = data.streamSid;
                console.log(`🔊 Stream started: ${this.streamSid}`);
                break;
                
            case 'media':
                if (data.media && data.media.payload && this.humeWs && this.humeWs.readyState === WebSocket.OPEN) {
                    // Convert Twilio mulaw to PCM and forward to Hume
                    try {
                        const pcmBuffer = AudioConverter.mulawToPCM(data.media.payload);
                        const audioMessage = {
                            type: 'audio_input',
                            data: pcmBuffer.toString('base64')
                        };
                        this.humeWs.send(JSON.stringify(audioMessage));
                    } catch (error) {
                        console.error('❌ Audio conversion error:', error);
                    }
                }
                break;
                
            case 'stop':
                console.log(`⏹️ Stream stopped for call ${this.callSid}`);
                this.cleanup();
                break;
                
            default:
                console.log(`📞 Twilio event: ${data.event}`, data);
        }
    }
    
    handleHumeMessage(data) {
        console.log('🧠 Hume message:', JSON.stringify(data, null, 2));
        
        switch (data.type) {
            case 'session_settings':
                console.log(`🧠 Hume session configured for call ${this.callSid}`);
                break;
                
            case 'audio_output':
                // Forward Hume audio to Twilio
                if (data.data && this.twilioWs && this.twilioWs.readyState === WebSocket.OPEN && this.streamSid) {
                    try {
                        // Assume Hume sends PCM, convert to mulaw for Twilio
                        const pcmBuffer = Buffer.from(data.data, 'base64');
                        const mulawBase64 = AudioConverter.pcmToMulaw(pcmBuffer);
                        
                        const mediaMessage = {
                            event: 'media',
                            streamSid: this.streamSid,
                            media: {
                                payload: mulawBase64
                            }
                        };
                        
                        this.twilioWs.send(JSON.stringify(mediaMessage));
                    } catch (error) {
                        console.error('❌ Audio forward error:', error);
                    }
                }
                break;
                
            case 'user_message':
                console.log(`👤 User said: "${data.message?.content || 'N/A'}"`);
                break;
                
            case 'assistant_message':
                console.log(`🧠 Hume responded: "${data.message?.content || 'N/A'}"`);
                break;
                
            case 'tool_call':
                console.log(`🔧 Tool call: ${data.name || data.tool_name}`, data);
                this.handleToolCall(data);
                break;
                
            case 'error':
                console.error('❌ Hume error:', data);
                break;
                
            default:
                // Log other message types for debugging
                if (data.type) {
                    console.log(`🧠 Hume ${data.type}:`, data);
                }
        }
    }
    
    async handleToolCall(toolCall) {
        const toolName = toolCall.name || toolCall.tool_name || toolCall.toolName;
        console.log(`🔧 Handling tool call: ${toolName}`);
        
        switch (toolName) {
            case 'hang_up':
                console.log(`📞 Hanging up call ${this.callSid} via tool call`);
                await this.hangUpCall();
                break;
                
            default:
                console.log(`❓ Unknown tool call: ${toolName}`);
                // You can add more tool handlers here
                break;
        }
    }
    
    /**
     * Inject call context into Hume session via session_settings message
     */
    injectCallContext() {
        if (!this.callContext || !this.humeWs || this.humeWs.readyState !== WebSocket.OPEN) {
            return;
        }
        
        const ctx = this.callContext;
        
        // Build system prompt with call context
        const contextualPrompt = `You are Max, Jason's AI assistant. You're making an outbound call.

IMPORTANT CALL CONTEXT:
- You are calling on behalf of: Jason Wu
- Person you're calling: ${ctx.name || 'Unknown'}
- Relationship: ${ctx.relationship || 'Unknown'}
- Purpose of this call: ${ctx.purpose || 'General check-in'}
${ctx.topics && ctx.topics.length > 0 ? `- Suggested topics: ${ctx.topics.join(', ')}` : ''}
${ctx.history && ctx.history.length > 0 ? `- Recent context: ${ctx.history.slice(0, 3).join('; ')}` : ''}

CALL GUIDELINES:
1. Start by greeting them naturally and identifying yourself: "Hey ${ctx.name || 'there'}, it's Max calling on behalf of Jason."
2. Briefly explain why you're calling (the purpose above)
3. Be conversational and friendly, not robotic
4. If they ask who you are: "I'm Max, Jason's AI assistant. He asked me to reach out."
5. Keep the call focused but natural
6. If they're busy or it's a bad time, offer to call back later

VOICEMAIL GUIDELINES:
If you reach voicemail or the person doesn't answer:
1. Leave a brief, friendly message
2. Identify yourself: "Hey ${ctx.name || 'there'}, this is Max calling on behalf of Jason"
3. State the purpose briefly
4. End with: "Give Jason a call back when you get a chance, or I can try again later"
5. Then hang up (use the hang_up tool)

Be warm, helpful, and represent Jason well.`;

        // Send session_settings message
        const sessionSettings = {
            type: 'session_settings',
            system_prompt: contextualPrompt,
            context: {
                text: `This is an outbound call to ${ctx.name}. Purpose: ${ctx.purpose || 'check-in'}. Calling on behalf of Jason Wu.`,
                type: 'persistent'
            },
            variables: {
                name: ctx.name || 'there',
                purpose: ctx.purpose || 'checking in',
                caller: 'Jason Wu'
            }
        };
        
        console.log(`📋 Injecting call context for ${ctx.name}...`);
        this.humeWs.send(JSON.stringify(sessionSettings));
        console.log(`✅ Call context injected into Hume session`);
    }
    
    async hangUpCall() {
        try {
            console.log(`📞 Terminating call ${this.callSid}...`);
            
            await twilioClient.calls(this.callSid).update({
                status: 'completed'
            });
            
            console.log(`✅ Call ${this.callSid} terminated successfully`);
            this.cleanup();
            
        } catch (error) {
            console.error(`❌ Failed to terminate call ${this.callSid}:`, error.message);
            
            // Try alternative method - update with TwiML
            try {
                await twilioClient.calls(this.callSid).update({
                    twiml: '<Response><Hangup/></Response>'
                });
                console.log(`✅ Call ${this.callSid} terminated via TwiML`);
                this.cleanup();
            } catch (twimlError) {
                console.error(`❌ TwiML termination also failed:`, twimlError.message);
            }
        }
    }
    
    cleanup() {
        if (!this.isActive) return;
        this.isActive = false;
        
        console.log(`🧹 Cleaning up session for call ${this.callSid}`);
        
        if (this.humeWs && this.humeWs.readyState === WebSocket.OPEN) {
            this.humeWs.close();
        }
        
        if (this.twilioWs && this.twilioWs.readyState === WebSocket.OPEN) {
            this.twilioWs.close();
        }
        
        activeSessions.delete(this.callSid);
        console.log(`🗑️ Session cleaned up for call ${this.callSid}`);
    }
}

/**
 * Twilio webhook endpoint for incoming calls
 */
app.post('/voice/incoming', (req, res) => {
    const callSid = req.body.CallSid;
    const from = req.body.From;
    const to = req.body.To;
    
    console.log(`📞 Incoming call: ${from} → ${to} (${callSid})`);
    
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="Polly.Matthew">Hello! Connecting you to Max, powered by Hume AI. Please hold on.</Say>
    <Connect>
        <Stream url="wss://${req.get('host')}/media-stream"/>
    </Connect>
</Response>`;
    
    res.type('text/xml');
    res.send(twiml);
});

/**
 * API endpoint to make outbound calls with context
 * POST /call/outbound
 * Body: { to: "+61...", name: "Kevin", purpose: "Check if coming over", relationship: "friend" }
 */
app.post('/call/outbound', async (req, res) => {
    const { to, name, purpose, relationship, topics, history } = req.body;
    
    if (!to) {
        return res.status(400).json({ error: 'Missing required field: to (phone number)' });
    }
    
    console.log(`📞 Outbound call request: ${name || 'Unknown'} at ${to}`);
    console.log(`   Purpose: ${purpose || 'general check-in'}`);
    
    // Store context for this call (keyed by phone number, will be matched when call connects)
    const callContext = {
        name: name || 'there',
        purpose: purpose || null,
        relationship: relationship || null,
        topics: topics || [],
        history: history || [],
        createdAt: Date.now()
    };
    
    pendingCallContext.set(to, callContext);
    
    // Also store by normalized number (remove spaces, dashes)
    const normalizedTo = to.replace(/[\s\-\(\)]/g, '');
    if (normalizedTo !== to) {
        pendingCallContext.set(normalizedTo, callContext);
    }
    
    try {
        // Make outbound call via Twilio, pointing to our own webhook
        const baseUrl = req.protocol + '://' + req.get('host');
        
        const call = await twilioClient.calls.create({
            to: to,
            from: TWILIO_PHONE_NUMBER,
            url: `${baseUrl}/voice/outbound?name=${encodeURIComponent(name || '')}&purpose=${encodeURIComponent(purpose || '')}`,
            statusCallback: `${baseUrl}/call/status`,
            statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed']
        });
        
        console.log(`✅ Call initiated: ${call.sid}`);
        
        res.json({
            success: true,
            callSid: call.sid,
            to: to,
            name: name,
            purpose: purpose,
            status: call.status
        });
        
    } catch (error) {
        console.error(`❌ Failed to initiate call:`, error.message);
        
        // Clean up pending context
        pendingCallContext.delete(to);
        pendingCallContext.delete(normalizedTo);
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Twilio webhook for outbound calls (with context)
 */
app.post('/voice/outbound', (req, res) => {
    const callSid = req.body.CallSid;
    const to = req.body.To;
    const name = req.query.name || '';
    const purpose = req.query.purpose || '';
    
    console.log(`📞 Outbound call connected: ${to} (${callSid})`);
    
    // Generate TwiML to connect to our media stream
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Connect>
        <Stream url="wss://${req.get('host')}/media-stream?to=${encodeURIComponent(to)}&amp;name=${encodeURIComponent(name)}&amp;purpose=${encodeURIComponent(purpose)}"/>
    </Connect>
</Response>`;
    
    res.type('text/xml');
    res.send(twiml);
});

/**
 * Call status callback
 */
app.post('/call/status', (req, res) => {
    const { CallSid, CallStatus, To, Duration } = req.body;
    console.log(`📊 Call ${CallSid} status: ${CallStatus}${Duration ? ` (${Duration}s)` : ''}`);
    
    // Clean up pending context when call completes
    if (CallStatus === 'completed' || CallStatus === 'failed' || CallStatus === 'canceled') {
        pendingCallContext.delete(To);
        pendingCallContext.delete(To.replace(/[\s\-\(\)]/g, ''));
    }
    
    res.sendStatus(200);
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        activeSessions: activeSessions.size,
        config: {
            port: PORT,
            humeConfigId: HUME_CONFIG_ID,
            twilioNumber: TWILIO_PHONE_NUMBER
        }
    });
});

/**
 * Status endpoint
 */
app.get('/status', (req, res) => {
    const sessions = Array.from(activeSessions.entries()).map(([callSid, session]) => ({
        callSid,
        streamSid: session.streamSid,
        isActive: session.isActive,
        humeConnected: session.humeWs?.readyState === WebSocket.OPEN,
        twilioConnected: session.twilioWs?.readyState === WebSocket.OPEN
    }));
    
    res.json({
        activeSessions: activeSessions.size,
        sessions,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// Create HTTP server
const server = app.listen(PORT, () => {
    console.log(`✅ Twilio-Hume Bridge Server listening on port ${PORT}`);
    console.log(`📋 Endpoints:`);
    console.log(`   POST /voice/incoming - Twilio voice webhook`);
    console.log(`   GET  /health - Health check`);
    console.log(`   GET  /status - Session status`);
    console.log(`   WS   /media-stream - Twilio media stream`);
    console.log('');
    console.log(`🔧 Configuration:`);
    console.log(`   Twilio Number: ${TWILIO_PHONE_NUMBER}`);
    console.log(`   Hume Config: ${HUME_CONFIG_ID}`);
    console.log('');
    console.log('📞 Ready to receive calls!');
});

// Create WebSocket server for Twilio media streams
const wss = new WebSocket.Server({ 
    server,
    path: '/media-stream'
});

wss.on('connection', (ws, req) => {
    console.log('🔌 New WebSocket connection from Twilio');
    
    // Extract context from query params if present (for outbound calls)
    const url = new URL(req.url, `http://${req.headers.host}`);
    const queryTo = url.searchParams.get('to');
    const queryName = url.searchParams.get('name');
    const queryPurpose = url.searchParams.get('purpose');
    
    let callSid = null;
    
    // Wait for the first message to get call info
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            if (data.event === 'start' && data.start) {
                callSid = data.start.callSid;
                console.log(`🔗 Creating bridge session for call ${callSid}`);
                
                // Look up call context
                let callContext = null;
                
                // First try pending context by phone number
                const toNumber = queryTo || data.start.customParameters?.to;
                if (toNumber) {
                    callContext = pendingCallContext.get(toNumber);
                    if (callContext) {
                        console.log(`📋 Found pending context for ${toNumber}`);
                        // Clean up pending context
                        pendingCallContext.delete(toNumber);
                        pendingCallContext.delete(toNumber.replace(/[\s\-\(\)]/g, ''));
                    }
                }
                
                // If no pending context but we have query params, build context from those
                if (!callContext && (queryName || queryPurpose)) {
                    callContext = {
                        name: queryName || 'there',
                        purpose: queryPurpose || null,
                        relationship: null,
                        topics: [],
                        history: []
                    };
                    console.log(`📋 Built context from query params: ${queryName}, purpose: ${queryPurpose}`);
                }
                
                // Create new bridge session with context
                const session = new BridgeSession(ws, callSid, callContext);
                activeSessions.set(callSid, session);
            }
        } catch (error) {
            console.error('❌ Error handling WebSocket message:', error);
        }
    });
    
    ws.on('close', () => {
        console.log(`🔌 WebSocket closed ${callSid ? `for call ${callSid}` : ''}`);
        if (callSid && activeSessions.has(callSid)) {
            activeSessions.get(callSid).cleanup();
        }
    });
    
    ws.on('error', (error) => {
        console.error('❌ WebSocket error:', error);
        if (callSid && activeSessions.has(callSid)) {
            activeSessions.get(callSid).cleanup();
        }
    });
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down gracefully...');
    
    // Close all active sessions
    for (const session of activeSessions.values()) {
        session.cleanup();
    }
    
    // Close server
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

module.exports = { app, BridgeSession, AudioConverter };