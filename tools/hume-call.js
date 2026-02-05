#!/usr/bin/env node
/**
 * Hume EVI Outbound Calling
 * 
 * Makes outbound calls using Twilio AU number with Hume EVI handling the conversation.
 * 
 * Usage:
 *   node tools/hume-call.js <number> [name]
 *   node tools/hume-call.js +61429512420 "Jason"
 *   node tools/hume-call.js status <callSid>
 */

require('dotenv').config();
const creds = require('../lib/credentials');

// Twilio AU credentials
const accountSid = creds.get('twilio_au_account_sid');
const authToken = creds.get('twilio_au_auth_token');
const twilioNumber = creds.get('twilio_au_phone_number') || '+61468089420';

// Hume credentials
const humeApiKey = creds.get('hume_api_key');
const humeConfigId = 'cc7579f9-a0a1-4dd0-bacc-62971d333de4'; // max-gemini-25 (Gemini 2.5 Flash)

if (!accountSid || !authToken) {
  console.error('❌ Missing Twilio AU credentials (twilio_au_account_sid, twilio_au_auth_token)');
  process.exit(1);
}

if (!humeApiKey) {
  console.error('❌ Missing Hume API key (hume_api_key)');
  process.exit(1);
}

const twilio = require('twilio')(accountSid, authToken);

async function makeCall(toNumber, name = 'there') {
  const webhookUrl = `https://api.hume.ai/v0/evi/twilio?config_id=${humeConfigId}&api_key=${humeApiKey}`;
  
  console.log(`📞 Calling ${name} at ${toNumber} via Hume EVI...`);
  console.log(`   From: ${twilioNumber}`);
  
  try {
    const call = await twilio.calls.create({
      to: toNumber,
      from: twilioNumber,
      url: webhookUrl,
      statusCallback: null, // Could add callback URL for status updates
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed']
    });
    
    console.log(`✅ Call initiated!`);
    console.log(`   SID: ${call.sid}`);
    console.log(`   Status: ${call.status}`);
    
    return call;
  } catch (err) {
    console.error(`❌ Call failed: ${err.message}`);
    if (err.code) console.error(`   Code: ${err.code}`);
    throw err;
  }
}

async function getCallStatus(callSid) {
  try {
    const call = await twilio.calls(callSid).fetch();
    console.log(`📞 Call ${callSid}:`);
    console.log(`   Status: ${call.status}`);
    console.log(`   Duration: ${call.duration}s`);
    console.log(`   Direction: ${call.direction}`);
    console.log(`   From: ${call.from}`);
    console.log(`   To: ${call.to}`);
    return call;
  } catch (err) {
    console.error(`❌ Failed to fetch call: ${err.message}`);
    throw err;
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
Hume EVI Outbound Calling (AU Number)

Usage:
  node tools/hume-call.js <number> [name]    Make a call
  node tools/hume-call.js status <callSid>   Check call status
  
Examples:
  node tools/hume-call.js +61429512420 "Jason"
  node tools/hume-call.js status CA1234567890abcdef
  
Notes:
  - Uses AU Twilio number: ${twilioNumber}
  - Hume EVI handles the conversation
  - Caller hears Max (Ito voice, Claude 3.5 Sonnet brain)
`);
    return;
  }
  
  if (args[0] === 'status') {
    if (!args[1]) {
      console.error('❌ Please provide a call SID');
      process.exit(1);
    }
    await getCallStatus(args[1]);
  } else {
    const toNumber = args[0];
    const name = args[1] || 'there';
    
    if (!toNumber.startsWith('+')) {
      console.error('❌ Phone number must be in E.164 format (e.g., +61429512420)');
      process.exit(1);
    }
    
    await makeCall(toNumber, name);
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
