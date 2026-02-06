#!/usr/bin/env node
/**
 * Hume EVI Outbound Calling with Automatic Transcript Retrieval
 * 
 * Makes outbound calls using Twilio AU number with Hume EVI handling the conversation.
 * After call completes, automatically fetches transcript from Hume and indexes to RAG.
 * 
 * Usage:
 *   node tools/hume-call.js <number> [name]
 *   node tools/hume-call.js +61429512420 "Jason"
 *   node tools/hume-call.js status <callSid>
 *   node tools/hume-call.js transcript <chat_id>
 */

require('dotenv').config();
const creds = require('../lib/credentials');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Fetch polyfill for older Node.js versions
if (!global.fetch) {
  try {
    global.fetch = require('node-fetch');
  } catch (e) {
    console.error('❌ node-fetch not found. Please install it: npm install node-fetch');
    process.exit(1);
  }
}

// Twilio AU credentials
const accountSid = creds.get('twilio_au_account_sid');
const authToken = creds.get('twilio_au_auth_token');
const twilioNumber = creds.get('twilio_au_phone_number') || '+61468089420';

// Hume credentials
const humeApiKey = creds.get('hume_api_key');
const humeConfigId = '9b067366-25ac-4bb0-9511-9203ec787ded'; // max-hume-native (Hume's own LLM - faster, native hang_up)

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

/**
 * Fetch recent chats from Hume API
 */
