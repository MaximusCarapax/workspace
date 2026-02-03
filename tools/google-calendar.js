#!/usr/bin/env node
/**
 * Google Calendar CLI Tool
 * Usage:
 *   node google-calendar.js today              - Show today's events
 *   node google-calendar.js tomorrow           - Show tomorrow's events
 *   node google-calendar.js week               - Show next 7 days
 *   node google-calendar.js date <YYYY-MM-DD>  - Show specific date
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

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
  const expiry = creds.calendar_token_expiry || 0;
  
  if (Date.now() < expiry - 60000 && creds.calendar_access_token) {
    return creds.calendar_access_token;
  }
  
  if (!creds.calendar_refresh_token) {
    throw new Error('No calendar refresh token. Need to authorize Calendar API first.');
  }
  
  const tokens = await refreshAccessToken(creds.calendar_refresh_token);
  saveCredentials({
    calendar_access_token: tokens.access_token,
    calendar_token_expiry: Date.now() + (tokens.expires_in * 1000)
  });
  
  return tokens.access_token;
}

function calendarAPI(endpoint) {
  return new Promise(async (resolve, reject) => {
    let token;
    try {
      token = await getAccessToken();
    } catch (err) {
      return reject(err);
    }
    const options = {
      hostname: 'www.googleapis.com',
      path: `/calendar/v3${endpoint}`,
      method: 'GET',
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
    req.end();
  });
}

// Date helpers
function getDateRange(type, specificDate = null) {
  const now = new Date();
  let start, end;

  switch (type) {
    case 'today':
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      end = new Date(start);
      end.setDate(end.getDate() + 1);
      break;
    case 'tomorrow':
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      end = new Date(start);
      end.setDate(end.getDate() + 1);
      break;
    case 'week':
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      end = new Date(start);
      end.setDate(end.getDate() + 7);
      break;
    case 'date':
      if (!specificDate) throw new Error('Date required');
      const [year, month, day] = specificDate.split('-').map(Number);
      start = new Date(year, month - 1, day);
      end = new Date(start);
      end.setDate(end.getDate() + 1);
      break;
    default:
      throw new Error(`Unknown type: ${type}`);
  }

  return {
    timeMin: start.toISOString(),
    timeMax: end.toISOString()
  };
}

function formatTime(dateTime, isAllDay = false) {
  if (isAllDay) return 'All day';
  
  const date = new Date(dateTime);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

function formatDate(dateTime) {
  const date = new Date(dateTime);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });
}

function truncate(str, maxLen = 100) {
  if (!str) return '';
  str = str.replace(/\n/g, ' ').trim();
  return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
}

async function getEvents(type, specificDate = null) {
  const { timeMin, timeMax } = getDateRange(type, specificDate);
  
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '50'
  });

  const result = await calendarAPI(`/calendars/primary/events?${params}`);
  return result.items || [];
}

function displayEvents(events, title) {
  console.log(`\n📅 ${title}\n${'─'.repeat(50)}`);
  
  if (events.length === 0) {
    console.log('  No events scheduled.\n');
    return;
  }

  let currentDate = null;
  
  for (const event of events) {
    const isAllDay = !event.start.dateTime;
    const startStr = event.start.dateTime || event.start.date;
    const endStr = event.end.dateTime || event.end.date;
    
    const eventDate = formatDate(startStr);
    
    // Print date header if changed (useful for week view)
    if (eventDate !== currentDate) {
      currentDate = eventDate;
      console.log(`\n  ${eventDate}`);
    }
    
    // Time
    const startTime = formatTime(startStr, isAllDay);
    const endTime = isAllDay ? '' : formatTime(endStr, isAllDay);
    const timeDisplay = isAllDay ? '  All day' : `  ${startTime} - ${endTime}`;
    
    console.log(`\n${timeDisplay}`);
    console.log(`  📌 ${event.summary || '(No title)'}`);
    
    if (event.location) {
      console.log(`  📍 ${event.location}`);
    }
    
    if (event.description) {
      console.log(`  📝 ${truncate(event.description)}`);
    }
  }
  
  console.log(`\n${'─'.repeat(50)}\n`);
}

async function main() {
  const [,, cmd, ...args] = process.argv;

  try {
    switch (cmd) {
      case 'today': {
        const events = await getEvents('today');
        displayEvents(events, "Today's Events");
        break;
      }

      case 'tomorrow': {
        const events = await getEvents('tomorrow');
        displayEvents(events, "Tomorrow's Events");
        break;
      }

      case 'week': {
        const events = await getEvents('week');
        displayEvents(events, 'Next 7 Days');
        break;
      }

      case 'date': {
        const date = args[0];
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          console.log('Usage: node google-calendar.js date <YYYY-MM-DD>');
          return;
        }
        const events = await getEvents('date', date);
        displayEvents(events, `Events for ${date}`);
        break;
      }

      default:
        console.log(`
Google Calendar CLI Tool

Usage:
  node google-calendar.js today              Show today's events
  node google-calendar.js tomorrow           Show tomorrow's events  
  node google-calendar.js week               Show next 7 days
  node google-calendar.js date <YYYY-MM-DD>  Show specific date

Note: Requires calendar_refresh_token in credentials.json
        `);
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
