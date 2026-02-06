#!/usr/bin/env node
/**
 * Promote observations to MEMORY.md
 * 
 * Finds observations marked 'useful' that haven't been promoted yet,
 * and adds them to the long-term memory file.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../lib/db');

const MEMORY_PATH = path.join(__dirname, '..', 'MEMORY.md');

async function getUnpromotedUsefulObservations() {
  const observations = db.getObservations({ feedback: 'useful', limit: 100 });
  // Filter to those not yet promoted (check if evidence contains 'promoted' flag)
  return observations.filter(obs => {
    try {
      const evidence = JSON.parse(obs.evidence || '[]');
      return !evidence.includes('promoted_to_memory');
    } catch {
      return true;
    }
  });
}

function markAsPromoted(obsId, currentEvidence) {
  let evidence;
  try {
    evidence = JSON.parse(currentEvidence || '[]');
  } catch {
    evidence = [];
  }
  evidence.push('promoted_to_memory');
  
  // Update via raw SQL since we need to update evidence
  const stmt = db.db.prepare('UPDATE self_observations SET evidence = ? WHERE id = ?');
  stmt.run(JSON.stringify(evidence), obsId);
}

function appendToMemory(observations) {
  if (observations.length === 0) return;
  
  let content = fs.readFileSync(MEMORY_PATH, 'utf8');
  
  // Find or create Self-Observations section
  const sectionHeader = '## Self-Observations (Promoted)';
  if (!content.includes(sectionHeader)) {
    content += `\n\n${sectionHeader}\n\nPatterns I've noticed about myself that were confirmed useful:\n`;
  }
  
  const insertPoint = content.indexOf(sectionHeader) + sectionHeader.length;
  const afterHeader = content.slice(insertPoint);
  const beforeHeader = content.slice(0, insertPoint);
  
  // Find end of section intro
  const introEnd = afterHeader.indexOf('\n\n') + 2;
  const intro = afterHeader.slice(0, introEnd);
  const rest = afterHeader.slice(introEnd);
  
  // Format new observations
  const newEntries = observations.map(obs => {
    const date = new Date(obs.created_at).toISOString().split('T')[0];
    return `- **[${obs.category}]** ${obs.observation} _(${date}, confidence: ${Math.round(obs.confidence * 100)}%)_`;
  }).join('\n');
  
  // Rebuild content
  const newContent = beforeHeader + intro + newEntries + '\n' + rest;
  fs.writeFileSync(MEMORY_PATH, newContent);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  
  console.log('🔍 Finding useful observations to promote...\n');
  
  const observations = await getUnpromotedUsefulObservations();
  
  if (observations.length === 0) {
    console.log('No unpromoted useful observations found.');
    return;
  }
  
  console.log(`Found ${observations.length} observations to promote:\n`);
  observations.forEach(obs => {
    console.log(`  [${obs.category}] ${obs.observation.slice(0, 60)}...`);
  });
  
  if (dryRun) {
    console.log('\n--dry-run: Would promote these to MEMORY.md');
    return;
  }
  
  // Promote to MEMORY.md
  appendToMemory(observations);
  console.log(`\n✅ Added ${observations.length} observations to MEMORY.md`);
  
  // Mark as promoted
  observations.forEach(obs => {
    markAsPromoted(obs.id, obs.evidence);
  });
  console.log('✅ Marked observations as promoted');
}

main().catch(console.error);