async function fetchRecentChats(limit = 10) {
  try {
    const response = await fetch(`https://api.hume.ai/v0/evi/chats?page_size=${limit}&ascending_order=false`, {
      headers: {
        'X-Hume-Api-Key': humeApiKey
      }
    });
    
    if (!response.ok) {
      throw new Error(`Hume API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    return data.chats || [];
  } catch (err) {
    console.error('❌ Failed to fetch chats:', err.message);
    throw err;
  }
}

/**
 * Fetch chat events (messages) for a specific chat ID
 */
async function fetchChatEvents(chatId) {
  try {
    const response = await fetch(`https://api.hume.ai/v0/evi/chats/${chatId}/events`, {
      headers: {
        'X-Hume-Api-Key': humeApiKey
      }
    });
    
    if (!response.ok) {
      throw new Error(`Hume API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    return data.events || [];
  } catch (err) {
    console.error(`❌ Failed to fetch chat events for ${chatId}:`, err.message);
    throw err;
  }
}

/**
 * Convert chat events to readable transcript
 */
function eventsToTranscript(events) {
  const messageEvents = events.filter(event => 
    event.type === 'USER_MESSAGE' || event.type === 'AGENT_MESSAGE'
  );
  
  const transcriptLines = messageEvents.map(event => {
    const role = event.role === 'USER' ? 'User' : 'Assistant';
    const timestamp = new Date(event.timestamp).toLocaleTimeString();
    return `[${timestamp}] ${role}: ${event.message_text || event.text || '(no text)'}`;
  });
  
  return transcriptLines.join('\n');
}

/**
 * Find the chat that corresponds to a Twilio call based on timing
 */
async function findChatForCall(call) {
  try {
    console.log('🔍 Looking for corresponding Hume chat...');
    
    const chats = await fetchRecentChats(20);
    if (chats.length === 0) {
      console.log('No recent chats found');
      return null;
    }
    
    // Convert call timestamps
    const callStart = new Date(call.start_time);
    const callEnd = new Date(call.end_time);
    const callDuration = call.duration;
    
    console.log(`Call window: ${callStart.toISOString()} - ${callEnd.toISOString()} (${callDuration}s)`);
    
    // Look for chats that overlap with call timing (within 2 minutes)
    const tolerance = 2 * 60 * 1000; // 2 minutes in milliseconds
    
    for (const chat of chats) {
      const chatStart = new Date(chat.start_timestamp);
      const chatEnd = new Date(chat.end_timestamp);
      
      // Check if chat timing overlaps with call timing
      const timeDiff = Math.abs(chatStart.getTime() - callStart.getTime());
      
      if (timeDiff <= tolerance) {
        console.log(`✅ Found matching chat: ${chat.id}`);
        console.log(`   Chat window: ${chatStart.toISOString()} - ${chatEnd.toISOString()}`);
        console.log(`   Time difference: ${Math.round(timeDiff / 1000)}s`);
        return chat;
      }
    }
    
    console.log('❌ No matching chat found within tolerance window');
    return null;
    
  } catch (err) {
    console.error('❌ Error finding chat:', err.message);
    return null;
  }
}

/**
 * Fetch transcript for a completed call and index it to RAG
 */
async function processCallTranscript(callSid, contactNumber = null, contactName = null) {
  try {
    console.log(`📄 Processing transcript for call ${callSid}...`);
    
    // Get call details
    const call = await getCallStatus(callSid);
    
    if (call.status !== 'completed') {
      console.log(`⚠️  Call status is '${call.status}', not 'completed'`);
      return null;
    }
    
    // Find corresponding Hume chat
    const chat = await findChatForCall(call);
    if (!chat) {
      console.log('❌ Could not find corresponding Hume chat');
      return null;
    }
    
    // Fetch chat events
    console.log(`📥 Fetching events for chat ${chat.id}...`);
    const events = await fetchChatEvents(chat.id);
    
    if (events.length === 0) {
      console.log('❌ No events found in chat');
      return null;
    }
    
    // Convert to transcript
    const transcript = eventsToTranscript(events);
    
    if (!transcript.trim()) {
      console.log('❌ Empty transcript generated');
      return null;
    }
    
    console.log(`📝 Generated transcript (${transcript.length} chars)`);
    
    // Index to RAG using existing tool
    const contact = contactNumber || contactName || call.to;
    const duration = Math.round(call.duration / 60); // Convert to minutes
    
    console.log(`🗂️  Indexing to RAG system...`);
    
    const indexCmd = `node tools/index-call.js --transcript "${transcript.replace(/"/g, '\\"')}" --contact "${contact}" --duration ${duration}`;
    
    try {
      const { stdout, stderr } = await execAsync(indexCmd, {
        maxBuffer: 1024 * 1024 // 1MB buffer
      });
      
      console.log('✅ Successfully indexed call transcript');
      if (stdout) console.log(stdout);
      
      // Extract summary from index-call.js output
      const summaryMatch = stdout.match(/Summary: (.+)/);
      const summary = summaryMatch ? summaryMatch[1] : 'Call completed and indexed';
      
      return {
        chat_id: chat.id,
        call_sid: callSid,
        transcript,
        summary,
        duration: call.duration,
        contact: contact,
        status: 'indexed'
      };
      
    } catch (indexError) {
      console.error('❌ Failed to index transcript:', indexError.message);
      if (indexError.stderr) console.error(indexError.stderr);
      
      // Return transcript even if indexing failed
      return {
        chat_id: chat.id,
        call_sid: callSid,
        transcript,
        summary: 'Transcript retrieved but indexing failed',
        duration: call.duration,
        contact: contact,
        status: 'transcript_only'
      };
    }
    
  } catch (err) {
    console.error('❌ Error processing transcript:', err.message);
    throw err;
  }
}

/**
 * Enhanced call function that waits for completion and fetches transcript
 */
