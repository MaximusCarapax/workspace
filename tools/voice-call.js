#!/usr/bin/env node
/**
 * Twilio Voice Call Tool
 * Make outbound calls with text-to-speech messages
 * 
 * Usage:
 *   node voice-call.js call <number> "message to speak"
 *   node voice-call.js call +15551234567 "Hello, this is a test call"
 *   node voice-call.js status <callSid>
 *   node voice-call.js test   # Test credentials
 */

const fs = require('fs');
const path = require('path');
const twilio = require('twilio');

// Load credentials
const CREDS_PATH = path.join(process.env.HOME, '.openclaw/secrets/credentials.json');

function loadCredentials() {
  if (!fs.existsSync(CREDS_PATH)) {
    console.error('❌ Credentials file not found:', CREDS_PATH);
    process.exit(1);
  }
  
  const creds = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8'));
  
  if (!creds.twilio_account_sid || !creds.twilio_auth_token || !creds.twilio_phone_number) {
    console.error('❌ Missing Twilio credentials in credentials.json');
    console.error('Required: twilio_account_sid, twilio_auth_token, twilio_phone_number');
    process.exit(1);
  }
  
  return {
    accountSid: creds.twilio_account_sid,
    authToken: creds.twilio_auth_token,
    phoneNumber: creds.twilio_phone_number
  };
}

function normalizePhoneNumber(number) {
  // Remove all non-digit characters except leading +
  let normalized = number.replace(/[^\d+]/g, '');
  
  // Ensure it starts with +
  if (!normalized.startsWith('+')) {
    // Assume US number if no country code
    if (normalized.length === 10) {
      normalized = '+1' + normalized;
    } else if (normalized.length === 11 && normalized.startsWith('1')) {
      normalized = '+' + normalized;
    } else {
      normalized = '+' + normalized;
    }
  }
  
  return normalized;
}

async function makeCall(toNumber, message, options = {}) {
  const creds = loadCredentials();
  const client = twilio(creds.accountSid, creds.authToken);
  
  const to = normalizePhoneNumber(toNumber);
  const from = creds.phoneNumber;
  
  // Build TwiML for the message
  const twiml = new twilio.twiml.VoiceResponse();
  
  // Add customizable voice options
  const voice = options.voice || 'Polly.Joanna';  // AWS Polly voice
  const language = options.language || 'en-US';
  
  twiml.say({ voice, language }, message);
  
  // Optionally pause and repeat
  if (options.repeat) {
    twiml.pause({ length: 2 });
    twiml.say({ voice, language }, message);
  }
  
  console.log(`📞 Calling ${to} from ${from}...`);
  console.log(`📝 Message: "${message}"`);
  
  try {
    const call = await client.calls.create({
      twiml: twiml.toString(),
      to: to,
      from: from,
      statusCallback: options.statusCallback || undefined,
      statusCallbackEvent: options.statusCallback ? ['initiated', 'ringing', 'answered', 'completed'] : undefined
    });
    
    console.log(`✅ Call initiated!`);
    console.log(`   SID: ${call.sid}`);
    console.log(`   Status: ${call.status}`);
    
    return call;
  } catch (error) {
    console.error(`❌ Call failed: ${error.message}`);
    if (error.code) {
      console.error(`   Error code: ${error.code}`);
    }
    throw error;
  }
}

async function getCallStatus(callSid) {
  const creds = loadCredentials();
  const client = twilio(creds.accountSid, creds.authToken);
  
  try {
    const call = await client.calls(callSid).fetch();
    
    console.log(`📞 Call Status: ${callSid}`);
    console.log(`   To: ${call.to}`);
    console.log(`   From: ${call.from}`);
    console.log(`   Status: ${call.status}`);
    console.log(`   Duration: ${call.duration || 0}s`);
    console.log(`   Direction: ${call.direction}`);
    console.log(`   Started: ${call.startTime || 'N/A'}`);
    console.log(`   Ended: ${call.endTime || 'N/A'}`);
    
    return call;
  } catch (error) {
    console.error(`❌ Failed to get call status: ${error.message}`);
    throw error;
  }
}

async function testCredentials() {
  const creds = loadCredentials();
  const client = twilio(creds.accountSid, creds.authToken);
  
  console.log('🔍 Testing Twilio credentials...');
  
  try {
    const account = await client.api.accounts(creds.accountSid).fetch();
    
    console.log(`✅ Credentials valid!`);
    console.log(`   Account: ${account.friendlyName}`);
    console.log(`   Status: ${account.status}`);
    console.log(`   Phone: ${creds.phoneNumber}`);
    
    // Get account balance
    const balance = await client.balance.fetch();
    console.log(`   Balance: ${balance.currency} ${balance.balance}`);
    
    return true;
  } catch (error) {
    console.error(`❌ Credentials test failed: ${error.message}`);
    return false;
  }
}

function showHelp() {
  console.log(`
Twilio Voice Call Tool
======================

Usage:
  node voice-call.js call <number> "message"  Make an outbound call
  node voice-call.js status <callSid>         Check call status
  node voice-call.js test                     Test credentials
  node voice-call.js help                     Show this help

Options for 'call':
  --voice <voice>      TTS voice (default: Polly.Joanna)
  --language <lang>    Language code (default: en-US)
  --repeat             Repeat the message twice

Examples:
  node voice-call.js call +15551234567 "Hello, this is a test"
  node voice-call.js call 555-123-4567 "Your order is ready" --voice Polly.Matthew
  node voice-call.js status CA1234567890abcdef

Available Polly Voices:
  Polly.Joanna (female, US)    Polly.Matthew (male, US)
  Polly.Amy (female, UK)       Polly.Brian (male, UK)
  Polly.Emma (female, UK)      Polly.Joey (male, US)
`);
}

// CLI
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  if (!command || command === 'help' || command === '--help') {
    showHelp();
    return;
  }
  
  switch (command) {
    case 'call': {
      const toNumber = args[1];
      const message = args[2];
      
      if (!toNumber || !message) {
        console.error('❌ Usage: node voice-call.js call <number> "message"');
        process.exit(1);
      }
      
      // Parse options
      const options = {};
      for (let i = 3; i < args.length; i++) {
        if (args[i] === '--voice' && args[i + 1]) {
          options.voice = args[++i];
        } else if (args[i] === '--language' && args[i + 1]) {
          options.language = args[++i];
        } else if (args[i] === '--repeat') {
          options.repeat = true;
        }
      }
      
      await makeCall(toNumber, message, options);
      break;
    }
    
    case 'status': {
      const callSid = args[1];
      if (!callSid) {
        console.error('❌ Usage: node voice-call.js status <callSid>');
        process.exit(1);
      }
      await getCallStatus(callSid);
      break;
    }
    
    case 'test':
      await testCredentials();
      break;
    
    default:
      console.error(`❌ Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
}

// Export for use as module
module.exports = { makeCall, getCallStatus, testCredentials, loadCredentials };

// Run CLI
if (require.main === module) {
  main().catch(err => {
    console.error('Fatal error:', err.message);
    process.exit(1);
  });
}
