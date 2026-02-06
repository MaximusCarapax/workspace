#!/usr/bin/env node
/**
 * Promote observations to MEMORY.md
 * 
 * Finds observations marked 'useful' that haven't been promoted yet,
 * and adds them to the long-term memory file. Also includes decision
 * pattern summaries when available.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../lib/db');

const MEMORY_PATH = path.join(__dirname, '..', 'MEMORY.md');
const PATTERNS_DIR = path.join(__dirname, '..', 'memory', 'patterns');

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

function getWeekNumber(date) {
  const start = new Date(date.getFullYear(), 0, 1);
  const diff = (date - start + (start.getTimezoneOffset() - date.getTimezoneOffset()) * 60 * 1000);
  const oneWeek = 1000 * 60 * 60 * 24 * 7;
  return Math.floor(diff / oneWeek) + 1;
}

function getLatestPatternSummary() {
  if (!fs.existsSync(PATTERNS_DIR)) {
    return null;
  }

  const patternFiles = fs.readdirSync(PATTERNS_DIR)
    .filter(f => f.match(/^\d{4}-W\d{2}\.md$/))
    .sort()
    .reverse();

  if (patternFiles.length === 0) {
    return null;
  }

  try {
    const latestFile = path.join(PATTERNS_DIR, patternFiles[0]);
    const content = fs.readFileSync(latestFile, 'utf8');
    
    // Extract key sections from the pattern analysis
    const tendenciesMatch = content.match(/## 🎯 Key Tendencies\n(.*?)\n\n/s);
    const growthMatch = content.match(/## 📈 Growth Areas\n(.*?)\n\n/s);
    const summaryMatch = content.match(/## 💭 Summary\n(.*?)\n\n/s);
    
    if (summaryMatch) {
      return {
        week: patternFiles[0].replace('.md', ''),
        summary: summaryMatch[1].trim(),
        tendencies: tendenciesMatch ? tendenciesMatch[1].trim() : null,
        growth: growthMatch ? growthMatch[1].trim() : null
      };
    }
  } catch (error) {
    console.error(`Error reading pattern file: ${error.message}`);
  }

  return null;
}

function appendToMemory(observations, patternSummary = null) {
  let content = fs.readFileSync(MEMORY_PATH, 'utf8');
  
  // Add decision pattern summary if available and this is a weekly digest
  if (patternSummary && observations.length > 0) {
    const patternHeader = '## Decision Patterns (Weekly)';
    if (!content.includes(patternHeader)) {
      content += `\n\n${patternHeader}\n\nSummary of my decision-making patterns:\n`;
    }
    
    const patternInsertPoint = content.indexOf(patternHeader) + patternHeader.length;
    const afterPatternHeader = content.slice(patternInsertPoint);
    const beforePatternHeader = content.slice(0, patternInsertPoint);
    
    const introEnd = afterPatternHeader.indexOf('\n\n') + 2;
    const intro = afterPatternHeader.slice(0, introEnd);
    const rest = afterPatternHeader.slice(introEnd);
    
    // Format pattern entry
    const patternEntry = `### ${patternSummary.week}\n${patternSummary.summary}\n\n`;
    
    // Insert pattern summary
    content = beforePatternHeader + intro + patternEntry + rest;
  }
  
  // Add observations if any
  if (observations.length > 0) {
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
    content = beforeHeader + intro + newEntries + '\n' + rest;
  }
  
  fs.writeFileSync(MEMORY_PATH, content);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const includePatterns = process.argv.includes('--include-patterns');
  
  console.log('🔍 Finding useful observations to promote...\n');
  
  const observations = await getUnpromotedUsefulObservations();
  const patternSummary = includePatterns ? getLatestPatternSummary() : null;
  
  if (observations.length === 0 && !patternSummary) {
    console.log('No unpromoted useful observations or pattern summaries found.');
    return;
  }
  
  if (observations.length > 0) {
    console.log(`Found ${observations.length} observations to promote:\n`);
    observations.forEach(obs => {
      console.log(`  [${obs.category}] ${obs.observation.slice(0, 60)}...`);
    });
  }
  
  if (patternSummary) {
    console.log(`\nFound decision pattern summary for ${patternSummary.week}:`);
    console.log(`  ${patternSummary.summary.slice(0, 80)}...`);
  }
  
  if (dryRun) {
    console.log('\n--dry-run: Would promote these to MEMORY.md');
    if (patternSummary) {
      console.log('--dry-run: Would include decision pattern summary');
    }
    return;
  }
  
  // Promote to MEMORY.md (includes both observations and pattern summary)
  appendToMemory(observations, patternSummary);
  
  let promotedCount = 0;
  if (observations.length > 0) {
    console.log(`\n✅ Added ${observations.length} observations to MEMORY.md`);
    
    // Mark as promoted
    observations.forEach(obs => {
      markAsPromoted(obs.id, obs.evidence);
    });
    console.log('✅ Marked observations as promoted');
    promotedCount += observations.length;
  }
  
  if (patternSummary) {
    console.log(`✅ Added decision pattern summary for ${patternSummary.week} to MEMORY.md`);
    promotedCount += 1;
  }
  
  if (promotedCount === 0) {
    console.log('No content promoted.');
  }
}

main().catch(console.error);
