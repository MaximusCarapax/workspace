#!/usr/bin/env node
/**
 * Voice Call Report Tool
 * Fetches transcript, summary, and metadata for completed calls
 * 
 * Usage:
 *   node voice-call-report.js <conversation_id>
 *   node voice-call-report.js watch <conversation_id>  # Poll until complete, then report
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Load API key
const envPath = path.join(process.env.HOME, '.openclaw/workspace/.env');
let API_KEY = process.env.ELEVENLABS_API_KEY;

if (!API_KEY) {
  try {
    const env = fs.readFileSync(envPath, 'utf8');
    const match = env.match(/ELEVENLABS_API_KEY=(.+)/);
    if (match) API_KEY = match[1].trim();
  } catch (e) {}
}

if (!API_KEY) {
  console.error('Error: ELEVENLABS_API_KEY not found');
  process.exit(1);
}

// Fetch conversation details
async function getConversation(conversationId) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.elevenlabs.io',
      port: 443,
      path: `/v1/convai/conversations/${conversationId}`,
      method: 'GET',
      headers: { 'xi-api-key': API_KEY }
    };

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
    req.end();
  });
}

// Format duration
function formatDuration(seconds) {
  if (!seconds) return 'N/A';
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

// Generate report
function generateReport(conv) {
  const phone = conv.phone_call || {};
  const metadata = conv.metadata || {};
  const transcript = conv.transcript || [];
  
  // Build transcript text
  let transcriptText = '';
  if (transcript.length > 0) {
    transcriptText = transcript.map(t => {
      const role = t.role === 'agent' ? '🤖 Agent' : '👤 User';
      return `${role}: ${t.message}`;
    }).join('\n');
  } else {
    transcriptText = '(No transcript available - call may not have connected)';
  }
  
  // Determine call outcome
  let outcome = 'Unknown';
  const termReason = conv.termination_reason || metadata.termination_reason || '';
  if (termReason.includes('hangup') || termReason.includes('user')) {
    outcome = 'User hung up';
  } else if (termReason.includes('agent')) {
    outcome = 'Agent ended call';
  } else if (termReason.includes('error')) {
    outcome = 'Error';
  } else if (transcript.length === 0) {
    outcome = 'No answer / Voicemail';
  } else {
    outcome = 'Completed';
  }
  
  const report = {
    conversationId: conv.conversation_id,
    status: conv.status,
    outcome,
    duration: formatDuration(metadata.call_duration_secs),
    direction: phone.direction || 'outbound',
    from: phone.agent_number || 'N/A',
    to: phone.external_number || 'N/A',
    startTime: metadata.start_time_unix_secs 
      ? new Date(metadata.start_time_unix_secs * 1000).toISOString()
      : 'N/A',
    transcriptLength: transcript.length,
    transcript: transcriptText,
    terminationReason: termReason || 'N/A',
    cost: metadata.cost_info || null
  };
  
  return report;
}

// Format for display
function formatReport(report) {
  return `
📞 **Voice Call Report**
━━━━━━━━━━━━━━━━━━━━━━

**Call Details:**
• ID: \`${report.conversationId}\`
• Status: ${report.status}
• Outcome: ${report.outcome}
• Duration: ${report.duration}
• From: ${report.from}
• To: ${report.to}
• Time: ${report.startTime}

**Transcript:**
${report.transcript}

**Meta:**
• Termination: ${report.terminationReason}
• Messages: ${report.transcriptLength}
━━━━━━━━━━━━━━━━━━━━━━
`.trim();
}

// Watch and report when complete
async function watchAndReport(conversationId, maxWaitMs = 300000) {
  const startTime = Date.now();
  const pollInterval = 5000; // 5 seconds
  
  console.log(`⏳ Watching call ${conversationId}...`);
  
  while (Date.now() - startTime < maxWaitMs) {
    try {
      const conv = await getConversation(conversationId);
      
      if (conv.status === 'done' || conv.status === 'failed' || conv.status === 'ended') {
        const report = generateReport(conv);
        console.log(formatReport(report));
        return report;
      }
      
      console.log(`   Status: ${conv.status} (waiting...)`);
      await new Promise(r => setTimeout(r, pollInterval));
    } catch (e) {
      console.error(`   Error polling: ${e.message}`);
      await new Promise(r => setTimeout(r, pollInterval));
    }
  }
  
  console.log('⏰ Timeout waiting for call to complete');
  return null;
}

// CLI
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
Voice Call Report Tool

Usage:
  node voice-call-report.js <conversation_id>         Get report for completed call
  node voice-call-report.js watch <conversation_id>   Watch call and report when done
  
Output: Formatted report with transcript, duration, outcome
    `);
    return;
  }
  
  const command = args[0];
  
  if (command === 'watch') {
    const convId = args[1];
    if (!convId) {
      console.error('Usage: node voice-call-report.js watch <conversation_id>');
      process.exit(1);
    }
    const report = await watchAndReport(convId);
    if (report) {
      // Output JSON for programmatic use
      console.log('\n---JSON---');
      console.log(JSON.stringify(report, null, 2));
    }
  } else {
    // Treat first arg as conversation ID
    const convId = command;
    try {
      const conv = await getConversation(convId);
      const report = generateReport(conv);
      console.log(formatReport(report));
      console.log('\n---JSON---');
      console.log(JSON.stringify(report, null, 2));
    } catch (e) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
  }
}

main().catch(console.error);
