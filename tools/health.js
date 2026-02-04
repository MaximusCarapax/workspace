#!/usr/bin/env node
/**
 * Integration Health Checks
 * Tests each integration and logs status to SQLite
 */

const db = require('../lib/db');
const fs = require('fs');
const path = require('path');

// Health check functions for each integration
const checks = {
  async gmail() {
    try {
      const credsPath = path.join(process.env.HOME, '.openclaw/secrets/gmail-token.json');
      if (!fs.existsSync(credsPath)) {
        return { status: 'error', message: 'No Gmail token found' };
      }
      const token = JSON.parse(fs.readFileSync(credsPath));
      if (token.expiry_date && token.expiry_date < Date.now()) {
        return { status: 'degraded', message: 'Token may need refresh' };
      }
      return { status: 'ok', message: 'Token valid' };
    } catch (e) {
      return { status: 'error', message: e.message };
    }
  },

  async calendar() {
    try {
      const credsPath = path.join(process.env.HOME, '.openclaw/secrets/gmail-token.json');
      if (!fs.existsSync(credsPath)) {
        return { status: 'error', message: 'No Calendar token found' };
      }
      return { status: 'ok', message: 'Credentials valid' };
    } catch (e) {
      return { status: 'error', message: e.message };
    }
  },

  async gemini() {
    try {
      const envPath = path.join(process.env.HOME, '.openclaw/workspace/.env');
      const env = fs.readFileSync(envPath, 'utf8');
      const match = env.match(/GEMINI_API_KEY=(.+)/);
      if (!match) {
        return { status: 'error', message: 'No API key' };
      }
      
      // Quick test call
      const key = match[1].trim();
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Say OK' }] }],
          generationConfig: { maxOutputTokens: 5 }
        })
      });
      const data = await res.json();
      if (data.error) {
        if (data.error.code === 429) {
          return { status: 'degraded', message: 'Rate limited' };
        }
        return { status: 'error', message: data.error.message?.slice(0, 50) };
      }
      return { status: 'ok', message: 'API responding' };
    } catch (e) {
      return { status: 'error', message: e.message };
    }
  },

  async deepseek() {
    try {
      const envPath = path.join(process.env.HOME, '.openclaw/workspace/.env');
      const env = fs.readFileSync(envPath, 'utf8');
      const match = env.match(/DEEPSEEK_API_KEY=(.+)/);
      if (!match) {
        return { status: 'error', message: 'No API key' };
      }
      return { status: 'ok', message: 'API key configured' };
    } catch (e) {
      return { status: 'error', message: e.message };
    }
  },

  async openrouter() {
    try {
      const secretsPath = path.join(process.env.HOME, '.openclaw/secrets/openrouter.json');
      if (!fs.existsSync(secretsPath)) {
        return { status: 'error', message: 'No credentials file' };
      }
      const secrets = JSON.parse(fs.readFileSync(secretsPath));
      
      // Check credits
      const res = await fetch('https://openrouter.ai/api/v1/credits', {
        headers: { 'Authorization': `Bearer ${secrets.api_key}` }
      });
      const data = await res.json();
      if (data.data) {
        const remaining = data.data.total_credits - data.data.total_usage;
        if (remaining < 1) {
          return { status: 'degraded', message: `Low credits: $${remaining.toFixed(2)}` };
        }
        return { status: 'ok', message: `$${remaining.toFixed(2)} remaining` };
      }
      return { status: 'error', message: 'Could not check credits' };
    } catch (e) {
      return { status: 'error', message: e.message };
    }
  },

  async twilio() {
    try {
      const credsPath = path.join(process.env.HOME, '.openclaw/secrets/credentials.json');
      const creds = JSON.parse(fs.readFileSync(credsPath));
      if (!creds.twilio?.accountSid) {
        return { status: 'error', message: 'No Twilio credentials' };
      }
      return { status: 'ok', message: `Phone: ${creds.twilio.phoneNumber || 'configured'}` };
    } catch (e) {
      return { status: 'error', message: e.message };
    }
  },

  async twitter() {
    try {
      // Check for Bird CLI cookies in .env (primary method)
      const envPath = path.join(process.env.HOME, '.openclaw/workspace/.env');
      let hasBirdCreds = false;
      if (fs.existsSync(envPath)) {
        const env = fs.readFileSync(envPath, 'utf8');
        hasBirdCreds = env.includes('AUTH_TOKEN=') && env.includes('CT0=');
      }
      
      // Check for API bearer token in credentials.json (fallback)
      const credsPath = path.join(process.env.HOME, '.openclaw/secrets/credentials.json');
      let hasApiCreds = false;
      if (fs.existsSync(credsPath)) {
        const creds = JSON.parse(fs.readFileSync(credsPath));
        hasApiCreds = !!(creds.twitter?.bearerToken || creds.twitter?.apiKey);
      }
      
      if (!hasBirdCreds && !hasApiCreds) {
        return { status: 'error', message: 'No Twitter credentials' };
      }
      
      // Check monthly usage from stats file
      const statsPath = path.join(process.env.HOME, '.openclaw/workspace/dashboard/data/x-post-stats.json');
      if (fs.existsSync(statsPath)) {
        const stats = JSON.parse(fs.readFileSync(statsPath));
        const reads = stats.monthlyReads || 0;
        const method = hasBirdCreds ? 'Bird+API' : 'API only';
        if (reads > 90) {
          return { status: 'degraded', message: `${reads}/100 reads (${method})` };
        }
        return { status: 'ok', message: `${reads}/100 reads (${method})` };
      }
      return { status: 'ok', message: hasBirdCreds ? 'Bird CLI configured' : 'API configured' };
    } catch (e) {
      return { status: 'error', message: e.message };
    }
  },

  async linkedin() {
    try {
      const cookiesPath = '/tmp/linkedin-cookies.json';
      if (!fs.existsSync(cookiesPath)) {
        return { status: 'error', message: 'No session cookies' };
      }
      const stats = fs.statSync(cookiesPath);
      const ageHours = (Date.now() - stats.mtimeMs) / 1000 / 60 / 60;
      if (ageHours > 24) {
        return { status: 'degraded', message: `Cookies ${Math.round(ageHours)}h old` };
      }
      return { status: 'ok', message: 'Session active' };
    } catch (e) {
      return { status: 'error', message: e.message };
    }
  },

  async sqlite() {
    try {
      const dbPath = path.join(process.env.HOME, '.openclaw/data/agent.db');
      if (!fs.existsSync(dbPath)) {
        return { status: 'error', message: 'Database not found' };
      }
      const count = db.db.prepare('SELECT COUNT(*) as c FROM token_usage').get();
      return { status: 'ok', message: `${count.c} usage records` };
    } catch (e) {
      return { status: 'error', message: e.message };
    }
  }
};

