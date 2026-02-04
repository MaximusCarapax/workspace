#!/usr/bin/env node
/**
 * Sync Claude costs from OpenClaw session files to SQLite
 * Run periodically to keep cost tracking up to date
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const db = require('../lib/db');

const SESSIONS_DIR = path.join(process.env.HOME, '.openclaw/agents/main/sessions');
const STATE_FILE = path.join(process.env.HOME, '.openclaw/data/cost-sync-state.json');

// Load last sync state
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { lastSync: null, processedMessages: {} };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function detectSessionSource(firstUserMessage, messageCount) {
  if (!firstUserMessage) return 'unknown';
  
  // Rule 5: If session has > 500 messages → probably 'main' (long-running session)
  if (messageCount > 500) {
    return 'main';
  }
  
  // Rule 1: If first user message starts with '[Telegram' or contains 'id:5071818415' → 'main' (Jason's Telegram)
  if (firstUserMessage.startsWith('[Telegram') || firstUserMessage.includes('id:5071818415')) {
    return 'main';
  }
  
  // Rule 2: If first user message is EXACTLY the heartbeat prompt or starts with 'Read HEARTBEAT.md' → 'heartbeat'
  // The exact heartbeat prompt may vary, but we can check for key phrases
  if (firstUserMessage.trim() === 'Read HEARTBEAT.md' || 
      firstUserMessage.startsWith('Read HEARTBEAT.md') ||
      firstUserMessage.includes('HEARTBEAT.md') && 
      (firstUserMessage.includes('Read') || firstUserMessage.includes('read'))) {
    return 'heartbeat';
  }
  
  // Rule 3: If contains 'Night Shift' AND session has < 100 messages → 'cron:night-shift'
  if (firstUserMessage.includes('Night Shift') && messageCount < 100) {
    return 'cron:night-shift';
  }
  
  // Rule 4: If contains 'Morning Briefing' AND session has < 50 messages → 'cron:morning-briefing'
  if ((firstUserMessage.includes('Morning Briefing') || firstUserMessage.includes('morning briefing')) && 
      messageCount < 50) {
    return 'cron:morning-briefing';
  }
  
  // If none of the above rules match, return 'unknown'
  return 'unknown';
}

function determineSource(firstUserMessage) {
  if (!firstUserMessage) return 'unknown';
  
  const message = firstUserMessage.toLowerCase();
  
  if (message.includes('heartbeat.md') || message.includes('heartbeat poll')) {
    return 'heartbeat';
  }
  if (message.includes('night shift') || message.includes('11pm build')) {
    return 'cron:night-shift';
  }
  if (message.includes('morning briefing')) {
    return 'cron:morning-briefing';
  }
  if (message.includes('weekly review')) {
    return 'cron:weekly-review';
  }
  if (message.includes('linkedin') && message.includes('post')) {
    return 'cron:linkedin-post';
  }
  if ((message.includes('x post') || message.includes('tweet')) && 
      (message.includes('cron') || message.includes('schedule'))) {
    return 'cron:x-post';
  }
  
  return 'unknown';
}

async function processSessionFile(filePath, state) {
  const fileName = path.basename(filePath);
  const sessionId = fileName.replace('.jsonl', '');
  const processedIds = state.processedMessages[fileName] || [];
  const newIds = [];
  let totalCost = 0;
  let messageCount = 0;
  let firstTimestamp = null;
  let lastTimestamp = null;
  let firstUserMessage = null;
  let source = null;

  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  // First pass: find the first user message to determine source
  for await (const line of rl) {
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'message' && entry.message?.role === 'user') {
        firstUserMessage = entry.message.content?.[0]?.text || '';
        break;
      }
    } catch (e) {
      // Skip malformed lines
    }
  }

  // Reopen the file for processing to count messages and process usage
  const fileStream2 = fs.createReadStream(filePath);
  const rl2 = readline.createInterface({ input: fileStream2, crlfDelay: Infinity });

  // First, count total messages in the session to help with source detection
  let totalMessageCount = 0;
  for await (const line of rl2) {
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'message') {
        totalMessageCount++;
      }
    } catch (e) {
      // Skip malformed lines
    }
  }

  // Determine source based on first user message and total message count
  source = detectSessionSource(firstUserMessage, totalMessageCount);
  
  // Reopen the file again for actual processing
  const fileStream3 = fs.createReadStream(filePath);
  const rl3 = readline.createInterface({ input: fileStream3, crlfDelay: Infinity });

  for await (const line of rl3) {
    try {
      const entry = JSON.parse(line);
      
      // Skip if not a message or already processed
      if (entry.type !== 'message') continue;
      if (processedIds.includes(entry.id)) continue;
      
      // Extract usage from assistant messages
      const msg = entry.message;
      if (msg?.role === 'assistant' && msg?.usage) {
        const usage = msg.usage;
        const cost = usage.cost?.total || 0;
        const timestamp = entry.timestamp || new Date().toISOString();
        
        // Update timestamps
        if (!firstTimestamp || timestamp < firstTimestamp) {
          firstTimestamp = timestamp;
        }
        if (!lastTimestamp || timestamp > lastTimestamp) {
          lastTimestamp = timestamp;
        }
        
        // Log to SQLite with source
        db.logUsage({
          sessionId: sessionId,
          source: source,
          model: msg.model || 'claude-opus-4-5',
          provider: msg.provider || 'anthropic',
          tokensIn: usage.input || 0,
          tokensOut: usage.output || 0,
          costUsd: cost,
          taskType: 'conversation',
          taskDetail: source === 'heartbeat' ? 'heartbeat session' : 
                     source === 'main' ? 'main session' : 
                     source === 'cron:night-shift' ? 'night shift session' :
                     source === 'cron:morning-briefing' ? 'morning briefing session' :
                     'unknown session',
          latencyMs: null
        });
        
        totalCost += cost;
        messageCount++;
        newIds.push(entry.id);
      }
    } catch (e) {
      // Skip malformed lines
    }
  }

  // Update processed IDs
  state.processedMessages[fileName] = [...processedIds, ...newIds];
  
  // Update session costs if we processed any messages
  if (messageCount > 0) {
    db.updateSessionCost({
      sessionId: sessionId,
      source: source,
      totalCost: totalCost,
      inputTokens: 0, // We'll need to calculate these, but for now, leave as 0
      outputTokens: 0,
      messageCount: messageCount,
      firstTimestamp: firstTimestamp,
      lastTimestamp: lastTimestamp
    });
  }
  
  return { messageCount, totalCost, source };
}

async function main() {
  const state = loadState();
  let totalMessages = 0;
  let totalCost = 0;
  const sourceStats = {};

  // Get all session files
  const files = fs.readdirSync(SESSIONS_DIR)
    .filter(f => f.endsWith('.jsonl') && !f.includes('.deleted'))
    .map(f => path.join(SESSIONS_DIR, f));

  console.log(`📊 Syncing Claude costs from ${files.length} session files...\n`);

  for (const file of files) {
    const result = await processSessionFile(file, state);
    if (result.messageCount > 0) {
      console.log(`  ${path.basename(file)}: ${result.messageCount} messages, $${result.totalCost.toFixed(4)} [${result.source}]`);
      totalMessages += result.messageCount;
      totalCost += result.totalCost;
      
      // Update source statistics
      if (!sourceStats[result.source]) {
        sourceStats[result.source] = { sessions: 0, messages: 0, cost: 0 };
      }
      sourceStats[result.source].sessions += 1;
      sourceStats[result.source].messages += result.messageCount;
      sourceStats[result.source].cost += result.totalCost;
    }
  }

  // Save state
  state.lastSync = new Date().toISOString();
  saveState(state);

  console.log(`\n✅ Synced ${totalMessages} new messages, $${totalCost.toFixed(4)} total`);
  
  // Print summary grouped by source
  console.log(`\n📊 Summary by source:`);
  for (const [source, stats] of Object.entries(sourceStats)) {
    console.log(`  ${source}: ${stats.messages} messages, $${stats.cost.toFixed(4)} total cost`);
  }
  
  // Show costs grouped by source from database
  console.log(`\n📊 Today's Costs by Source (from database):`);
  const todaySources = db.getCostsBySource(1);
  for (const row of todaySources) {
    console.log(`  ${row.source}: $${row.total_cost.toFixed(4)} (${row.session_count} sessions, ${row.message_count} messages)`);
  }
  
  // Show updated costs
  const today = db.getCostsToday();
  console.log(`\n💰 Today's Total: $${(today.total || 0).toFixed(4)}`);
}

main().catch(console.error);
