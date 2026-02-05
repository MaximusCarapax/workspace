#!/usr/bin/env node
/**
 * Cost Alerting Tool
 * Monitors daily API spend and alerts when threshold is exceeded
 * 
 * Usage:
 *   node tools/cost-alert.js check          # Check current spend vs threshold
 *   node tools/cost-alert.js config         # Show current config
 *   node tools/cost-alert.js config --threshold 200   # Set threshold
 *   node tools/cost-alert.js config --enable/--disable  # Toggle alerts
 *   node tools/cost-alert.js reset          # Reset alert state for today
 */

const db = require('../lib/db');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Paths
const CONFIG_PATH = path.join(process.env.HOME, '.openclaw/config/cost-alert.json');
const STATE_PATH = path.join(process.env.HOME, '.openclaw/data/cost-alert-state.json');

// Default config
// Note: notify_target must be a valid Telegram chat ID (numeric) or @username
// Use `node tools/cost-alert.js config --target <chat_id>` to set it
const DEFAULT_CONFIG = {
  threshold_usd: 150,
  notify_channel: 'telegram',
  notify_target: process.env.TELEGRAM_CHAT_ID || '6293656628', // Default to Jason's chat ID
  enabled: true
};

// ============================================================
// HELPERS
// ============================================================

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
    }
  } catch (e) {
    console.error('Warning: Could not load config:', e.message);
  }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(config) {
  ensureDir(CONFIG_PATH);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function loadState() {
  try {
    if (fs.existsSync(STATE_PATH)) {
      return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('Warning: Could not load state:', e.message);
  }
  return { alerts: {} };
}

function saveState(state) {
  ensureDir(STATE_PATH);
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function getTodayUTC() {
  return new Date().toISOString().split('T')[0];
}

function hasAlertedToday(state) {
  const today = getTodayUTC();
  return state.alerts && state.alerts[today]?.alerted === true;
}

function markAlertedToday(state, spendAtAlert) {
  const today = getTodayUTC();
  if (!state.alerts) state.alerts = {};
  state.alerts[today] = {
    alerted: true,
    alerted_at: new Date().toISOString(),
    spend_at_alert: spendAtAlert
  };
  
  // Clean up old entries (keep last 7 days)
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  for (const date of Object.keys(state.alerts)) {
    if (new Date(date) < cutoff) {
      delete state.alerts[date];
    }
  }
  
  saveState(state);
}

async function sendAlert(message, config) {
  const target = config.notify_target || '6293656628';
  const channel = config.notify_channel || 'telegram';
  
  // Use openclaw message tool to send message
  try {
    const cmd = `openclaw message send --channel ${channel} --target ${target} --message ${JSON.stringify(message)}`;
    execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch (e) {
    // Log error to DB
    db.logError({
      level: 'error',
      source: 'cost-alert',
      message: 'Failed to send alert',
      details: e.message
    });
    console.error('Failed to send alert:', e.message);
    return false;
  }
}

// ============================================================
// COMMANDS
// ============================================================

async function check(options = {}) {
  const config = loadConfig();
  const state = loadState();
  const costs = db.getCostsToday();
  
  const today = getTodayUTC();
  const spend = costs.total || 0;
  const threshold = config.threshold_usd;
  const percentage = ((spend / threshold) * 100).toFixed(1);
  const isOver = spend >= threshold;
  const alreadyAlerted = hasAlertedToday(state);
  
  // Console output
  const status = isOver ? '🔴 OVER' : (spend >= threshold * 0.8 ? '🟡 WARNING' : '🟢 OK');
  
  console.log('\n💰 Cost Alert Status\n');
  console.log(`  Date:       ${today} (UTC)`);
  console.log(`  Spend:      $${spend.toFixed(2)}`);
  console.log(`  Threshold:  $${threshold.toFixed(2)}`);
  console.log(`  Usage:      ${percentage}%`);
  console.log(`  Status:     ${status}`);
  console.log(`  Alerts:     ${config.enabled ? 'enabled' : 'disabled'}`);
  
  if (alreadyAlerted) {
    const alertInfo = state.alerts[today];
    console.log(`  Alerted:    Yes (at ${alertInfo.alerted_at}, spend was $${alertInfo.spend_at_alert?.toFixed(2)})`);
  }
  console.log('');
  
  // Log activity
  db.logActivity({
    action: 'cost_check',
    category: 'monitoring',
    description: `Daily spend: $${spend.toFixed(2)} / $${threshold.toFixed(2)} (${percentage}%)`,
    metadata: { spend, threshold, percentage, isOver },
    source: 'cost-alert'
  });
  
  // Send alert if threshold crossed and not already alerted today
  if (isOver && config.enabled && !alreadyAlerted && !options.quiet) {
    console.log('⚠️  Threshold exceeded! Sending alert...');
    
    const alertMessage = `🚨 *Daily API Cost Alert*\n\n` +
      `Spend: *$${spend.toFixed(2)}* / $${threshold.toFixed(2)} threshold\n` +
      `Usage: ${percentage}%\n` +
      `Requests: ${costs.requests}\n\n` +
      `_Consider pausing non-essential tasks or adjusting threshold._`;
    
    const sent = await sendAlert(alertMessage, config);
    if (sent) {
      markAlertedToday(state, spend);
      console.log('✅ Alert sent successfully');
    } else {
      console.log('❌ Failed to send alert');
    }
  }
  
  return { spend, threshold, percentage, isOver, alreadyAlerted };
}

function showConfig() {
  const config = loadConfig();
  const state = loadState();
  const today = getTodayUTC();
  
  console.log('\n⚙️  Cost Alert Configuration\n');
  console.log(`  Config file: ${CONFIG_PATH}`);
  console.log(`  State file:  ${STATE_PATH}`);
  console.log('');
  console.log('  Settings:');
  console.log(`    threshold_usd:  ${config.threshold_usd}`);
  console.log(`    notify_channel: ${config.notify_channel}`);
  console.log(`    notify_target:  ${config.notify_target}`);
  console.log(`    enabled:        ${config.enabled}`);
  console.log('');
  
  if (state.alerts && Object.keys(state.alerts).length > 0) {
    console.log('  Recent Alerts:');
    const dates = Object.keys(state.alerts).sort().reverse().slice(0, 5);
    for (const date of dates) {
      const info = state.alerts[date];
      console.log(`    ${date}: $${info.spend_at_alert?.toFixed(2) || '?'} at ${info.alerted_at?.split('T')[1]?.split('.')[0] || '?'}`);
    }
    console.log('');
  }
}

function updateConfig(options) {
  const config = loadConfig();
  let changed = false;
  
  if (options.threshold !== undefined) {
    const threshold = parseFloat(options.threshold);
    if (isNaN(threshold) || threshold <= 0) {
      console.error('Error: threshold must be a positive number');
      process.exit(1);
    }
    config.threshold_usd = threshold;
    changed = true;
    console.log(`✅ Threshold set to $${threshold.toFixed(2)}`);
  }
  
  if (options.enable) {
    config.enabled = true;
    changed = true;
    console.log('✅ Alerts enabled');
  }
  
  if (options.disable) {
    config.enabled = false;
    changed = true;
    console.log('✅ Alerts disabled');
  }
  
  if (options.target !== undefined) {
    config.notify_target = options.target;
    changed = true;
    console.log(`✅ Target set to ${options.target}`);
  }
  
  if (changed) {
    saveConfig(config);
    console.log(`\nConfig saved to ${CONFIG_PATH}`);
  } else {
    showConfig();
  }
}

function reset() {
  const state = loadState();
  const today = getTodayUTC();
  
  if (state.alerts && state.alerts[today]) {
    delete state.alerts[today];
    saveState(state);
    console.log(`✅ Reset alert state for ${today}`);
  } else {
    console.log(`ℹ️  No alert state to reset for ${today}`);
  }
}

function alertStatus() {
  // For db.js integration - outputs JSON-friendly format
  const config = loadConfig();
  const state = loadState();
  const costs = db.getCostsToday();
  const today = getTodayUTC();
  
  const result = {
    date: today,
    spend_usd: costs.total || 0,
    threshold_usd: config.threshold_usd,
    percentage: ((costs.total || 0) / config.threshold_usd * 100).toFixed(1),
    alerted_today: hasAlertedToday(state),
    last_alert: state.alerts?.[today] || null,
    enabled: config.enabled
  };
  
  console.log(JSON.stringify(result, null, 2));
  return result;
}

// ============================================================
// CLI
// ============================================================

function printHelp() {
  console.log(`
Cost Alert Tool - Monitor daily API spending

Usage:
  node tools/cost-alert.js check                   Check current spend vs threshold
  node tools/cost-alert.js check --quiet           Check without sending alerts
  node tools/cost-alert.js config                  Show current configuration
  node tools/cost-alert.js config --threshold 200  Set threshold to $200
  node tools/cost-alert.js config --enable         Enable alerts
  node tools/cost-alert.js config --disable        Disable alerts
  node tools/cost-alert.js reset                   Reset alert state for today
  node tools/cost-alert.js status                  Output JSON status (for scripting)

Default threshold: $${DEFAULT_CONFIG.threshold_usd}/day
Config: ${CONFIG_PATH}
State:  ${STATE_PATH}
`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  // Parse options
  const options = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--threshold' && args[i + 1]) {
      options.threshold = args[++i];
    } else if (args[i] === '--target' && args[i + 1]) {
      options.target = args[++i];
    } else if (args[i] === '--enable') {
      options.enable = true;
    } else if (args[i] === '--disable') {
      options.disable = true;
    } else if (args[i] === '--quiet' || args[i] === '-q') {
      options.quiet = true;
    } else if (args[i] === '--json') {
      options.json = true;
    }
  }
  
  switch (command) {
    case 'check':
      await check(options);
      break;
    case 'config':
      updateConfig(options);
      break;
    case 'reset':
      reset();
      break;
    case 'status':
      alertStatus();
      break;
    case '--help':
    case '-h':
    case 'help':
      printHelp();
      break;
    default:
      if (!command) {
        // Default to check
        await check(options);
      } else {
        console.error(`Unknown command: ${command}`);
        printHelp();
        process.exit(1);
      }
  }
}

main().catch(e => {
  console.error('Error:', e.message);
  db.logError({
    level: 'error',
    source: 'cost-alert',
    message: e.message,
    stack: e.stack
  });
  process.exit(1);
});

// Export for library use
module.exports = { check, loadConfig, saveConfig, loadState, hasAlertedToday };
