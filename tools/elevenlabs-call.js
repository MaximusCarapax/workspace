#!/usr/bin/env node
/**
 * ElevenLabs Outbound Calling with Dynamic Context
 * 
 * Makes outbound calls using ElevenLabs Conversational AI with Twilio.
 * Context (caller name, purpose) is injected via dynamic variables.
 * Speed: 1.2x, Voice: Roger, LLM: Claude 3.5 Sonnet
 * 
 * Usage:
 *   node tools/elevenlabs-call.js <number> [name] [purpose]
 *   node tools/elevenlabs-call.js +61429512420 "Jason" "Check about dinner tonight"
 *   node tools/elevenlabs-call.js status <conversation_id>
 *   node tools/elevenlabs-call.js transcript <conversation_id>
 *   node tools/elevenlabs-call.js list
 */

require('dotenv').config();
const creds = require('../lib/credentials');

const elevenlabsKey = creds.get('elevenlabs_api_key');
const agentId = 'agent_5101kghqpcgsfpfs9r4s1q43thza';

// Phone number IDs
const PHONE_NUMBERS = {
  au: 'phnum_0501kgrr92kve2n9vzxx2dddmx0j',  // +61 468 089 420
  us: 'phnum_4801kghqr4hmexb9xj527acefsvn'   // +1 820 900 4002
};

if (!elevenlabsKey) {
  console.error('❌ Missing ElevenLabs API key');
  process.exit(1);
}

// Use CallContextBuilder for rich context
let CallContextBuilder;
try {
  CallContextBuilder = require('./call-context');
} catch (e) {
  // Fallback if call-context not available
}

/**
 * Build call context from contacts DB + RAG
 */
async function buildContext(toNumber, name, purpose) {
  if (!CallContextBuilder) {
    return { name: name || 'there', purpose: purpose || 'general check-in' };
  }
  
  try {
    console.log(`📋 Building context for ${name || toNumber}...`);
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
    console.log(`⚠️  Context build failed: ${err.message}`);
    return { name: name || 'there', purpose: purpose || 'general check-in' };
  }
}

/**
 * Determine which phone number to use based on destination
 */
function getPhoneNumberId(toNumber) {
  // Use AU number for AU numbers, US for everything else
  if (toNumber.startsWith('+61')) {
    return PHONE_NUMBERS.au;
  }
  return PHONE_NUMBERS.us;
}

/**
 * Make an outbound call via ElevenLabs
 */
async function makeCall(toNumber, name, purpose) {
  const context = await buildContext(toNumber, name, purpose);
  
  // Build call context string
  let callContext = context.purpose;
  if (context.relationship) callContext += ` (${context.relationship})`;
  if (context.topics?.length) callContext += `. Topics: ${context.topics.join(', ')}`;
  if (context.history?.length) callContext += `. Recent: ${context.history.map(h => h.summary || h).join('; ')}`;
  
  const phoneNumberId = getPhoneNumberId(toNumber);
  const phoneLabel = phoneNumberId === PHONE_NUMBERS.au ? 'AU (+61468089420)' : 'US (+18209004002)';
  
  console.log(`📞 Calling ${context.name} at ${toNumber}...`);
  console.log(`   From: ${phoneLabel}`);
  console.log(`   Purpose: ${context.purpose}`);
  console.log(`   Engine: ElevenLabs (Claude 3.5 Sonnet, Roger voice, 1.2x speed)`);
  
  const response = await fetch('https://api.elevenlabs.io/v1/convai/twilio/outbound-call', {
    method: 'POST',
    headers: {
      'xi-api-key': elevenlabsKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      agent_id: agentId,
      agent_phone_number_id: phoneNumberId,
      to_number: toNumber,
      conversation_initiation_client_data: {
        dynamic_variables: {
          caller_name: context.name,
          call_context: callContext
        }
      }
    })
  });
  
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Call failed (${response.status}): ${err}`);
  }
  
  const data = await response.json();
  console.log(`✅ Call initiated!`);
  console.log(`   Conversation ID: ${data.conversation_id || 'pending'}`);
  console.log(`   Call SID: ${data.callSid || 'pending'}`);
  
  if (data.conversation_id) {
    // Wait for call to complete and fetch transcript
    console.log('⏳ Waiting for call to complete...');
    await waitAndTranscript(data.conversation_id, toNumber, context.name);
  }
  
  return data;
}

/**
 * Wait for call completion and fetch transcript
 */
async function waitAndTranscript(conversationId, toNumber, name) {
  let attempts = 0;
  const maxAttempts = 60; // 5 min
  
  while (attempts < maxAttempts) {
    await new Promise(r => setTimeout(r, 5000));
    attempts++;
    
    try {
      const conv = await getConversation(conversationId, true);
      const status = conv.status || conv.conversation_status;
      console.log(`   Status: ${status} (${attempts * 5}s)`);
      
      if (status === 'done' || status === 'ended' || status === 'failed') {
        if (status !== 'failed') {
          console.log(`✅ Call completed`);
          
          // Extract transcript
          const transcript = conv.transcript || conv.messages || [];
          if (transcript.length > 0) {
            console.log('\n=== TRANSCRIPT ===');
            transcript.forEach(msg => {
              const role = msg.role === 'user' ? (name || 'Caller') : 'Max';
              console.log(`${role}: ${msg.message || msg.text || msg.content || ''}`);
            });
            
            // Index to RAG
            try {
              const { execSync } = require('child_process');
              const transcriptText = transcript.map(msg => {
                const role = msg.role === 'user' ? (name || 'Caller') : 'Max';
                return `${role}: ${msg.message || msg.text || msg.content || ''}`;
              }).join('\n');
              
              const duration = Math.round((conv.duration_seconds || 0) / 60);
              const contact = name || toNumber;
              
              console.log(`\n🗂️  Indexing to RAG...`);
              execSync(`node tools/index-call.js --transcript "${transcriptText.replace(/"/g, '\\"')}" --contact "${contact}" --duration ${duration}`, {
                maxBuffer: 1024 * 1024
              });
              console.log('✅ Indexed to RAG');
            } catch (indexErr) {
              console.log(`⚠️  RAG indexing failed: ${indexErr.message}`);
            }
          }
        } else {
          console.log(`❌ Call failed`);
        }
        return;
      }
    } catch (err) {
      // Conversation might not exist yet
      if (attempts > 3) {
        console.log(`⚠️  Status check error: ${err.message}`);
      }
    }
  }
  
  console.log('⚠️  Timeout waiting for call');
}

