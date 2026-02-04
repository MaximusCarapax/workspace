#!/usr/bin/env node
/**
 * Smart Notification System
 * 
 * Attempts to reach someone via:
 * 1. Phone call (ElevenLabs Conversational AI for complex, Twilio Polly for simple)
 * 2. If no answer, retry after 5-10 seconds
 * 3. If still no answer, send SMS
 * 
 * Usage:
 *   node notify.js call <number> <name> "message"          # Conversational call
 *   node notify.js remind <number> <name> "message"        # Simple TTS reminder (Polly)
 *   node notify.js alert <number> <name> "message"         # Full escalation: call → retry → SMS
 */

const fs = require('fs');
const path = require('path');

// Load credentials
function loadCredentials() {
  const envPath = path.join(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
      const match = line.match(/^([A-Z_]+)=(.+)$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].trim();
      }
    });
  }
  
  const credsPath = '/home/node/.openclaw/secrets/credentials.json';
  if (fs.existsSync(credsPath)) {
    return JSON.parse(fs.readFileSync(credsPath, 'utf8'));
  }
  return {};
}

const creds = loadCredentials();

// Twilio config
const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID || creds.twilio?.account_sid;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN || creds.twilio?.auth_token;
const TWILIO_NUMBER = process.env.TWILIO_PHONE_NUMBER || creds.twilio?.phone_number || '+18209004002';

// ElevenLabs config
const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_AGENT = 'agent_5101kghqpcgsfpfs9r4s1q43thza';

// Format phone number
function formatPhone(num) {
  let clean = num.replace(/[^0-9+]/g, '');
  if (clean.startsWith('04')) {
    clean = '+61' + clean.slice(1);
  } else if (clean.startsWith('0')) {
    clean = '+61' + clean.slice(1);
  } else if (!clean.startsWith('+')) {
    clean = '+' + clean;
  }
  return clean;
}

// Send SMS via Twilio
async function sendSMS(to, message) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;
  const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64');
  
  const body = new URLSearchParams({
    To: to,
    From: TWILIO_NUMBER,
    Body: message
  });
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  });
  
  const data = await response.json();
  if (data.sid) {
    console.log('✓ SMS sent:', data.sid);
    return { success: true, sid: data.sid };
  } else {
    console.log('✗ SMS failed:', data.message);
    return { success: false, error: data.message };
  }
}

// Simple TTS call via Twilio Polly (for reminders)
async function simpleCall(to, message, voice = 'Polly.Matthew') {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Calls.json`;
  const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64');
  
  // TwiML for simple message
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">${message}</Say>
  <Pause length="1"/>
  <Say voice="${voice}">Goodbye.</Say>
</Response>`;
  
  const body = new URLSearchParams({
    To: to,
    From: TWILIO_NUMBER,
    Twiml: twiml
  });
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  });
  
  const data = await response.json();
  if (data.sid) {
    console.log('✓ Call initiated:', data.sid);
    return { success: true, sid: data.sid, status: data.status };
  } else {
    console.log('✗ Call failed:', data.message);
    return { success: false, error: data.message };
  }
}

// Check call status
async function getCallStatus(sid) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Calls/${sid}.json`;
  const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64');
  
  const response = await fetch(url, {
    headers: { 'Authorization': `Basic ${auth}` }
  });
  
  return response.json();
}

// Wait for call to complete and check if answered
async function waitForCallResult(sid, timeoutMs = 60000) {
  const start = Date.now();
  
  while (Date.now() - start < timeoutMs) {
    const status = await getCallStatus(sid);
    
    // Terminal states
    if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(status.status)) {
      return {
        answered: status.status === 'completed' && status.duration > 0,
        status: status.status,
        duration: status.duration
      };
    }
    
    // Wait before checking again
    await new Promise(r => setTimeout(r, 2000));
  }
  
  return { answered: false, status: 'timeout', duration: 0 };
}

// Conversational call via ElevenLabs
async function conversationalCall(to, name, context) {
  const response = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/initiate-outbound-call`, {
    method: 'POST',
    headers: {
      'xi-api-key': ELEVENLABS_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      agent_id: ELEVENLABS_AGENT,
      agent_phone_number_id: 'phnum_4801kghqr4hmexb9xj527acefsvn',
      to_number: to,
      custom_llm_extra_body: {
        caller_name: name,
        call_context: context
      }
    })
  });
  
  const data = await response.json();
  if (data.conversation_id) {
    console.log('✓ Conversational call started:', data.conversation_id);
    return { success: true, conversationId: data.conversation_id };
  } else {
    console.log('✗ Call failed:', JSON.stringify(data));
    return { success: false, error: data };
  }
}

