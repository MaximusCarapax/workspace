#!/usr/bin/env node
/**
 * Gmail OAuth Setup
 * 
 * Run this on a machine with a browser to authorize Gmail API access.
 * 
 * Usage: node tools/gmail-oauth.js
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const CREDENTIALS_PATH = path.join(process.env.HOME, '.openclaw/secrets/credentials.json');
const TOKEN_PATH = path.join(process.env.HOME, '.openclaw/secrets/gmail-token.json');

// Load from credentials.json or environment
function loadSecret(key) {
  try {
    const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
    return creds[key] || creds.google?.[key] || null;
  } catch { return null; }
}

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || loadSecret('google_client_id');
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || loadSecret('google_client_secret');
const REDIRECT_PORT = 3333;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/calendar.readonly',
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
    prompt: 'consent',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

function exchangeCode(code) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    });

    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const result = JSON.parse(data);
        if (result.error) reject(new Error(result.error_description || result.error));
        else resolve(result);
      });
    });
    req.on('error', reject);
    req.write(params.toString());
    req.end();
  });
}

async function main() {
  console.log('🔐 Gmail OAuth Setup\n');
  
  const authUrl = buildAuthUrl();
  
  console.log('1. Open this URL in your browser:\n');
  console.log(authUrl);
  console.log('\n2. Sign in and authorize the app');
  console.log('3. You\'ll be redirected to localhost - that\'s expected\n');
  
  // Start local server to receive callback
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
    
    if (url.pathname === '/callback') {
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      
      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`<h1>❌ Error: ${error}</h1><p>Close this window and try again.</p>`);
        console.error(`\n❌ Error: ${error}`);
        server.close();
        process.exit(1);
      }
      
      if (code) {
        try {
          console.log('📡 Exchanging code for tokens...');
          const tokens = await exchangeCode(code);
          
          // Save tokens
          const tokenData = {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            scope: tokens.scope,
            token_type: tokens.token_type,
            expiry_date: Date.now() + (tokens.expires_in * 1000),
          };
          
          // Ensure directory exists
          const dir = path.dirname(TOKEN_PATH);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          
          fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokenData, null, 2));
          
          // Also update credentials.json for backward compatibility
          try {
            const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
            creds.gmail_refresh_token = tokens.refresh_token;
            creds.gmail_access_token = tokens.access_token;
            creds.gmail_token_expiry = tokenData.expiry_date;
            fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(creds, null, 2));
          } catch (e) {
            // OK if credentials.json doesn't exist
          }
          
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <h1>✅ Success!</h1>
            <p>Gmail OAuth tokens saved.</p>
            <p>You can close this window.</p>
          `);
          
          console.log('\n✅ Tokens saved to:');
          console.log(`   ${TOKEN_PATH}`);
          console.log('\nGmail API access is now configured!');
          
          server.close();
          process.exit(0);
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(`<h1>❌ Error</h1><p>${err.message}</p>`);
          console.error(`\n❌ Error: ${err.message}`);
          server.close();
          process.exit(1);
        }
      }
    }
    
    res.writeHead(404);
    res.end('Not found');
  });
  
  server.listen(REDIRECT_PORT, () => {
    console.log(`⏳ Waiting for authorization (listening on port ${REDIRECT_PORT})...`);
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
