#!/usr/bin/env node
/**
 * Aider Log Helper - Detects and logs recent aider commits
 * 
 * Usage:
 *   node tools/aider-log.js                    # Log commits from last 5 minutes
 *   node tools/aider-log.js --since "10 minutes ago"
 *   node tools/aider-log.js --last 3           # Last 3 commits
 *   
 * Can be called after aider runs to auto-log tool usage.
 * Or set up as a git post-commit hook.
 */

const { execSync } = require('child_process');
const path = require('path');

// Parse args
const args = process.argv.slice(2);
let since = '5 minutes ago';
let lastN = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--since' && args[i + 1]) {
    since = args[++i];
  } else if (args[i] === '--last' && args[i + 1]) {
    lastN = parseInt(args[++i], 10);
  } else if (args[i] === '--help' || args[i] === '-h') {
    console.log(`
Aider Log Helper - Logs recent aider commits to activity

Usage:
  node tools/aider-log.js                    # Log commits from last 5 minutes
  node tools/aider-log.js --since "10 min"   # Custom time window
  node tools/aider-log.js --last 3           # Last N commits

Detects commits made by aider (marked with "aider:") and logs them.
`);
    process.exit(0);
  }
}

function getRecentCommits() {
  try {
    let cmd;
    if (lastN) {
      cmd = `git log -${lastN} --pretty=format:"%H|%s|%an|%ad" --date=iso`;
    } else {
      cmd = `git log --since="${since}" --pretty=format:"%H|%s|%an|%ad" --date=iso`;
    }
    
    const output = execSync(cmd, { encoding: 'utf8', cwd: process.cwd() }).trim();
    if (!output) return [];
    
    return output.split('\n').map(line => {
      const [hash, subject, author, date] = line.split('|');
      return { hash, subject, author, date };
    });
  } catch (e) {
    return [];
  }
}

function getCommitFiles(hash) {
  try {
    const output = execSync(`git diff-tree --no-commit-id --name-only -r ${hash}`, {
      encoding: 'utf8',
      cwd: process.cwd()
    }).trim();
    return output ? output.split('\n') : [];
  } catch (e) {
    return [];
  }
}

function isAiderCommit(commit) {
  // Aider commits typically start with "aider:" or mention aider
  return commit.subject.toLowerCase().includes('aider:') ||
         commit.subject.toLowerCase().startsWith('aider ') ||
         commit.author.toLowerCase().includes('aider');
}

function logAiderCommit(commit, files) {
  try {
    const { logTool } = require('../lib/auto-log');
    
    // Extract model from commit message if present
    const modelMatch = commit.subject.match(/\((\w+[-/]\w+)\)/);
    const model = modelMatch ? modelMatch[1] : 'deepseek-chat';
    
    logTool('aider', `Modified ${files.length} file(s): ${files.slice(0, 3).join(', ')}${files.length > 3 ? '...' : ''}`, {
      files,
      file_count: files.length,
      model,
      commit_hash: commit.hash.substring(0, 8),
      commit_subject: commit.subject.substring(0, 100)
    });
    
    return true;
  } catch (e) {
    console.error(`Error logging commit: ${e.message}`);
    return false;
  }
}

function main() {
  const commits = getRecentCommits();
  
  if (commits.length === 0) {
    console.log('No recent commits found.');
    return;
  }
  
  let aiderCount = 0;
  let loggedCount = 0;
  
  for (const commit of commits) {
    if (isAiderCommit(commit)) {
      aiderCount++;
      const files = getCommitFiles(commit.hash);
      
      if (logAiderCommit(commit, files)) {
        loggedCount++;
        console.log(`✓ Logged: ${commit.subject.substring(0, 60)}... (${files.length} files)`);
      }
    }
  }
  
  console.log(`\nFound ${commits.length} commits, ${aiderCount} from aider, ${loggedCount} logged.`);
}

main();
