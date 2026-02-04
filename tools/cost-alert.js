#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const db = require('../lib/db');

const CONFIG_DIR = path.join(process.env.HOME, '.openclaw', 'config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'cost-alert.json');
const STATE_DIR = path.join(process.env.HOME, '.openclaw', 'data');
const STATE_FILE = path.join(STATE_DIR, 'cost-alert-state.json');

// Ensure directories exist
if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
}
if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
}

// Default configuration
const DEFAULT_CONFIG = {
    threshold_usd: 150,
    notify_channel: "telegram",
    notify_target: "jason",
    enabled: true
};

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
            return { ...DEFAULT_CONFIG, ...config };
        }
    } catch (error) {
        console.error('Error loading config:', error.message);
    }
    return DEFAULT_CONFIG;
}

function saveConfig(config) {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
        return true;
    } catch (error) {
        console.error('Error saving config:', error.message);
        return false;
    }
}

function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        }
    } catch (error) {
        console.error('Error loading state:', error.message);
    }
    return {};
}

function saveState(state) {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
        return true;
    } catch (error) {
        console.error('Error saving state:', error.message);
        return false;
    }
}

function getTodayString() {
    return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

async function getTodaySpend() {
    try {
        const result = db.getCostsToday();
        return result.total || 0;
    } catch (error) {
        console.error('Error getting today spend:', error.message);
        throw error;
    }
}

async function checkThreshold() {
    const config = loadConfig();
    const state = loadState();
    const today = getTodayString();
    
    if (!config.enabled) {
        return { status: 'disabled', spend: 0, threshold: config.threshold_usd };
    }

    const todaySpend = await getTodaySpend();
    const thresholdExceeded = todaySpend >= config.threshold_usd;
    const alreadyAlerted = state[today] && state[today].alerted_at;

    return {
        status: thresholdExceeded ? (alreadyAlerted ? 'already_alerted' : 'threshold_exceeded') : 'ok',
        spend: todaySpend,
        threshold: config.threshold_usd,
        alreadyAlerted,
        config
    };
}

async function sendAlert(spend, threshold) {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    const message = `🚨 Daily API Cost Alert!\n\nSpend today: $${spend.toFixed(2)}\nThreshold: $${threshold.toFixed(2)}\n\nConsider reducing usage or switching to cheaper models.`;
    
    try {
        // Send SMS alert directly using notify.js
        await execAsync(`node ${__dirname}/notify.js sms "+18209004002" "${message}"`);
        console.log('Alert sent via SMS');
        return true;
    } catch (error) {
        console.error('Failed to send SMS alert:', error.message);
        
        // Log to error table using db.logError
        try {
            db.logError({
                level: 'error',
                source: 'cost-alert',
                message: 'SMS notification failure',
                details: `Failed to send alert: ${error.message}`
            });
        } catch (logError) {
            console.error('Failed to log error:', logError.message);
        }
        return false;
    }
}

async function alertCheck() {
    try {
        const result = await checkThreshold();
        
        if (result.status === 'threshold_exceeded') {
            // Send alert
            const alertSent = await sendAlert(result.spend, result.threshold);
            
            if (alertSent) {
                // Update state to prevent re-alerting
                const state = loadState();
                const today = getTodayString();
                state[today] = {
                    threshold_usd: result.threshold,
                    alerted_at: new Date().toISOString(),
                    spend_at_alert: result.spend
                };
                saveState(state);
                
                console.log(`✅ Alert sent - Spend: $${result.spend.toFixed(2)}, Threshold: $${result.threshold.toFixed(2)}`);
            } else {
                console.log(`❌ Alert failed - Spend: $${result.spend.toFixed(2)}, Threshold: $${result.threshold.toFixed(2)}`);
            }
        } else {
            console.log(`✅ Check complete - Status: ${result.status}, Spend: $${result.spend.toFixed(2)}, Threshold: $${result.threshold.toFixed(2)}`);
        }
        
        return result;
    } catch (error) {
        console.error('Error in alert check:', error.message);
        throw error;
    }
}

async function showStatus() {
    try {
        const result = await checkThreshold();
        const state = loadState();
        const today = getTodayString();
        const todayState = state[today];
        
        console.log('\n=== Cost Alert Status ===');
        console.log(`Current spend today: $${result.spend.toFixed(2)}`);
        console.log(`Threshold: $${result.threshold.toFixed(2)}`);
        console.log(`Status: ${result.status}`);
        console.log(`Enabled: ${result.config.enabled}`);
        
        if (todayState) {
            console.log(`\nToday's alert info:`);
            console.log(`  Alerted at: ${todayState.alerted_at || 'Never'}`);
            console.log(`  Spend at alert: $${(todayState.spend_at_alert || 0).toFixed(2)}`);
            console.log(`  Alert threshold: $${todayState.threshold_usd.toFixed(2)}`);
        }
        
        console.log(`\nConfig file: ${CONFIG_FILE}`);
        console.log(`State file: ${STATE_FILE}`);
    } catch (error) {
        console.error('Error showing status:', error.message);
        process.exit(1);
    }
}

async function updateConfig(options) {
    const config = loadConfig();
    let changed = false;
    
    if (options.threshold !== undefined) {
        const threshold = parseFloat(options.threshold);
        if (isNaN(threshold) || threshold < 0) {
            console.error('Invalid threshold value. Must be a positive number.');
            process.exit(1);
        }
        config.threshold_usd = threshold;
        changed = true;
        console.log(`Updated threshold to $${threshold}`);
    }
    
    if (options.enabled !== undefined) {
        config.enabled = options.enabled === 'true';
        changed = true;
        console.log(`${config.enabled ? 'Enabled' : 'Disabled'} cost alerting`);
    }
    
    if (options.channel !== undefined) {
        config.notify_channel = options.channel;
        changed = true;
        console.log(`Updated notification channel to ${options.channel}`);
    }
    
    if (changed) {
        if (saveConfig(config)) {
            console.log('Configuration saved successfully');
        } else {
            console.error('Failed to save configuration');
            process.exit(1);
        }
    } else {
        console.log('No changes made to configuration');
    }
}

function showHelp() {
    console.log(`
Cost Alert Tool

Usage:
  node tools/cost-alert.js <command> [options]

Commands:
  check                    - Check current spend vs threshold and alert if needed
  status                   - Show current status and configuration  
  config [options]         - Update configuration
  help                     - Show this help

Config Options:
  --threshold <amount>     - Set daily spending threshold (e.g., 200)
  --enabled <true|false>   - Enable or disable alerting
  --channel <telegram|sms> - Set notification channel

Examples:
  node tools/cost-alert.js check
  node tools/cost-alert.js status
  node tools/cost-alert.js config --threshold 200
  node tools/cost-alert.js config --enabled false
`);
}

// Main CLI handler
async function main() {
    const args = process.argv.slice(2);
    const command = args[0];
    
    if (!command || command === 'help') {
        showHelp();
        return;
    }
    
    switch (command) {
        case 'check':
            await alertCheck();
            break;
            
        case 'status':
            await showStatus();
            break;
            
        case 'config':
            const options = {};
            for (let i = 1; i < args.length; i += 2) {
                const key = args[i].replace('--', '');
                const value = args[i + 1];
                if (value !== undefined) {
                    options[key] = value;
                }
            }
            await updateConfig(options);
            break;
            
        default:
            console.error(`Unknown command: ${command}`);
            showHelp();
            process.exit(1);
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error('Fatal error:', error.message);
        process.exit(1);
    });
}

module.exports = { checkThreshold, alertCheck, loadConfig };