#!/usr/bin/env node
/**
 * Weekly Self-Observation Job
 * 
 * Synthesizes behavioral patterns from the past week into observations.
 * Designed to run via cron every Sunday at 6pm Melbourne time.
 * 
 * Usage:
 *   node tools/weekly-self-observation.js           # Run observation synthesis
 *   node tools/weekly-self-observation.js --dry-run # Preview without storing
 *   node tools/weekly-self-observation.js --debug   # Show all data collected
 * 
 * Cron setup (see docs/self-observation-cron.md):
 *   0 8 * * 0 node /path/to/tools/weekly-self-observation.js
 *   (8:00 UTC = 18:00 Melbourne AEST, 19:00 AEDT)
 */

const path = require('path');
const { execSync } = require('child_process');

// Load db
const db = require('../lib/db');

// Load Gemini via router (uses OpenRouter - no rate limits)
const { route } = require('../lib/router');

// ============================================================
// CONSTANTS
// ============================================================

const OBSERVATION_CATEGORIES = ['task_preference', 'communication', 'decision', 'error'];

const ACTIVITY_CATEGORIES = [
  'self_obs_task_preference',
  'self_obs_communication', 
  'self_obs_decision',
  'self_obs_error'
];

// ============================================================
// HELPERS
// ============================================================

/**
 * Get the Monday of the past week (7 days ago, then go to Monday)
 */
function getWeekStart() {
  const now = new Date();
  // Go back 7 days
  const weekAgo = new Date(now);
  weekAgo.setDate(now.getDate() - 7);
  // Find the Monday of that week
  const dayOfWeek = weekAgo.getDay();
  const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Monday is day 1
  const monday = new Date(weekAgo);
  monday.setDate(weekAgo.getDate() - diff);
  return monday.toISOString().split('T')[0];
}

/**
 * Get date string for N days ago
 */
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

/**
 * Query activity logs for self_obs_* categories from past week
 */
function getWeeklyActivity() {
  const weekAgo = daysAgo(7);
  
  // Query activity for each observation category
  const activities = db.db.prepare(`
    SELECT 
      category,
      action,
      description,
      metadata,
      created_at
    FROM activity
    WHERE category IN (${ACTIVITY_CATEGORIES.map(() => '?').join(',')})
      AND created_at >= ?
    ORDER BY created_at DESC
    LIMIT 200
  `).all(...ACTIVITY_CATEGORIES, weekAgo);
  
  return activities.map(a => ({
    ...a,
    metadata: a.metadata ? JSON.parse(a.metadata) : null
  }));
}

/**
 * Get general activity summary for context
 */
function getActivitySummary() {
  const weekAgo = daysAgo(7);
  
  const summary = db.db.prepare(`
    SELECT 
      category,
      COUNT(*) as count,
      COUNT(DISTINCT action) as unique_actions
    FROM activity
    WHERE created_at >= ?
    GROUP BY category
    ORDER BY count DESC
    LIMIT 20
  `).all(weekAgo);
  
  return summary;
}

/**
 * Search session memory for behavioral patterns
 */
async function searchSessionMemory(queries) {
  const results = [];
  const weekAgo = daysAgo(7);
  
  for (const query of queries) {
    try {
      // Use session-memory.js CLI tool
      const cmd = `node tools/session-memory.js search "${query}" --after "${weekAgo}" --limit 5 --no-rerank`;
      const output = execSync(cmd, { 
        cwd: path.join(__dirname, '..'),
        encoding: 'utf8',
        timeout: 30000
      });
      
      if (output && !output.includes('No results found')) {
        results.push({
          query,
          matches: output.trim()
        });
      }
    } catch (err) {
      // Silent fail - session memory might not have data
      console.error(`Session search failed for "${query}": ${err.message}`);
    }
  }
  
  return results;
}

/**
 * Build the synthesis prompt for Gemini
 */