// Full alert escalation: call → wait → retry → SMS
async function alertEscalation(to, name, message) {
  console.log(`\n🚨 ALERT ESCALATION: ${name} (${to})`);
  console.log(`   Message: ${message}\n`);
  
  const phone = formatPhone(to);
  
  // Attempt 1: Phone call
  console.log('📞 Attempt 1: Calling...');
  const call1 = await simpleCall(phone, `Hey ${name}, ${message}`);
  
  if (!call1.success) {
    console.log('   Call failed, sending SMS...');
    await sendSMS(phone, `Hey ${name}, ${message}`);
    return { method: 'sms', reason: 'call_failed' };
  }
  
  // Wait for result
  const result1 = await waitForCallResult(call1.sid);
  console.log(`   Result: ${result1.status} (${result1.duration}s)`);
  
  if (result1.answered) {
    console.log('✅ Reached via first call');
    return { method: 'call', attempt: 1 };
  }
  
  // Wait 7 seconds before retry
  console.log('\n⏳ Waiting 7 seconds before retry...');
  await new Promise(r => setTimeout(r, 7000));
  
  // Attempt 2: Retry call
  console.log('📞 Attempt 2: Calling again...');
  const call2 = await simpleCall(phone, `Hey ${name}, trying you again. ${message}`);
  
  if (!call2.success) {
    console.log('   Retry failed, sending SMS...');
    await sendSMS(phone, `Tried calling twice - ${message}`);
    return { method: 'sms', reason: 'retry_failed' };
  }
  
  const result2 = await waitForCallResult(call2.sid);
  console.log(`   Result: ${result2.status} (${result2.duration}s)`);
  
  if (result2.answered) {
    console.log('✅ Reached via second call');
    return { method: 'call', attempt: 2 };
  }
  
  // Fall back to SMS
  console.log('\n📱 Falling back to SMS...');
  await sendSMS(phone, `Tried calling twice - ${message}`);
  console.log('✅ SMS sent as fallback');
  
  return { method: 'sms', reason: 'no_answer' };
}

// CLI
async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  
  if (!TWILIO_SID || !TWILIO_TOKEN) {
    console.error('Missing Twilio credentials. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.');
    process.exit(1);
  }
  
  switch (cmd) {
    case 'call': {
      // Conversational call via ElevenLabs
      const [, number, name, ...contextParts] = args;
      if (!number || !name) {
        console.log('Usage: node notify.js call <number> <name> "context"');
        process.exit(1);
      }
      const context = contextParts.join(' ') || 'Just checking in.';
      await conversationalCall(formatPhone(number), name, context);
      break;
    }
    
    case 'remind': {
      // Simple TTS reminder via Twilio Polly
      const [, number, name, ...msgParts] = args;
      if (!number || !name) {
        console.log('Usage: node notify.js remind <number> <name> "message"');
        process.exit(1);
      }
      const msg = msgParts.join(' ') || 'This is your reminder.';
      await simpleCall(formatPhone(number), `Hey ${name}, ${msg}`);
      break;
    }
    
    case 'alert': {
      // Full escalation: call → retry → SMS
      const [, number, name, ...msgParts] = args;
      if (!number || !name) {
        console.log('Usage: node notify.js alert <number> <name> "message"');
        process.exit(1);
      }
      const msg = msgParts.join(' ') || 'Please check in when you can.';
      await alertEscalation(number, name, msg);
      break;
    }
    
    case 'sms': {
      // Direct SMS
      const [, number, ...msgParts] = args;
      if (!number) {
        console.log('Usage: node notify.js sms <number> "message"');
        process.exit(1);
      }
      await sendSMS(formatPhone(number), msgParts.join(' '));
      break;
    }
    
    default:
      console.log(`
Smart Notification System

Commands:
  call <number> <name> "context"     Conversational AI call (ElevenLabs)
  remind <number> <name> "message"   Simple TTS call (Twilio Polly)
  alert <number> <name> "message"    Escalation: call → retry → SMS
  sms <number> "message"             Direct SMS

Examples:
  node notify.js remind +61429512420 Jason "You have a meeting in 10 minutes"
  node notify.js alert +61429512420 Jason "Urgent: server is down"
  node notify.js call +61429512420 Jason "Wanted to discuss the project timeline"
`);
  }
}

main().catch(console.error);
