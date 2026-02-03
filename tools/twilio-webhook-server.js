#!/usr/bin/env node
/**
 * Twilio Webhook Server
 * Handles inbound voice calls
 * 
 * Usage:
 *   node twilio-webhook-server.js [port]
 *   node twilio-webhook-server.js 3000
 * 
 * Endpoints:
 *   POST /voice/incoming   - Handle incoming calls
 *   POST /voice/recording  - Handle recording callbacks
 *   GET  /health           - Health check
 * 
 * Note: For production, expose via ngrok or similar:
 *   ngrok http 3000
 *   Then configure Twilio webhook URL to: https://xxx.ngrok.io/voice/incoming
 */

const express = require('express');
const twilio = require('twilio');
const fs = require('fs');
const path = require('path');

const app = express();

// Parse URL-encoded bodies (Twilio sends form data)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Load credentials for validation
const CREDS_PATH = path.join(process.env.HOME, '.openclaw/secrets/credentials.json');

function loadCredentials() {
  if (!fs.existsSync(CREDS_PATH)) {
    console.warn('⚠️  Credentials file not found - request validation disabled');
    return null;
  }
  
  const creds = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8'));
  return {
    accountSid: creds.twilio_account_sid,
    authToken: creds.twilio_auth_token,
    phoneNumber: creds.twilio_phone_number
  };
}

// Recordings directory
const RECORDINGS_DIR = path.join(process.env.HOME, '.openclaw/workspace/data/voice-recordings');
if (!fs.existsSync(RECORDINGS_DIR)) {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
}

// Call log
const CALL_LOG_PATH = path.join(process.env.HOME, '.openclaw/workspace/data/voice-call-log.json');

function logCall(callData) {
  let log = [];
  if (fs.existsSync(CALL_LOG_PATH)) {
    try {
      log = JSON.parse(fs.readFileSync(CALL_LOG_PATH, 'utf8'));
    } catch (e) {
      log = [];
    }
  }
  
  log.push({
    ...callData,
    timestamp: new Date().toISOString()
  });
  
  // Keep last 100 calls
  if (log.length > 100) {
    log = log.slice(-100);
  }
  
  fs.writeFileSync(CALL_LOG_PATH, JSON.stringify(log, null, 2));
}

// Middleware for logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log('  Body:', JSON.stringify(req.body, null, 2));
  }
  next();
});

/**
 * Handle incoming voice calls
 * Answers, plays greeting, records message, hangs up
 */
app.post('/voice/incoming', (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  
  // Extract caller info
  const callSid = req.body.CallSid;
  const from = req.body.From;
  const to = req.body.To;
  const callStatus = req.body.CallStatus;
  
  console.log(`📞 Incoming call from ${from} to ${to}`);
  console.log(`   CallSid: ${callSid}`);
  console.log(`   Status: ${callStatus}`);
  
  // Log the call
  logCall({
    type: 'incoming',
    callSid,
    from,
    to,
    status: callStatus
  });
  
  // Greeting
  twiml.say(
    { voice: 'Polly.Joanna', language: 'en-US' },
    "Hello! You've reached the OpenClaw voice assistant. Please leave a message after the beep, and I'll get back to you shortly."
  );
  
  // Pause briefly
  twiml.pause({ length: 1 });
  
  // Record the message
  twiml.record({
    maxLength: 120,  // 2 minutes max
    playBeep: true,
    transcribe: false,  // We'll handle STT separately
    recordingStatusCallback: '/voice/recording',
    recordingStatusCallbackEvent: 'completed',
    action: '/voice/recording-complete',  // What to do after recording
    timeout: 5  // 5 seconds of silence to stop
  });
  
  // Fallback if they don't leave a message
  twiml.say(
    { voice: 'Polly.Joanna' },
    "I didn't receive a message. Goodbye!"
  );
  
  res.type('text/xml');
  res.send(twiml.toString());
});

/**
 * Called after recording completes (action URL)
 */
