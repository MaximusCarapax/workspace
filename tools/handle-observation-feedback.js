#!/usr/bin/env node
/**
 * Handle Observation Feedback
 * 
 * Parses callback_data from Telegram inline buttons and updates
 * observation feedback in the database.
 * 
 * Usage:
 *   node tools/handle-observation-feedback.js "obs_feedback:123:useful"
 *   node tools/handle-observation-feedback.js parse "obs_feedback:123:not_useful"
 *   node tools/handle-observation-feedback.js update 123 useful ["Optional note"]
 *   node tools/handle-observation-feedback.js stats
 *   node tools/handle-observation-feedback.js list [--feedback useful|not_useful|pending]
 * 
 * Callback format: obs_feedback:<observation_id>:<useful|not_useful>
 * 
 * Integration:
 *   Main agent should call this when receiving button callbacks that match
 *   the pattern "obs_feedback:*"
 */

const db = require('../lib/db');

// ============================================================
// CONSTANTS
// ============================================================

const CALLBACK_PREFIX = 'obs_feedback:';
const VALID_FEEDBACK = ['useful', 'not_useful'];

// ============================================================
// HELPERS
// ============================================================

/**
 * Parse callback_data string
 * @param {string} callbackData - Format: "obs_feedback:<id>:<feedback>"
 * @returns {Object|null} - { id, feedback } or null if invalid
 */
function parseCallbackData(callbackData) {
  if (!callbackData || typeof callbackData !== 'string') {
    return null;
  }
  
  if (!callbackData.startsWith(CALLBACK_PREFIX)) {
    return null;
  }
  
  const parts = callbackData.split(':');
  if (parts.length !== 3) {
    return null;
  }
  
  const [prefix, idStr, feedback] = parts;
  const id = parseInt(idStr, 10);
  
  if (isNaN(id) || id <= 0) {
    return { error: 'Invalid observation ID' };
  }
  
  if (!VALID_FEEDBACK.includes(feedback)) {
    return { error: `Invalid feedback value. Must be one of: ${VALID_FEEDBACK.join(', ')}` };
  }
  
  return { id, feedback };
}

/**
 * Check if a string is an observation callback
 */
function isObservationCallback(text) {
  return text && typeof text === 'string' && text.startsWith(CALLBACK_PREFIX);
}

/**
 * Handle the feedback update
 * @param {number} id - Observation ID
 * @param {string} feedback - 'useful' or 'not_useful'
 * @param {string} note - Optional feedback note
 * @returns {Object} - Result with success status and observation details
 */
function handleFeedback(id, feedback, note = null) {
  // Get the observation first
  const observation = db.getObservation(id);
  
  if (!observation) {
    return {
      success: false,
      error: `Observation #${id} not found`
    };
  }
  
  // Check if already has feedback
  if (observation.feedback) {
    return {
      success: false,
      error: `Observation #${id} already has feedback: ${observation.feedback}`,
      observation
    };
  }
  
  // Update feedback
  try {
    db.updateObservationFeedback(id, feedback, note);
    
    // Get updated observation
    const updated = db.getObservation(id);
    
    // Log activity
    db.logActivity({
      action: 'observation_feedback',
      category: 'self_observation',
      description: `Observation #${id} marked as ${feedback}`,
      metadata: {
        observationId: id,
        feedback,
        category: observation.category,
        observation: observation.observation.substring(0, 100)
      },
      source: 'feedback'
    });
    
    return {
      success: true,
      message: `Observation #${id} marked as ${feedback}`,
      observation: updated
    };
  } catch (err) {
    return {
      success: false,
      error: err.message
    };
  }
}

/**
 * Get formatted confirmation message for Telegram
 */
function getConfirmationMessage(result) {
  if (!result.success) {
    return `❌ ${result.error}`;
  }
  
  const emoji = result.observation.feedback === 'useful' ? '✅' : '❌';
  const category = result.observation.category.replace('_', ' ');
  
  return `${emoji} Thanks for the feedback!\n\n` +
         `Observation "${result.observation.observation.substring(0, 50)}..." ` +
         `marked as *${result.observation.feedback}*`;
}

/**
 * Show feedback statistics
 */