function buildPrompt(activities, sessionResults, activitySummary) {
  const activitiesByCategory = {};
  for (const a of activities) {
    const cat = a.category.replace('self_obs_', '');
    if (!activitiesByCategory[cat]) activitiesByCategory[cat] = [];
    activitiesByCategory[cat].push(a);
  }
  
  return `You are analyzing behavioral patterns for an AI assistant (Max) to generate self-observations.

## Activity Signals from Past Week

${Object.entries(activitiesByCategory).map(([cat, acts]) => `
### ${cat.replace('_', ' ').toUpperCase()} (${acts.length} signals)
${acts.slice(0, 15).map(a => `- ${a.action}: ${a.description}${a.metadata ? ` [${JSON.stringify(a.metadata)}]` : ''}`).join('\n')}
${acts.length > 15 ? `... and ${acts.length - 15} more` : ''}
`).join('\n')}

## Session Memory Excerpts (behavioral context)
${sessionResults.length > 0 ? sessionResults.map(r => `
Query: "${r.query}"
${r.matches}
`).join('\n---\n') : 'No relevant session memory found.'}

## Overall Activity Summary
${activitySummary.map(s => `- ${s.category}: ${s.count} actions (${s.unique_actions} unique)`).join('\n')}

---

Based on this data, generate 3-5 observations about behavioral patterns. Each observation should:
1. Be specific and actionable (not generic platitudes)
2. Include a confidence score (0.0-1.0) based on evidence strength
3. Reference specific evidence from the data above
4. Fit one of these categories: task_preference, communication, decision, error

Output as JSON array:
[
  {
    "category": "task_preference|communication|decision|error",
    "observation": "Specific insight about behavior pattern",
    "evidence": ["Data point 1", "Data point 2"],
    "confidence": 0.7
  }
]

Rules:
- High confidence (0.8-1.0): Multiple consistent data points
- Medium confidence (0.5-0.79): Some evidence but could be coincidental
- Low confidence (0.3-0.49): Limited evidence, more of a hypothesis
- If there's very little data, generate fewer observations (minimum 1)
- Be honest about uncertainty - don't overfit to sparse data

Output ONLY the JSON array, no other text.`;
}

/**
 * Parse Gemini response into observations
 */
function parseObservations(response) {
  try {
    // Try to extract JSON from response
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('No JSON array found in response');
    }
    
    const observations = JSON.parse(jsonMatch[0]);
    
    // Validate structure
    return observations.filter(obs => {
      if (!OBSERVATION_CATEGORIES.includes(obs.category)) {
        console.warn(`Invalid category: ${obs.category}`);
        return false;
      }
      if (!obs.observation || typeof obs.observation !== 'string') {
        console.warn('Missing observation text');
        return false;
      }
      if (typeof obs.confidence !== 'number' || obs.confidence < 0 || obs.confidence > 1) {
        obs.confidence = 0.5; // Default to medium confidence
      }
      if (!Array.isArray(obs.evidence)) {
        obs.evidence = [];
      }
      return true;
    });
  } catch (err) {
    console.error('Failed to parse observations:', err.message);
    console.error('Raw response:', response);
    return [];
  }
}

/**
 * Store observations in database
 */
