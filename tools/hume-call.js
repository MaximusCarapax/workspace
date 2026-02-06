#!/usr/bin/env node
/**
 * Hume EVI Outbound Calling with Automatic Transcript Retrieval
 * 
 * Makes outbound calls using Twilio AU number with Hume EVI handling the conversation.
 * After call completes, automatically fetches transcript from Hume and indexes to RAG.
 * 
 * Now supports context injection via the bridge server - the agent knows who it's calling
 * and why, preventing awkward "who is this?" moments.
 * 
 * Usage:
 *   node tools/hume-call.js <number> [name] [purpose]
 *   node tools/hume-call.js +61429512420 "Kevin" "Check if coming over tomorrow"
 *   node tools/hume-call.js status <callSid>
 *   node tools/hume-call.js transcript <chat_id>
 */

require('dotenv').config();
const creds = require('../lib/credentials');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const CallContextBuilder = require('./call-context');

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
const humeConfigId = 'cc7579f9-a0a1-4dd0-bacc-62971d333de4'; // max-gemini-25 (Gemini 2.5 Flash - smarter, natural conversation)

if (!accountSid || !authToken) {
  console.error('❌ Missing Twilio AU credentials (twilio_au_account_sid, twilio_au_auth_token)');
  process.exit(1);
}

if (!humeApiKey) {
  console.error('❌ Missing Hume API key (hume_api_key)');
  process.exit(1);
}

const twilio = require('twilio')(accountSid, authToken);

// Bridge server URL (local or configured)
const BRIDGE_URL = process.env.HUME_BRIDGE_URL || 'http://localhost:3000';

/**
 * Check if the bridge server is running
 */
async function checkBridge() {
  try {
    const response = await fetch(`${BRIDGE_URL}/health`, { 
      timeout: 2000,
      signal: AbortSignal.timeout(2000)
    });
    if (response.ok) {
      const data = await response.json();
      console.log(`✅ Bridge server is running (${data.activeSessions || 0} active sessions)`);
      return true;
    }
    return false;
  } catch (err) {
    console.log(`⚠️  Bridge server not available at ${BRIDGE_URL}`);
    return false;
  }
}

/**
 * Build rich context for the call using CallContextBuilder
 */
async function buildCallContext(toNumber, name, purpose) {
  try {
    console.log(`📋 Building call context for ${name || toNumber}...`);
    const builder = new CallContextBuilder();
    const context = await builder.buildContext(toNumber, { name, purpose });
    
    return {
      name: context.contact?.name || name || 'there',
      purpose: purpose || context.call_purpose || 'general check-in',
      relationship: context.contact?.relationship || null,
      topics: context.suggested_topics || [],
      history: context.history || []
    };
  } catch (err) {
    console.log(`⚠️  Could not build rich context: ${err.message}`);
    return {
      name: name || 'there',
      purpose: purpose || 'general check-in',
      relationship: null,
      topics: [],
      history: []
    };
  }
}

/**
 * Update Hume config prompt with call-specific context (no bridge needed)
 */
