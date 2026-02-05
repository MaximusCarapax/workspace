#!/usr/bin/env node
/**
 * Gmail CLI Tool
 * Usage:
 *   node gmail.js inbox [count]     - List recent inbox messages
 *   node gmail.js unread [count]    - List unread messages  
 *   node gmail.js read <id>         - Read a specific message
 *   node gmail.js search <query>    - Search messages
 *   node gmail.js archive <id>      - Archive a message
 *   node gmail.js label <id> <label> - Add label to message
 *   node gmail.js draft <to> <subject> <body> - Create draft
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const db = require('../lib/db');

const CREDENTIALS_PATH = path.join(process.env.HOME, '.openclaw/secrets/credentials.json');

function loadSecret(key) {
  try {
    const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
    return creds[key] || creds.google?.[key] || null;
  } catch { return null; }
}

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || loadSecret('google_client_id');
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || loadSecret('google_client_secret');

function loadCredentials() {
  return JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
}

function saveCredentials(creds) {
  const existing = loadCredentials();
  const updated = { ...existing, ...creds };
  fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(updated, null, 2));
}

function refreshAccessToken(refreshToken) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token',
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

async function getAccessToken() {
  const creds = loadCredentials();
  const expiry = creds.gmail_token_expiry || 0;
  
  if (Date.now() < expiry - 60000 && creds.gmail_access_token) {
    return creds.gmail_access_token;
  }
  
  if (!creds.gmail_refresh_token) {
    throw new Error('No refresh token. Run gmail-oauth.js first.');
  }
  
  const tokens = await refreshAccessToken(creds.gmail_refresh_token);
  saveCredentials({
    gmail_access_token: tokens.access_token,
    gmail_token_expiry: Date.now() + (tokens.expires_in * 1000)
  });
  
  return tokens.access_token;
}

function gmailAPI(method, endpoint, body = null) {
  return new Promise(async (resolve, reject) => {
    const token = await getAccessToken();
    const options = {
      hostname: 'gmail.googleapis.com',
      path: `/gmail/v1/users/me${endpoint}`,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`API error ${res.statusCode}: ${data}`));
        } else {
          resolve(data ? JSON.parse(data) : {});
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function decodeBase64(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function encodeBase64(str) {
  return Buffer.from(str).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function getHeader(headers, name) {
  const h = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

function extractBody(payload) {
  if (payload.body?.data) {
    return decodeBase64(payload.body.data);
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return decodeBase64(part.body.data);
      }
    }
    for (const part of payload.parts) {
      const nested = extractBody(part);
      if (nested) return nested;
    }
  }
  return '';
}

async function listMessages(query, maxResults = 10) {
  const q = encodeURIComponent(query);
  const result = await gmailAPI('GET', `/messages?q=${q}&maxResults=${maxResults}`);
  return result.messages || [];
}

async function getMessage(id) {
  return gmailAPI('GET', `/messages/${id}?format=full`);
}

async function archiveMessage(id) {
  return gmailAPI('POST', `/messages/${id}/modify`, {
    removeLabelIds: ['INBOX']
  });
}

async function addLabel(id, labelName) {
  const labels = await gmailAPI('GET', '/labels');
  const label = labels.labels.find(l => l.name.toLowerCase() === labelName.toLowerCase());
  if (!label) throw new Error(`Label "${labelName}" not found`);
  
  return gmailAPI('POST', `/messages/${id}/modify`, {
    addLabelIds: [label.id]
  });
}

async function createDraft(to, subject, body) {
  const raw = encodeBase64(
    `To: ${to}\r\n` +
    `Subject: ${subject}\r\n` +
    `Content-Type: text/plain; charset=utf-8\r\n\r\n` +
    body
  );
  
  return gmailAPI('POST', '/drafts', {
    message: { raw }
  });
}

// Gmail label colors (background, text)
const LABEL_COLORS = {
  red:    { backgroundColor: '#fb4c2f', textColor: '#ffffff' },
  orange: { backgroundColor: '#ffad47', textColor: '#ffffff' },
  yellow: { backgroundColor: '#fad165', textColor: '#000000' },
  green:  { backgroundColor: '#16a766', textColor: '#ffffff' },
  blue:   { backgroundColor: '#4986e7', textColor: '#ffffff' },
  purple: { backgroundColor: '#a479e2', textColor: '#ffffff' },
  gray:   { backgroundColor: '#999999', textColor: '#ffffff' },
};

async function createLabel(name, color = null) {
  const body = {
    name,
    labelListVisibility: 'labelShow',
    messageListVisibility: 'show'
  };
  
  if (color && LABEL_COLORS[color]) {
    body.color = LABEL_COLORS[color];
  }
  
  return gmailAPI('POST', '/labels', body);
}

async function deleteLabel(labelName) {
  const labels = await gmailAPI('GET', '/labels');
  const label = labels.labels.find(l => l.name.toLowerCase() === labelName.toLowerCase());
  if (!label) throw new Error(`Label "${labelName}" not found`);
  
  return gmailAPI('DELETE', `/labels/${label.id}`);
}

async function trashMessage(id) {
  return gmailAPI('POST', `/messages/${id}/trash`);
}

async function deleteMessage(id) {
  return gmailAPI('DELETE', `/messages/${id}`);
}

async function main() {
  const [,, cmd, ...args] = process.argv;

  try {
    switch (cmd) {
      case 'inbox': {
        const count = parseInt(args[0]) || 10;
        const messages = await listMessages('in:inbox', count);
        console.log(`\nInbox (${messages.length} messages):\n`);
        for (const m of messages) {
          const msg = await getMessage(m.id);
          const from = getHeader(msg.payload.headers, 'From');
          const subject = getHeader(msg.payload.headers, 'Subject');
          const date = getHeader(msg.payload.headers, 'Date');
          console.log(`[${m.id}]`);
          console.log(`  From: ${from}`);
          console.log(`  Subject: ${subject}`);
          console.log(`  Date: ${date}`);
          console.log('');
        }
        break;
      }

      case 'unread': {
        const count = parseInt(args[0]) || 10;
        const messages = await listMessages('is:unread', count);
        console.log(`\nUnread (${messages.length} messages):\n`);
        for (const m of messages) {
          const msg = await getMessage(m.id);
          const from = getHeader(msg.payload.headers, 'From');
          const subject = getHeader(msg.payload.headers, 'Subject');
          console.log(`[${m.id}] ${subject}`);
          console.log(`  From: ${from}`);
          console.log('');
        }
        break;
      }

      case 'read': {
        const id = args[0];
        if (!id) { console.log('Usage: node gmail.js read <message-id>'); return; }
        const msg = await getMessage(id);
        const from = getHeader(msg.payload.headers, 'From');
        const to = getHeader(msg.payload.headers, 'To');
        const subject = getHeader(msg.payload.headers, 'Subject');
        const date = getHeader(msg.payload.headers, 'Date');
        const body = extractBody(msg.payload);
        
        console.log(`\nFrom: ${from}`);
        console.log(`To: ${to}`);
        console.log(`Subject: ${subject}`);
        console.log(`Date: ${date}`);
        console.log(`\n${'-'.repeat(60)}\n`);
        console.log(body);
        break;
      }

      case 'search': {
        const query = args.join(' ');
        if (!query) { console.log('Usage: node gmail.js search <query>'); return; }
        const messages = await listMessages(query, 20);
        console.log(`\nSearch "${query}" (${messages.length} results):\n`);
        for (const m of messages) {
          const msg = await getMessage(m.id);
          const from = getHeader(msg.payload.headers, 'From');
          const subject = getHeader(msg.payload.headers, 'Subject');
          console.log(`[${m.id}] ${subject}`);
          console.log(`  From: ${from}`);
          console.log('');
        }
        break;
      }

      case 'archive': {
        const id = args[0];
        if (!id) { console.log('Usage: node gmail.js archive <message-id>'); return; }
        await archiveMessage(id);
        console.log(`✓ Archived message ${id}`);
        break;
      }

      case 'label': {
        const [id, label] = args;
        if (!id || !label) { console.log('Usage: node gmail.js label <message-id> <label>'); return; }
        await addLabel(id, label);
        console.log(`✓ Added label "${label}" to message ${id}`);
        break;
      }

      case 'draft': {
        const [to, subject, ...bodyParts] = args;
        if (!to || !subject) { 
          console.log('Usage: node gmail.js draft <to> <subject> <body>'); 
          return; 
        }
        const body = bodyParts.join(' ');
        const result = await createDraft(to, subject, body);
        console.log(`✓ Draft created (id: ${result.id})`);
        console.log(`  Open Gmail to review and send.`);
        break;
      }

      case 'labels': {
        const result = await gmailAPI('GET', '/labels');
        console.log('\nLabels:\n');
        result.labels.forEach(l => console.log(`  ${l.name}`));
        break;
      }

      case 'create-label': {
        const [name, color] = args;
        if (!name) { console.log('Usage: node gmail.js create-label <name> [color]'); return; }
        if (color && !LABEL_COLORS[color]) {
          console.log(`Available colors: ${Object.keys(LABEL_COLORS).join(', ')}`);
          return;
        }
        const result = await createLabel(name, color);
        console.log(`✓ Created label "${name}"${color ? ` (${color})` : ''}`);
        break;
      }

      case 'delete-label': {
        const name = args[0];
        if (!name) { console.log('Usage: node gmail.js delete-label <name>'); return; }
        await deleteLabel(name);
        console.log(`✓ Deleted label "${name}"`);
        break;
      }

      case 'trash': {
        const id = args[0];
        if (!id) { console.log('Usage: node gmail.js trash <message-id>'); return; }
        await trashMessage(id);
        console.log(`✓ Moved message ${id} to trash`);
        break;
      }

      case 'delete': {
        const id = args[0];
        if (!id) { console.log('Usage: node gmail.js delete <message-id>'); return; }
        await deleteMessage(id);
        console.log(`✓ Permanently deleted message ${id}`);
        break;
      }

      default:
        console.log(`
Gmail CLI Tool

Usage:
  node gmail.js inbox [count]              List recent inbox
  node gmail.js unread [count]             List unread messages
  node gmail.js read <id>                  Read full message
  node gmail.js search <query>             Search (Gmail syntax)
  node gmail.js archive <id>               Archive message
  node gmail.js trash <id>                 Move to trash
  node gmail.js delete <id>                Permanently delete
  node gmail.js label <id> <name>          Add label to message
  node gmail.js labels                     List all labels
  node gmail.js create-label <name> [color]  Create label (colors: red, orange, yellow, green, blue, purple, gray)
  node gmail.js delete-label <name>        Delete a label
  node gmail.js draft <to> <subj> <body>   Create draft
        `);
    }
  } catch (err) {
    db.logError({
      source: 'gmail',
      message: err.message,
      details: `Gmail CLI command failed: ${cmd}`,
      stack: err.stack
    });
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