/**
 * Get conversation details
 */
async function getConversation(conversationId, quiet = false) {
  const response = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${conversationId}`, {
    headers: { 'xi-api-key': elevenlabsKey }
  });
  
  if (!response.ok) {
    throw new Error(`Failed to get conversation: ${response.status}`);
  }
  
  const data = await response.json();
  
  if (!quiet) {
    console.log(`📞 Conversation ${conversationId}:`);
    console.log(`   Status: ${data.status || data.conversation_status}`);
    console.log(`   Duration: ${data.duration_seconds || 0}s`);
    console.log(`   Agent: ${data.agent_id || agentId}`);
  }
  
  return data;
}

/**
 * Get transcript for a conversation
 */
async function getTranscript(conversationId) {
  const conv = await getConversation(conversationId, true);
  const transcript = conv.transcript || conv.messages || [];
  
  if (transcript.length === 0) {
    console.log('❌ No transcript found');
    return;
  }
  
  console.log('\n=== TRANSCRIPT ===');
  transcript.forEach(msg => {
    const role = msg.role === 'user' ? 'Caller' : 'Max';
    console.log(`${role}: ${msg.message || msg.text || msg.content || ''}`);
  });
}

/**
 * List recent conversations
 */
async function listConversations(limit = 10) {
  const response = await fetch(`https://api.elevenlabs.io/v1/convai/conversations?agent_id=${agentId}&page_size=${limit}`, {
    headers: { 'xi-api-key': elevenlabsKey }
  });
  
  if (!response.ok) {
    throw new Error(`Failed to list conversations: ${response.status}`);
  }
  
  const data = await response.json();
  const convs = data.conversations || [];
  
  console.log(`📞 Recent conversations (${convs.length}):\n`);
  convs.forEach(c => {
    const date = new Date(c.start_time_unix_secs * 1000).toLocaleString();
    console.log(`  ${c.conversation_id}`);
    console.log(`    Status: ${c.status}  Duration: ${c.call_duration_secs || 0}s`);
    console.log(`    Started: ${date}`);
    console.log('');
  });
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
ElevenLabs Outbound Calling (Dynamic Context)

Usage:
  node tools/elevenlabs-call.js <number> [name] [purpose]
  node tools/elevenlabs-call.js status <conversation_id>
  node tools/elevenlabs-call.js transcript <conversation_id>
  node tools/elevenlabs-call.js list

Features:
  - Voice: Roger (1.2x speed)
  - LLM: Claude 3.5 Sonnet
  - Opening: "[Name]?" → pause → "It's Maximus AI, Jason's agent — you going well?"
  - Dynamic context injection (name, purpose, history from RAG)
  - Auto-transcript + RAG indexing after call
  - AU number for AU calls, US number for international
`);
    return;
  }
  
  if (args[0] === 'status') {
    await getConversation(args[1]);
  } else if (args[0] === 'transcript') {
    await getTranscript(args[1]);
  } else if (args[0] === 'list') {
    await listConversations(args[1] ? parseInt(args[1]) : 10);
  } else {
    const toNumber = args[0];
    const name = args[1] || null;
    const purpose = args[2] || null;
    
    if (!toNumber.startsWith('+')) {
      console.error('❌ Phone number must be E.164 format (e.g., +61429512420)');
      process.exit(1);
    }
    
    await makeCall(toNumber, name, purpose);
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