async function makeCallWithTranscript(toNumber, name = 'there') {
  try {
    console.log(`📞 Making call with auto-transcript to ${name} at ${toNumber}...`);
    
    // Make the call
    const call = await makeCall(toNumber, name);
    
    // Wait for call to complete
    console.log('⏳ Waiting for call to complete...');
    
    let completed = false;
    let attempts = 0;
    const maxAttempts = 60; // 5 minutes max wait (5s intervals)
    
    while (!completed && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
      attempts++;
      
      try {
        const updatedCall = await twilio.calls(call.sid).fetch();
        console.log(`   Status: ${updatedCall.status} (${attempts * 5}s elapsed)`);
        
        if (updatedCall.status === 'completed' || updatedCall.status === 'failed' || updatedCall.status === 'canceled') {
          completed = true;
          
          if (updatedCall.status === 'completed') {
            console.log(`✅ Call completed in ${updatedCall.duration}s`);
            
            // Wait a bit more for Hume to process the chat
            console.log('⏳ Waiting for Hume to process chat...');
            await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10s
            
            // Process transcript
            const result = await processCallTranscript(call.sid, toNumber, name);
            
            if (result) {
              console.log('\n=== CALL SUMMARY ===');
              console.log(`Contact: ${result.contact}`);
              console.log(`Duration: ${Math.round(result.duration / 60)} minutes`);
              console.log(`Chat ID: ${result.chat_id}`);
              console.log(`Summary: ${result.summary}`);
              console.log(`Status: ${result.status}`);
              
              return result;
            }
          } else {
            console.log(`❌ Call ended with status: ${updatedCall.status}`);
          }
        }
      } catch (statusErr) {
        console.log(`⚠️  Error checking status: ${statusErr.message}`);
      }
    }
    
    if (!completed) {
      console.log('⚠️  Timeout waiting for call completion');
    }
    
    return null;
    
  } catch (err) {
    console.error('❌ Error in makeCallWithTranscript:', err.message);
    throw err;
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
Hume EVI Outbound Calling with Auto-Transcript (AU Number)

Usage:
  node tools/hume-call.js <number> [name]       Make a call with auto-transcript
  node tools/hume-call.js status <callSid>      Check call status
  node tools/hume-call.js transcript <chat_id>  Fetch transcript by chat ID
  node tools/hume-call.js process <call_sid>    Process transcript for completed call
  
Examples:
  node tools/hume-call.js +61429512420 "Jason"
  node tools/hume-call.js status CA1234567890abcdef
  node tools/hume-call.js transcript 470a49f6-1dec-4afe-8b61-035d3b2d63b0
  node tools/hume-call.js process CA1234567890abcdef
  
Notes:
  - Uses AU Twilio number: ${twilioNumber}
  - Hume EVI handles the conversation  
  - Auto-fetches transcript and indexes to RAG after call completes
  - Caller hears Max (Ito voice, Hume native LLM)
`);
    return;
  }
  
  if (args[0] === 'status') {
    if (!args[1]) {
      console.error('❌ Please provide a call SID');
      process.exit(1);
    }
    await getCallStatus(args[1]);
    
  } else if (args[0] === 'transcript') {
    if (!args[1]) {
      console.error('❌ Please provide a chat ID');
      process.exit(1);
    }
    
    try {
      console.log(`📥 Fetching transcript for chat ${args[1]}...`);
      const events = await fetchChatEvents(args[1]);
      const transcript = eventsToTranscript(events);
      
      if (transcript) {
        console.log('\n=== TRANSCRIPT ===');
        console.log(transcript);
      } else {
        console.log('❌ No transcript found');
      }
    } catch (err) {
      console.error('❌ Failed to fetch transcript:', err.message);
      process.exit(1);
    }
    
  } else if (args[0] === 'process') {
    if (!args[1]) {
      console.error('❌ Please provide a call SID');
      process.exit(1);
    }
    
    try {
      const result = await processCallTranscript(args[1]);
      if (result) {
        console.log('\n=== PROCESSING COMPLETE ===');
        console.log(`Status: ${result.status}`);
        console.log(`Summary: ${result.summary}`);
      } else {
        console.log('❌ Could not process transcript');
      }
    } catch (err) {
      console.error('❌ Failed to process transcript:', err.message);
      process.exit(1);
    }
    
  } else {
    const toNumber = args[0];
    const name = args[1] || 'there';
    
    if (!toNumber.startsWith('+')) {
      console.error('❌ Phone number must be in E.164 format (e.g., +61429512420)');
      process.exit(1);
    }
    
    // Use enhanced call function with auto-transcript
    await makeCallWithTranscript(toNumber, name);
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
