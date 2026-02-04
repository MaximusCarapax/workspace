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
    // We use OpenRouter for Gemini now (no rate limits)
    // This check tests OpenRouter's Gemini endpoint
    try {
      const secretsPath = path.join(process.env.HOME, '.openclaw/secrets/openrouter.json');
      if (!fs.existsSync(secretsPath)) {
        return { status: 'error', message: 'No OpenRouter credentials' };
      }
      const secrets = JSON.parse(fs.readFileSync(secretsPath));
      
      // Quick test call via OpenRouter
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${secrets.api_key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.0-flash-001',
          messages: [{ role: 'user', content: 'Say OK' }],
          max_tokens: 5
        })
      });
      
      if (!res.ok) {
        const error = await res.text();
        return { status: 'error', message: `OpenRouter: ${res.status}` };
      }
      
      const data = await res.json();
      if (data.choices?.[0]?.message?.content) {
        return { status: 'ok', message: 'OpenRouter Gemini ready' };
      }
      return { status: 'error', message: 'No response' };
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
  },

  async cron() {
    try {
      // Check cron jobs via gateway API
      const { execSync } = require('child_process');
      const result = execSync('openclaw cron list --json 2>/dev/null', { encoding: 'utf8', timeout: 5000 });
      const data = JSON.parse(result);
      const jobs = data.jobs || [];
      
      if (jobs.length === 0) {
        return { status: 'degraded', message: 'No cron jobs configured' };
      }
      
      const enabled = jobs.filter(j => j.enabled).length;
      const now = Date.now();
      
      // Check if any jobs are overdue (last run > 2x expected interval)
      let overdue = 0;
      for (const job of jobs) {
        if (!job.enabled || !job.state?.lastRunAtMs) continue;
        const lastRun = job.state.lastRunAtMs;
        const hoursSince = (now - lastRun) / 1000 / 60 / 60;
        // If job hasn't run in 25+ hours, it's probably overdue
        if (hoursSince > 25) overdue++;
      }
      
      if (overdue > 0) {
        return { status: 'degraded', message: `${enabled} jobs, ${overdue} overdue` };
      }
      
      return { status: 'ok', message: `${enabled} jobs active` };
    } catch (e) {
      // Fallback: just check if openclaw is running
      try {
        const { execSync } = require('child_process');
        execSync('pgrep -f openclaw', { encoding: 'utf8' });
        return { status: 'ok', message: 'Gateway running' };
      } catch {
        return { status: 'error', message: 'Cannot check cron status' };
      }
    }
  },

  async git() {
    try {
      const { execSync } = require('child_process');
      const workDir = path.join(process.env.HOME, '.openclaw/workspace');
      
      // Check if we can reach GitHub
      execSync('git ls-remote --exit-code origin HEAD', { 
        cwd: workDir, 
        encoding: 'utf8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      // Check for uncommitted changes
      const status = execSync('git status --porcelain', { cwd: workDir, encoding: 'utf8' });
      const uncommitted = status.trim().split('\n').filter(l => l).length;
      
      if (uncommitted > 10) {
        return { status: 'degraded', message: `${uncommitted} uncommitted files` };
      } else if (uncommitted > 0) {
        return { status: 'ok', message: `${uncommitted} uncommitted` };
      }
      
      return { status: 'ok', message: 'Clean, remote reachable' };
    } catch (e) {
      if (e.message?.includes('timeout')) {
        return { status: 'error', message: 'GitHub unreachable (timeout)' };
      }
      return { status: 'error', message: e.message?.slice(0, 40) || 'Git error' };
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
