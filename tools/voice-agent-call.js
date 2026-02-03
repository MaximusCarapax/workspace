#!/usr/bin/env node
/**
 * ElevenLabs Voice Agent - Outbound Call Tool
 * 
 * Usage:
 *   node voice-agent-call.js <phone_number> <caller_name> [context]
 *   node voice-agent-call.js --no-watch <phone_number> <caller_name> [context]
 *   node voice-agent-call.js list [limit]
 *   node voice-agent-call.js transcript <conversation_id>
 *   node voice-agent-call.js report <conversation_id>
 * 
 * By default, waits for call to complete and posts full report.
 * Use --no-watch to just initiate and return immediately.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Load API key from multiple sources
let API_KEY = process.env.ELEVENLABS_API_KEY;
if (!API_KEY) {
  try {
    const envPath = path.join(process.env.HOME, '.openclaw/workspace/.env');
    const env = fs.readFileSync(envPath, 'utf8');
    const match = env.match(/ELEVENLABS_API_KEY=(.+)/);
    if (match) API_KEY = match[1].trim();
  } catch (e) {}
}

const AGENT_ID = 'agent_5101kghqpcgsfpfs9r4s1q43thza';
const PHONE_NUMBER_ID = 'phnum_4801kghqr4hmexb9xj527acefsvn';

// API helpers
function apiRequest(method, apiPath, data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.elevenlabs.io',
      port: 443,
      path: apiPath,
      method,
      headers: { 'xi-api-key': API_KEY }
    };
    
    if (data) {
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(data);
    }

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`Failed to parse: ${body}`));
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function makeCall(toNumber, callerName, context = '') {
  const payload = {
    agent_id: AGENT_ID,
    agent_phone_number_id: PHONE_NUMBER_ID,
    to_number: toNumber,
    conversation_initiation_client_data: {
      dynamic_variables: {
        caller_name: callerName,
        call_context: context || 'How can I help you today?'
      }
    }
  };
  return apiRequest('POST', '/v1/convai/twilio/outbound-call', JSON.stringify(payload));
}

async function getConversation(conversationId) {
  return apiRequest('GET', `/v1/convai/conversations/${conversationId}`);
}

async function listCalls(limit = 5) {
  return apiRequest('GET', `/v1/convai/conversations?agent_id=${AGENT_ID}&limit=${limit}`);
}

// Format helpers
function formatDuration(seconds) {
  if (!seconds) return 'N/A';
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function generateReport(conv) {
  const phone = conv.phone_call || {};
  const metadata = conv.metadata || {};
  const transcript = conv.transcript || [];
  
  let transcriptText = '';
  if (transcript.length > 0) {
    transcriptText = transcript.map(t => {
      const role = t.role === 'agent' ? '🤖 Agent' : '👤 User';
      return `${role}: ${t.message}`;
    }).join('\n');
  } else {
    transcriptText = '(No transcript - call may not have connected)';
  }
  
  let outcome = 'Unknown';
  const termReason = conv.termination_reason || metadata.termination_reason || '';
  if (transcript.length === 0) {
    outcome = 'No answer / Failed';
  } else if (termReason.toLowerCase().includes('hangup') || termReason.toLowerCase().includes('user') || termReason.toLowerCase().includes('remote')) {
    outcome = 'User hung up';
  } else if (termReason.toLowerCase().includes('agent')) {
    outcome = 'Agent ended';
  } else {
    outcome = 'Completed';
  }
  
  // Check for voicemail
  const firstUserMsg = transcript.find(t => t.role === 'user')?.message || '';
  if (firstUserMsg.toLowerCase().includes('voicemail') || 
      firstUserMsg.toLowerCase().includes('not available') ||
      firstUserMsg.toLowerCase().includes('leave a message') ||
      firstUserMsg.toLowerCase().includes('record your message')) {
    outcome = 'Voicemail';
  }
  
  return {
    conversationId: conv.conversation_id,
    status: conv.status,
    outcome,
    duration: formatDuration(metadata.call_duration_secs),
    from: phone.agent_number || '+18209004002',
    to: phone.external_number || 'N/A',
    startTime: metadata.start_time_unix_secs 
      ? new Date(metadata.start_time_unix_secs * 1000).toISOString()
      : 'N/A',
    messageCount: transcript.length,
    transcript: transcriptText,
    terminationReason: termReason || 'N/A',
    summary: conv.analysis?.transcript_summary || null
  };
}

function formatReportText(report) {
  let text = `
📞 **Voice Call Report**
━━━━━━━━━━━━━━━━━━━━━━

**Call Details:**
• Outcome: **${report.outcome}**
• Duration: ${report.duration}
• To: ${report.to}
• Time: ${report.startTime}
• ID: \`${report.conversationId}\`

**Transcript:**
${report.transcript}
`;

  if (report.summary) {
    text += `\n**Summary:** ${report.summary}`;
  }
  
  text += `\n━━━━━━━━━━━━━━━━━━━━━━`;
  return text.trim();
}

// Watch for call completion
async function watchCall(conversationId, maxWaitMs = 300000) {
  const startTime = Date.now();
  const pollInterval = 5000;
  
  while (Date.now() - startTime < maxWaitMs) {
    try {
      const conv = await getConversation(conversationId);
      
      if (conv.status === 'done' || conv.status === 'failed' || conv.status === 'ended') {
        return conv;
      }
      
      process.stdout.write('.');
      await new Promise(r => setTimeout(r, pollInterval));
    } catch (e) {
      await new Promise(r => setTimeout(r, pollInterval));
    }
  }
  
  // Timeout - get whatever we have
  return await getConversation(conversationId);
}

// CLI
async function main() {
  const args = process.argv.slice(2);
  
  if (!API_KEY) {
    console.error('Error: ELEVENLABS_API_KEY not found');
    console.error('Set it in ~/.openclaw/workspace/.env or as environment variable');
    process.exit(1);
  }
  
  // Handle --no-watch flag
  let watch = true;
  const filteredArgs = args.filter(a => {
    if (a === '--no-watch') { watch = false; return false; }
    return true;
  });
  
  const command = filteredArgs[0];
  
  // List calls
  if (command === 'list') {
    const result = await listCalls(filteredArgs[1] || 5);
    console.log('\n📞 Recent Calls:\n');
    for (const c of result.conversations || []) {
      const time = new Date(c.start_time_unix_secs * 1000).toLocaleString();
      console.log(`  ${c.conversation_id}`);
      console.log(`    Status: ${c.status} | Duration: ${c.call_duration_secs}s | Messages: ${c.message_count}`);
      console.log(`    Time: ${time}\n`);
    }
    return;
  }
  
  // Get transcript
  if (command === 'transcript') {
    if (!filteredArgs[1]) {
      console.error('Usage: node voice-agent-call.js transcript <conversation_id>');
      process.exit(1);
    }
    const conv = await getConversation(filteredArgs[1]);
    console.log('\n📝 Transcript:\n');
    for (const msg of conv.transcript || []) {
      const role = msg.role === 'agent' ? '🤖 Agent' : '👤 User';
      console.log(`${role}: ${msg.message}\n`);
    }
    return;
  }
  
  // Get full report
  if (command === 'report') {
    if (!filteredArgs[1]) {
      console.error('Usage: node voice-agent-call.js report <conversation_id>');
      process.exit(1);
    }
    const conv = await getConversation(filteredArgs[1]);
    const report = generateReport(conv);
    console.log(formatReportText(report));
    return;
  }
  
  // Make a call
  if (filteredArgs.length < 2) {
    console.log(`
ElevenLabs Voice Agent - Outbound Calls

Usage:
  node voice-agent-call.js <phone_number> <caller_name> [context]
  node voice-agent-call.js --no-watch <phone_number> <caller_name> [context]
  node voice-agent-call.js list [limit]
  node voice-agent-call.js transcript <conversation_id>
  node voice-agent-call.js report <conversation_id>

Options:
  --no-watch    Don't wait for call to complete (just initiate)

Examples:
  node voice-agent-call.js +61429512420 "Jason" "Just checking in"
  node voice-agent-call.js --no-watch +61478079770 "Kevin" "Prank call"
`);
    process.exit(1);
  }

  const [phoneNumber, callerName, ...contextParts] = filteredArgs;
  const context = contextParts.join(' ');

  console.log(`\n📞 Calling ${callerName} at ${phoneNumber}...`);
  if (context) console.log(`   Context: ${context}`);
  
  try {
    const result = await makeCall(phoneNumber, callerName, context);
    
    if (result.conversation_id) {
      console.log(`✅ Call initiated! (ID: ${result.conversation_id})`);
      
      if (watch) {
        console.log(`\n⏳ Waiting for call to complete`);
        const conv = await watchCall(result.conversation_id);
        console.log('\n');
        const report = generateReport(conv);
        console.log(formatReportText(report));
      } else {
        console.log(`\nTo see report later: node voice-agent-call.js report ${result.conversation_id}`);
      }
    } else {
      console.error('\n❌ Call failed:', result);
    }
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    process.exit(1);
  }
}

main();
