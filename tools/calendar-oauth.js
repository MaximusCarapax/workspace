#!/usr/bin/env node
/**
 * Google Calendar OAuth Setup (with write access)
 * 
 * Run this on a machine with a browser to authorize Calendar API write access.
 * 
 * Usage: node tools/calendar-oauth.js
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const CREDENTIALS_PATH = path.join(process.env.HOME, '.openclaw/secrets/credentials.json');

// Load from credentials.json or environment
function loadSecret(key) {
  try {
    const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
    return creds[key] || creds.google?.[key] || null;
  } catch { return null; }
}

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || loadSecret('google_client_id');
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || loadSecret('google_client_secret');
const REDIRECT_PORT = 3334;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

// Full calendar access (read + write)
const SCOPES = [
  'https://www.googleapis.com/auth/calendar',  // Full access
];

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌ Missing Google OAuth credentials.');
  console.error('');
  console.error('Add to ~/.openclaw/secrets/credentials.json:');
  console.error(JSON.stringify({
    google_client_id: 'your-client-id.apps.googleusercontent.com',
    google_client_secret: 'your-client-secret'
  }, null, 2));
  console.error('');
  console.error('Get credentials from: https://console.cloud.google.com/apis/credentials');
  process.exit(1);
}

function buildAuthUrl() {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',  // Force consent to get new refresh token
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function exchangeCode(code) {
  return new Promise((resolve, reject) => {
    const data = new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }).toString();

    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(data),
      },
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`Failed to parse response: ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function saveCredentials(tokens) {
  let creds = {};
  try {
    creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  } catch (e) {
    // Start fresh
  }

  // Save calendar-specific tokens
  creds.calendar_access_token = tokens.access_token;
  creds.calendar_refresh_token = tokens.refresh_token;
  creds.calendar_token_expiry = Date.now() + (tokens.expires_in * 1000);

  fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(creds, null, 2));
  console.log('✅ Calendar credentials saved to', CREDENTIALS_PATH);
}

async function main() {
  console.log('🗓️  Google Calendar OAuth Setup (with WRITE access)');
  console.log('');
  
  const authUrl = buildAuthUrl();
  
  console.log('1. Open this URL in your browser:');
  console.log('');
  console.log(authUrl);
  console.log('');
  console.log('2. Sign in and grant calendar access');
  console.log('3. You will be redirected to localhost - this script will capture the code');
  console.log('');
  console.log(`Waiting for callback on port ${REDIRECT_PORT}...`);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
    
    if (url.pathname === '/callback') {
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      
      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`<h1>Error</h1><p>${error}</p>`);
        console.error('❌ OAuth error:', error);
        process.exit(1);
      }
      
      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Success!</h1><p>You can close this window. Calendar write access granted.</p>');
        
        console.log('');
        console.log('Exchanging code for tokens...');
        
        try {
          const tokens = await exchangeCode(code);
          
          if (tokens.error) {
            console.error('❌ Token error:', tokens.error_description || tokens.error);
            process.exit(1);
          }
          
          saveCredentials(tokens);
          console.log('');
          console.log('✅ Calendar OAuth complete! Write access enabled.');
          console.log('');
          console.log('Test with: node tools/google-calendar.js create "[Max] Test" "2026-02-07T10:00:00" 30');
          
          server.close();
          process.exit(0);
        } catch (e) {
          console.error('❌ Failed to exchange code:', e.message);
          process.exit(1);
        }
      }
    }
    
    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(REDIRECT_PORT);
}

main().catch(console.error);
