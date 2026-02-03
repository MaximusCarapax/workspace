#!/usr/bin/env node
/**
 * Check OpenClaw logs for recent errors
 * Usage: node tools/check-errors.js [--since 1h]
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ERROR_LOG = path.join(process.env.HOME, '.openclaw/workspace/memory/errors.log');

function checkLogs() {
  try {
    const logs = execSync('openclaw logs 2>&1', { encoding: 'utf-8', maxBuffer: 1024 * 1024 });
    
    // Filter for errors/warnings in last hour
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);
    
    const errors = [];
    const lines = logs.split('\n');
    
    for (const line of lines) {
      if (line.match(/error|fail|warn|exception/i) && !line.includes('check-errors')) {
        // Try to parse timestamp
        const match = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
        if (match) {
          const ts = new Date(match[1]).getTime();
          if (ts > oneHourAgo) {
            errors.push(line.slice(0, 200)); // Truncate long lines
          }
        } else {
          errors.push(line.slice(0, 200));
        }
      }
    }
    
    return errors;
  } catch (err) {
    return [`Error checking logs: ${err.message}`];
  }
}

function main() {
  const errors = checkLogs();
  
  if (errors.length === 0) {
    console.log('✓ No recent errors');
    return;
  }
  
  console.log(`⚠️ Found ${errors.length} recent error(s):\n`);
  
  // Dedupe similar errors
  const seen = new Set();
  for (const err of errors) {
    const key = err.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z/, '').slice(0, 100);
    if (!seen.has(key)) {
      seen.add(key);
      console.log(`• ${err}`);
    }
  }
  
  // Append to error log
  try {
    const logDir = path.dirname(ERROR_LOG);
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    
    const entry = `\n--- ${new Date().toISOString()} ---\n${errors.join('\n')}\n`;
    fs.appendFileSync(ERROR_LOG, entry);
  } catch (e) {
    // Ignore log write errors
  }
}

main();