function showStats() {
  const stats = db.getObservationStats();
  
  console.log('\n📊 Observation Feedback Statistics');
  console.log('═'.repeat(40));
  console.log(`Total observations: ${stats.total}`);
  console.log(`✅ Useful: ${stats.useful}`);
  console.log(`❌ Not useful: ${stats.notUseful}`);
  console.log(`⏳ Pending: ${stats.pending}`);
  
  if (stats.byCategory.length > 0) {
    console.log('\nBy Category:');
    for (const cat of stats.byCategory) {
      const usefulness = cat.useful > 0 
        ? `(${Math.round(cat.useful / cat.count * 100)}% useful)` 
        : '';
      console.log(`  ${cat.category}: ${cat.count} ${usefulness}`);
    }
  }
  
  return stats;
}

/**
 * List observations with optional filter
 */
function listObservations(feedbackFilter = null) {
  const observations = db.getObservations({ 
    feedback: feedbackFilter === 'pending' ? null : feedbackFilter,
    limit: 20 
  });
  
  console.log(`\n📋 Observations${feedbackFilter ? ` (${feedbackFilter})` : ''}: ${observations.length}`);
  console.log('─'.repeat(50));
  
  for (const obs of observations) {
    const emoji = obs.feedback === 'useful' ? '✅' : 
                  obs.feedback === 'not_useful' ? '❌' : '⏳';
    const cat = obs.category.substring(0, 15).padEnd(15);
    const text = obs.observation.substring(0, 40) + (obs.observation.length > 40 ? '...' : '');
    console.log(`${emoji} #${obs.id} [${cat}] ${text}`);
  }
  
  return observations;
}

// ============================================================
// CLI
// ============================================================

function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage:');
    console.log('  node handle-observation-feedback.js "obs_feedback:123:useful"');
    console.log('  node handle-observation-feedback.js parse "obs_feedback:123:useful"');
    console.log('  node handle-observation-feedback.js update <id> <useful|not_useful> [note]');
    console.log('  node handle-observation-feedback.js stats');
    console.log('  node handle-observation-feedback.js list [--feedback useful|not_useful|pending]');
    process.exit(0);
  }
  
  const command = args[0];
  
  // Handle stats command
  if (command === 'stats') {
    showStats();
    return;
  }
  
  // Handle list command
  if (command === 'list') {
    const feedbackIdx = args.indexOf('--feedback');
    const filter = feedbackIdx !== -1 ? args[feedbackIdx + 1] : null;
    listObservations(filter);
    return;
  }
  
  // Handle parse command
  if (command === 'parse') {
    const callbackData = args[1];
    const parsed = parseCallbackData(callbackData);
    
    if (!parsed || parsed.error) {
      console.log('❌ Invalid callback data:', parsed?.error || 'Unknown format');
      process.exit(1);
    }
    
    console.log('✅ Parsed callback data:');
    console.log(JSON.stringify(parsed, null, 2));
    return;
  }
  
  // Handle update command
  if (command === 'update') {
    const id = parseInt(args[1], 10);
    const feedback = args[2];
    const note = args[3] || null;
    
    if (isNaN(id) || !VALID_FEEDBACK.includes(feedback)) {
      console.log('❌ Usage: update <id> <useful|not_useful> [note]');
      process.exit(1);
    }
    
    const result = handleFeedback(id, feedback, note);
    
    if (result.success) {
      console.log('✅', result.message);
    } else {
      console.log('❌', result.error);
      process.exit(1);
    }
    return;
  }
  
  // Assume first arg is callback_data
  if (isObservationCallback(command)) {
    const parsed = parseCallbackData(command);
    
    if (!parsed || parsed.error) {
      console.log('❌ Invalid callback data:', parsed?.error || 'Unknown format');
      process.exit(1);
    }
    
    console.log(`Processing feedback: observation #${parsed.id} → ${parsed.feedback}`);
    const result = handleFeedback(parsed.id, parsed.feedback);
    
    console.log('\n' + getConfirmationMessage(result));
    
    // Output JSON for programmatic use
    console.log('\n📤 Result:');
    console.log(JSON.stringify(result, null, 2));
    
    process.exit(result.success ? 0 : 1);
  }
  
  console.log('❌ Unknown command:', command);
  process.exit(1);
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = {
  parseCallbackData,
  isObservationCallback,
  handleFeedback,
  getConfirmationMessage,
  showStats,
  listObservations,
  CALLBACK_PREFIX,
  VALID_FEEDBACK
};