function storeObservations(observations, weekStart) {
  const stored = [];
  
  for (const obs of observations) {
    try {
      const id = db.addObservation({
        weekStart,
        category: obs.category,
        observation: obs.observation,
        evidence: obs.evidence,
        confidence: obs.confidence
      });
      stored.push({ id, ...obs });
      console.log(`✓ Stored observation #${id}: ${obs.observation.substring(0, 50)}...`);
    } catch (err) {
      console.error(`Failed to store observation: ${err.message}`);
    }
  }
  
  return stored;
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const debug = args.includes('--debug');
  
  console.log('='.repeat(60));
  console.log('Weekly Self-Observation Synthesis');
  console.log('='.repeat(60));
  console.log();
  
  const weekStart = getWeekStart();
  console.log(`Week: ${weekStart} to ${daysAgo(0)}`);
  console.log();
  
  // 1. Get activity signals
  console.log('📊 Collecting activity signals...');
  const activities = getWeeklyActivity();
  console.log(`   Found ${activities.length} self-observation signals`);
  
  const activitySummary = getActivitySummary();
  if (debug) {
    console.log('\n   Activity summary:');
    activitySummary.forEach(s => console.log(`   - ${s.category}: ${s.count}`));
  }
  
  // 2. Search session memory for behavioral patterns
  console.log('\n🔍 Searching session memory...');
  const searchQueries = [
    'task delegation decision',
    'communication style response',
    'error correction mistake',
    'autonomous action permission',
    'pattern behavior preference'
  ];
  
  const sessionResults = await searchSessionMemory(searchQueries);
  console.log(`   Found ${sessionResults.length} relevant session excerpts`);
  
  if (debug && sessionResults.length > 0) {
    console.log('\n   Session excerpts:');
    sessionResults.forEach(r => {
      console.log(`   Query: "${r.query}"`);
      console.log(`   ${r.matches.substring(0, 200)}...`);
    });
  }
  
  // 3. Check if we have enough data
  if (activities.length === 0 && sessionResults.length === 0) {
    console.log('\n⚠️  Not enough data for meaningful observations.');
    console.log('   Self-observation signals are logged passively over time.');
    console.log('   Try again next week when more data has accumulated.');
    return;
  }
  
  // 4. Synthesize observations via Gemini
  console.log('\n🤖 Synthesizing observations via Gemini...');
  const prompt = buildPrompt(activities, sessionResults, activitySummary);
  
  if (debug) {
    console.log('\n   Prompt preview (first 500 chars):');
    console.log('   ' + prompt.substring(0, 500) + '...');
  }
  
  let response;
  try {
    const result = await route({
      type: 'summarize', // Routes to Gemini
      prompt
    });
    response = result.result;
    console.log(`   Model: ${result.model} | Tokens: ${result.tokens.in}/${result.tokens.out} | Cost: $${result.cost.toFixed(4)}`);
  } catch (err) {
    console.error(`   ❌ Gemini failed: ${err.message}`);
    return;
  }
  
  // 5. Parse and validate observations
  console.log('\n📝 Parsing observations...');
  const observations = parseObservations(response);
  console.log(`   Generated ${observations.length} valid observations`);
  
  if (observations.length === 0) {
    console.log('\n⚠️  No valid observations generated.');
    if (debug) {
      console.log('Raw response:', response);
    }
    return;
  }
  
  // 6. Display observations
  console.log('\n' + '─'.repeat(60));
  console.log('Observations:');
  console.log('─'.repeat(60));
  
  for (const obs of observations) {
    console.log(`\n[${obs.category}] (confidence: ${(obs.confidence * 100).toFixed(0)}%)`);
    console.log(`  ${obs.observation}`);
    if (obs.evidence.length > 0) {
      console.log(`  Evidence: ${obs.evidence.slice(0, 3).join('; ')}`);
    }
  }
  
  // 7. Store observations (unless dry run)
  if (dryRun) {
    console.log('\n⏸️  Dry run - observations not stored');
    console.log('   Remove --dry-run flag to store observations');
  } else {
    console.log('\n💾 Storing observations...');
    const stored = storeObservations(observations, weekStart);
    console.log(`\n✅ Stored ${stored.length} observations for week ${weekStart}`);
    
    // Log activity
    db.logActivity({
      action: 'weekly_self_observation',
      category: 'self_observation',
      description: `Generated ${stored.length} observations for week ${weekStart}`,
      metadata: {
        weekStart,
        observationCount: stored.length,
        categories: stored.map(o => o.category),
        avgConfidence: stored.reduce((sum, o) => sum + o.confidence, 0) / stored.length
      },
      source: 'cron'
    });
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('Done');
}

// Run
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
