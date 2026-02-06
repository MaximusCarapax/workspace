#!/usr/bin/env node
/**
 * Send Observation Digest
 * 
 * Gets pending observations (no feedback yet) and sends them to Telegram
 * with inline feedback buttons.
 * 
 * Usage:
 *   node tools/send-observation-digest.js              # Send digest to default channel
 *   node tools/send-observation-digest.js --target ID  # Send to specific chat
 *   node tools/send-observation-digest.js --dry-run    # Preview without sending
 *   node tools/send-observation-digest.js --all        # Include all observations, not just pending
 * 
 * Integration:
 *   Can be run after weekly-self-observation.js completes, or manually.
 *   Callback data from buttons: "obs_feedback:<id>:<useful|not_useful>"
 */

const path = require('path');
const { execSync } = require('child_process');
const db = require('../lib/db');

// ============================================================
// HELPERS
// ============================================================

/**
 * Get the Monday of the current week
 */
function getCurrentWeekStart() {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Monday is day 1
  const monday = new Date(now);
  monday.setDate(now.getDate() - diff);
  return monday.toISOString().split('T')[0];
}

/**
 * Get pending observations for the current/recent weeks
 */
function getPendingObservations(options = {}) {
  const filters = {
    limit: options.limit || 10
  };
  
  // Only filter to pending if not showing all
  if (!options.all) {
    filters.feedback = 'pending';
  }
  
  return db.getObservations(filters);
}

/**
 * Format a single observation for Telegram
 */
function formatObservation(obs) {
  const categoryEmoji = {
    task_preference: '🎯',
    communication: '💬',
    decision: '🤔',
    error: '⚠️',
    other: '📌'
  };
  
  const emoji = categoryEmoji[obs.category] || '📌';
  const confidence = Math.round(obs.confidence * 100);
  
  let text = `${emoji} *${obs.category.replace('_', ' ').toUpperCase()}* (${confidence}% confidence)\n`;
  text += obs.observation;
  
  // Add feedback status if already rated
  if (obs.feedback) {
    const feedbackEmoji = obs.feedback === 'useful' ? '✅' : '❌';
    text += `\n\n_Feedback: ${feedbackEmoji} ${obs.feedback}_`;
  }
  
  return text;
}

/**
 * Build inline keyboard buttons for an observation
 */
function buildButtons(obsId) {
  return [
    [
      {
        text: '👍 Useful',
        callback_data: `obs_feedback:${obsId}:useful`
      },
      {
        text: '👎 Not Useful', 
        callback_data: `obs_feedback:${obsId}:not_useful`
      }
    ]
  ];
}

/**
 * Send message via OpenClaw message tool
 */
function sendMessage(target, text, buttons = null, dryRun = false) {
  if (dryRun) {
    console.log('\n📤 Would send to:', target);
    console.log('Message:', text.substring(0, 200) + (text.length > 200 ? '...' : ''));
    if (buttons) {
      console.log('Buttons:', JSON.stringify(buttons, null, 2));
    }
    return { success: true, dryRun: true };
  }
  
  // Build command - use openclaw CLI or write to temp file for complex params
  const tempFile = `/tmp/obs-msg-${Date.now()}.json`;
  const msgPayload = {
    action: 'send',
    target,
    message: text,
    buttons
  };
  
  require('fs').writeFileSync(tempFile, JSON.stringify(msgPayload));
  
  try {
    // Use the message tool via API call 
    // Since we can't directly invoke the tool, we'll use a different approach
    // Store the message details for the main agent to send
    console.log(`\n✅ Message prepared for target: ${target}`);
    console.log(`   Text length: ${text.length} chars`);
    console.log(`   Has buttons: ${buttons ? 'yes' : 'no'}`);
    
    // Return the payload for the caller to handle
    return {
      success: true,
      payload: msgPayload
    };
  } finally {
    // Clean up temp file
    try {
      require('fs').unlinkSync(tempFile);
    } catch (e) {}
  }
}

/**
 * Format the full digest message
 */
function formatDigest(observations) {
  if (observations.length === 0) {
    return {
      text: '📊 *Self-Observation Digest*\n\nNo pending observations to review.',
      buttons: null
    };
  }
  
  let text = '📊 *Self-Observation Digest*\n';
  text += `_${observations.length} observation(s) pending feedback_\n`;
  text += '─'.repeat(20) + '\n\n';
  
  // For Telegram, we'll send each observation as a separate message with its own buttons
  // Return an array of message objects
  const messages = observations.map((obs, idx) => ({
    text: formatObservation(obs),
    buttons: obs.feedback ? null : buildButtons(obs.id),
    obsId: obs.id
  }));
  
  return { messages, summary: text };
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const showAll = args.includes('--all');
  
  // Parse target
  let target = null;
  const targetIdx = args.indexOf('--target');
  if (targetIdx !== -1 && args[targetIdx + 1]) {
    target = args[targetIdx + 1];
  }
  
  console.log('='.repeat(50));
  console.log('Self-Observation Digest');
  console.log('='.repeat(50));
  
  // Get observations
  console.log('\n📋 Fetching observations...');
  const observations = getPendingObservations({ all: showAll });
  console.log(`   Found ${observations.length} observation(s)`);
  
  if (observations.length === 0) {
    console.log('\n✨ No pending observations to send.');
    return;
  }
  
  // Format digest
  const digest = formatDigest(observations);
  
  if (dryRun) {
    console.log('\n' + '─'.repeat(50));
    console.log('DRY RUN - Messages that would be sent:');
    console.log('─'.repeat(50));
    
    console.log('\n📝 Summary:', digest.summary);
    
    for (const msg of digest.messages) {
      console.log('\n--- Observation #' + msg.obsId + ' ---');
      console.log(msg.text);
      if (msg.buttons) {
        console.log('Buttons:', JSON.stringify(msg.buttons));
      }
    }
    
    console.log('\n✅ Dry run complete. Use without --dry-run to send.');
    return;
  }
  
  // Output JSON for the main agent/cron to process
  const output = {
    success: true,
    observations: observations.length,
    messages: digest.messages.map(m => ({
      text: m.text,
      buttons: m.buttons,
      obsId: m.obsId
    }))
  };
  
  console.log('\n📤 Digest ready for sending:');
  console.log(JSON.stringify(output, null, 2));
  
  // Return the data for programmatic use
  return output;
}

// Run if called directly
if (require.main === module) {
  main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}

module.exports = { getPendingObservations, formatDigest, formatObservation, buildButtons };