async function runChecks(integrations = null) {
  const toCheck = integrations || Object.keys(checks);
  const results = {};
  
  console.log('\n🏥 Health Check\n');
  
  for (const name of toCheck) {
    if (!checks[name]) {
      console.log(`  ⚪ ${name}: Unknown integration`);
      continue;
    }
    
    const start = Date.now();
    try {
      const result = await checks[name]();
      const latency = Date.now() - start;
      results[name] = { ...result, latency };
      
      // Log to SQLite
      db.logHealthCheck({
        integration: name,
        status: result.status,
        message: result.message,
        latencyMs: latency
      });
      
      const icon = { ok: '🟢', degraded: '🟡', error: '🔴' }[result.status] || '⚪';
      console.log(`  ${icon} ${name}: ${result.status} — ${result.message} (${latency}ms)`);
    } catch (e) {
      results[name] = { status: 'error', message: e.message, latency: Date.now() - start };
      console.log(`  🔴 ${name}: error — ${e.message}`);
    }
  }
  
  console.log('');
  return results;
}

// CLI
const args = process.argv.slice(2);
if (args[0] === '--help' || args[0] === '-h') {
  console.log(`
Health Check Tool

Usage:
  node health.js              # Check all integrations
  node health.js gmail        # Check specific integration
  node health.js --list       # List available checks

Integrations: ${Object.keys(checks).join(', ')}
`);
} else if (args[0] === '--list') {
  console.log('Available integrations:', Object.keys(checks).join(', '));
} else {
  runChecks(args.length > 0 ? args : null);
}