async function updateHumeConfigForCall(callContext) {
  const { name, purpose, relationship, topics, history } = callContext;
  
  let contextBlock = `CURRENT CALL:\n- You are calling: ${name}`;
  if (relationship) contextBlock += ` (${relationship})`;
  contextBlock += `\n- Purpose: ${purpose}`;
  if (topics.length > 0) contextBlock += `\n- Topics to cover: ${topics.join(', ')}`;
  if (history.length > 0) {
    contextBlock += `\n- Recent history: ${history.map(h => h.summary || h).join('; ')}`;
  }

  const prompt = `You are Maximus, an AI assistant who works for Jason Wu. You are making an outbound phone call RIGHT NOW.

${contextBlock}

<voice_style>
Speak at a brisk, energetic pace — about 1.5x normal speed. You are confident and quick. Do not drag words out or speak slowly. Keep sentences short and punchy.
</voice_style>

<voice_only_response_format>
Format all responses as spoken words for a voice-only conversation. All output is spoken aloud, so avoid any text-specific formatting or anything that is not normally spoken.
</voice_only_response_format>

OPENING SEQUENCE (follow this EXACTLY):
1. Say ONLY the person's first name with a slight question tone, like you are confirming identity. Example: "${name}?"
2. STOP and WAIT for them to respond.
3. After they respond, say: "It's Maximus AI, Jason's agent — you going well?"
4. WAIT for their response, then proceed to the purpose of the call.

PERSONALITY:
- Confident, direct, quick-talking
- You are a real person having a real conversation — NOT a robotic assistant
- Respond directly to what people say. If someone asks you a question, ANSWER IT.
- Keep it casual and warm

CRITICAL RULES:
1. NEVER paraphrase what someone just said back to them — just respond naturally
2. If someone asks YOU a question, answer it directly. Do not redirect it to Jason.
3. You ARE Maximus. Own it. You are not a middleman — you are having a conversation.
4. Keep calls short and efficient. Get the info, confirm once, wrap up.
5. If you do not know something, say so: I am not sure, I would have to check with Jason

AFTER THE OPENING:
- State the purpose clearly
- Have a natural back-and-forth conversation
- When you have what you need, confirm once and end: Sweet, I will let Jason know. Talk soon!

IF VOICEMAIL: "Hey ${name}, it is Maximus, Jason's AI agent. ${purpose}. Give Jason a call or text when you get this. Cheers!"

Remember: You are having a conversation, not conducting an interview. Be quick, be human.`;

  console.log(`🔧 Updating Hume config with context for ${name}...`);
  
  const response = await fetch(`https://api.hume.ai/v0/evi/configs/${humeConfigId}`, {
    method: 'POST',
    headers: {
      'X-Hume-Api-Key': humeApiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      version_description: `Call: ${name} - ${purpose}`.substring(0, 100),
      prompt: { text: prompt },
      voice: { provider: 'HUME_AI', name: 'Ito' },
      language_model: {
        model_provider: 'GOOGLE',
        model_resource: 'gemini-2.5-flash',
        temperature: 1.0
      },
      builtin_tools: [{ tool_type: 'BUILTIN', name: 'hang_up', fallback_content: 'Goodbye!' }]
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to update Hume config: ${response.status} ${err}`);
  }

  const data = await response.json();
  console.log(`✅ Config updated (version ${data.version}) — Max knows he's calling ${name} about: ${purpose}`);
  return data;
}

/**
 * Make call via bridge server (with context injection)
 */
async function makeCallViaBridge(toNumber, name, purpose, callContext) {
  console.log(`📞 Making call via bridge with context injection...`);
  
  const response = await fetch(`${BRIDGE_URL}/call/outbound`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: toNumber,
      name: callContext.name,
      purpose: callContext.purpose,
      relationship: callContext.relationship,
      topics: callContext.topics,
      history: callContext.history
    })
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(`Bridge call failed: ${error.error || response.statusText}`);
  }
  
  const result = await response.json();
  console.log(`✅ Call initiated via bridge!`);
  console.log(`   SID: ${result.callSid}`);
  console.log(`   Context: Calling ${callContext.name} for "${callContext.purpose}"`);
  
  return {
    sid: result.callSid,
    status: result.status
  };
}

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
    return data.chats_page || data.chats || [];
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
    // Use single-chat endpoint which returns events_page inline
    const response = await fetch(`https://api.hume.ai/v0/evi/chats/${chatId}`, {
      headers: {
        'X-Hume-Api-Key': humeApiKey
      }
    });
    
    if (!response.ok) {
      throw new Error(`Hume API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    return data.events_page || data.events || [];
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
async function makeCallWithTranscript(toNumber, name = 'there', purpose = null) {
  try {
    console.log(`📞 Making call with auto-transcript to ${name} at ${toNumber}...`);
    if (purpose) {
      console.log(`   Purpose: ${purpose}`);
    }
    
    // Build rich context
    const callContext = await buildCallContext(toNumber, name, purpose);
    
    // Always inject context by updating the Hume config before calling
    await updateHumeConfigForCall(callContext);
    
    // Check if bridge is available (optional, for advanced features)
    const bridgeAvailable = await checkBridge();
    
    let call;
    if (bridgeAvailable) {
      // Use bridge if available (supports real-time features)
      call = await makeCallViaBridge(toNumber, name, purpose, callContext);
    } else {
      // Direct Hume webhook — context already injected via config update
      call = await makeCall(toNumber, name);
    }
    
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
  node tools/hume-call.js <number> [name] [purpose]   Make a call with context + auto-transcript
  node tools/hume-call.js status <callSid>            Check call status
  node tools/hume-call.js transcript <chat_id>        Fetch transcript by chat ID
  node tools/hume-call.js process <call_sid>          Process transcript for completed call
  
Examples:
  node tools/hume-call.js +61429512420 "Kevin" "Check if coming over tomorrow"
  node tools/hume-call.js +61412345678 "Diana" "Birthday wishes"
  node tools/hume-call.js status CA1234567890abcdef
  node tools/hume-call.js transcript 470a49f6-1dec-4afe-8b61-035d3b2d63b0
  
Notes:
  - Uses AU Twilio number: ${twilioNumber}
  - Hume EVI handles the conversation (Gemini 2.5 Flash + Ito voice)
  - Context injection is AUTOMATIC — Max always knows who he's calling and why
  - Auto-fetches transcript and indexes to RAG after call completes
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
    const purpose = args[2] || null;
    
    if (!toNumber.startsWith('+')) {
      console.error('❌ Phone number must be in E.164 format (e.g., +61429512420)');
      process.exit(1);
    }
    
    // Use enhanced call function with auto-transcript
    await makeCallWithTranscript(toNumber, name, purpose);
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
