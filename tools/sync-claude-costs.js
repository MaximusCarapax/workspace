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

async function processSessionFile(filePath, state) {
  const fileName = path.basename(filePath);
  const processedIds = state.processedMessages[fileName] || [];
  const newIds = [];
  let totalCost = 0;
  let messageCount = 0;

  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
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
        
        // Log to SQLite with original timestamp
        const timestamp = entry.timestamp || new Date().toISOString();
        db.db.prepare(`
          INSERT INTO token_usage (session_id, model, provider, tokens_in, tokens_out, cost_usd, task_type, task_detail, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          fileName.replace('.jsonl', ''),
          msg.model || 'claude-opus-4-5',
          msg.provider || 'anthropic',
          usage.input || 0,
          usage.output || 0,
          cost,
          'conversation',
          'main session',
          timestamp
        );
        
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
  
  return { messageCount, totalCost };
}

async function main() {
  const state = loadState();
  let totalMessages = 0;
  let totalCost = 0;

  // Get all session files
  const files = fs.readdirSync(SESSIONS_DIR)
    .filter(f => f.endsWith('.jsonl') && !f.includes('.deleted'))
    .map(f => path.join(SESSIONS_DIR, f));

  console.log(`📊 Syncing Claude costs from ${files.length} session files...\n`);

  for (const file of files) {
    const result = await processSessionFile(file, state);
    if (result.messageCount > 0) {
      console.log(`  ${path.basename(file)}: ${result.messageCount} messages, $${result.totalCost.toFixed(4)}`);
      totalMessages += result.messageCount;
      totalCost += result.totalCost;
    }
  }

  // Save state
  state.lastSync = new Date().toISOString();
  saveState(state);

  console.log(`\n✅ Synced ${totalMessages} new messages, $${totalCost.toFixed(4)} total`);
  
  // Show updated costs
  const today = db.getCostsToday();
  console.log(`\n💰 Today's Total: $${(today.total || 0).toFixed(4)}`);
}

main().catch(console.error);