app.post('/voice/recording-complete', (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  
  const recordingUrl = req.body.RecordingUrl;
  const recordingDuration = req.body.RecordingDuration;
  
  console.log(`✅ Recording completed: ${recordingDuration}s`);
  if (recordingUrl) {
    console.log(`   URL: ${recordingUrl}`);
  }
  
  // Thank them and hang up
  twiml.say(
    { voice: 'Polly.Joanna' },
    "Thank you for your message. Goodbye!"
  );
  twiml.hangup();
  
  res.type('text/xml');
  res.send(twiml.toString());
});

/**
 * Recording status callback
 * Called when recording is ready for download
 */
app.post('/voice/recording', async (req, res) => {
  const recordingSid = req.body.RecordingSid;
  const recordingUrl = req.body.RecordingUrl;
  const recordingDuration = req.body.RecordingDuration;
  const callSid = req.body.CallSid;
  
  console.log(`🎙️  Recording ready: ${recordingSid}`);
  console.log(`   Duration: ${recordingDuration}s`);
  console.log(`   URL: ${recordingUrl}`);
  
  // Log recording info
  logCall({
    type: 'recording',
    callSid,
    recordingSid,
    recordingUrl,
    duration: recordingDuration
  });
  
  // Optionally download the recording
  // The URL is accessible with Basic Auth using account credentials
  // For now, just log it - downloading can be added later
  
  // Save recording metadata
  const metadataPath = path.join(RECORDINGS_DIR, `${recordingSid}.json`);
  fs.writeFileSync(metadataPath, JSON.stringify({
    recordingSid,
    callSid,
    recordingUrl,
    duration: recordingDuration,
    timestamp: new Date().toISOString()
  }, null, 2));
  
  res.sendStatus(200);
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'twilio-webhook-server',
    timestamp: new Date().toISOString()
  });
});

/**
 * Call status callback (for outbound calls)
 */
app.post('/voice/status', (req, res) => {
  const callSid = req.body.CallSid;
  const callStatus = req.body.CallStatus;
  const duration = req.body.CallDuration;
  
  console.log(`📊 Call status update: ${callSid}`);
  console.log(`   Status: ${callStatus}`);
  if (duration) {
    console.log(`   Duration: ${duration}s`);
  }
  
  logCall({
    type: 'status',
    callSid,
    status: callStatus,
    duration
  });
  
  res.sendStatus(200);
});

/**
 * Simple test endpoint - returns TwiML that just says hello
 */
app.post('/voice/test', (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say({ voice: 'Polly.Joanna' }, 'Hello! The webhook server is working correctly.');
  twiml.hangup();
  
  res.type('text/xml');
  res.send(twiml.toString());
});

/**
 * Show help/info
 */
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head><title>Twilio Webhook Server</title></head>
      <body>
        <h1>Twilio Webhook Server</h1>
        <p>Endpoints:</p>
        <ul>
          <li><code>POST /voice/incoming</code> - Handle incoming calls</li>
          <li><code>POST /voice/recording</code> - Recording status callback</li>
          <li><code>POST /voice/status</code> - Call status callback</li>
          <li><code>POST /voice/test</code> - Test TwiML response</li>
          <li><code>GET /health</code> - Health check</li>
        </ul>
        <p>Status: ✅ Running</p>
      </body>
    </html>
  `);
});

// Start server
const PORT = parseInt(process.argv[2]) || 3000;

app.listen(PORT, () => {
  console.log(`
🚀 Twilio Webhook Server running on port ${PORT}
   
   Endpoints:
   - POST http://localhost:${PORT}/voice/incoming
   - POST http://localhost:${PORT}/voice/recording
   - POST http://localhost:${PORT}/voice/status
   - GET  http://localhost:${PORT}/health
   
   To expose publicly, use ngrok:
   $ ngrok http ${PORT}
   
   Then configure Twilio phone number webhook:
   Voice > A Call Comes In > Webhook > https://xxx.ngrok.io/voice/incoming
`);
  
  // Check for credentials
  const creds = loadCredentials();
  if (creds) {
    console.log(`   Twilio Phone: ${creds.phoneNumber || 'Not configured'}`);
  }
});

module.exports = app;
