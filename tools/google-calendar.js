#!/usr/bin/env node
/**
 * Google Calendar CLI Tool
 * 
 * Read commands:
 *   node google-calendar.js today              - Show today's events
 *   node google-calendar.js tomorrow           - Show tomorrow's events
 *   node google-calendar.js week               - Show next 7 days
 *   node google-calendar.js date <YYYY-MM-DD>  - Show specific date
 *   node google-calendar.js availability <start> <end> - Check availability
 * 
 * Write commands:
 *   node google-calendar.js create "title" <datetime> [duration] [description] - Create event
 *   node google-calendar.js update <event-id> [title] [datetime] [duration] [description] - Update event
 *   node google-calendar.js delete <event-id> - Delete event
 * 
 * Examples:
 *   node google-calendar.js create "Meeting with John" "2024-01-15T14:00:00" 60 "Discuss project"
 *   node google-calendar.js availability "2024-01-15T09:00:00" "2024-01-15T17:00:00"
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

function calendarAPI(endpoint, method = 'GET', body = null) {
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
    
    if (body) {
      req.write(JSON.stringify(body));
    }
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

/**
 * Check availability for a time range
 */
async function checkAvailability(startTime, endTime) {
  // Ensure times are in proper ISO format
  const start = new Date(startTime);
  const end = new Date(endTime);
  
  const params = new URLSearchParams({
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '50'
  });

  const result = await calendarAPI(`/calendars/primary/events?${params}`);
  const events = result.items || [];
  
  console.log(`\n📅 Availability Check: ${formatDate(start.toISOString())} ${formatTime(start.toISOString())} - ${formatTime(end.toISOString())}\n${'─'.repeat(50)}`);
  
  if (events.length === 0) {
    console.log('✅ Completely free during this time\n');
    return { available: true, conflicts: [] };
  }
  
  console.log('❌ Conflicts found:');
  const conflicts = [];
  
  for (const event of events) {
    const isAllDay = !event.start.dateTime;
    const startStr = event.start.dateTime || event.start.date;
    const endStr = event.end.dateTime || event.end.date;
    
    const timeDisplay = isAllDay ? 'All day' : `${formatTime(startStr)} - ${formatTime(endStr)}`;
    console.log(`  • ${timeDisplay}: ${event.summary || '(No title)'}`);
    
    conflicts.push({
      title: event.summary,
      start: startStr,
      end: endStr,
      isAllDay
    });
  }
  
  console.log(`\n${'─'.repeat(50)}\n`);
  return { available: false, conflicts };
}

/**
 * Create a new calendar event
 */
async function createEvent(title, startDateTime, durationMinutes = 60, description = '', attendeeEmail = '') {
  const startTime = new Date(startDateTime);
  const endTime = new Date(startTime.getTime() + (durationMinutes * 60 * 1000));
  
  // Prefix Max-created events
  const eventTitle = title.startsWith('[Max]') ? title : `[Max] ${title}`;
  
  const eventBody = {
    summary: eventTitle,
    description: description || '',
    start: {
      dateTime: startTime.toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
    },
    end: {
      dateTime: endTime.toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
    }
  };
  
  // Add attendee if provided
  if (attendeeEmail) {
    eventBody.attendees = [{ email: attendeeEmail }];
    eventBody.guestsCanModify = true;
    eventBody.guestsCanSeeOtherGuests = true;
  }
  
  try {
    const result = await calendarAPI('/calendars/primary/events', 'POST', eventBody);
    
    console.log(`\n✅ Event created successfully!`);
    console.log(`📌 Title: ${result.summary}`);
    console.log(`📅 Time: ${formatTime(result.start.dateTime)} - ${formatTime(result.end.dateTime)}`);
    console.log(`🔗 Event ID: ${result.id}`);
    if (result.htmlLink) {
      console.log(`🌐 Link: ${result.htmlLink}`);
    }
    console.log();
    
    return result;
  } catch (error) {
    console.error('❌ Failed to create event:', error.message);
    
    // Check if it's a permissions error
    if (error.message.includes('403') || error.message.includes('insufficient')) {
      console.error('\n⚠️  PERMISSION ERROR: This appears to be a Google Calendar API permissions issue.');
      console.error('💡 The current OAuth scope may be read-only. To enable write operations:');
      console.error('   1. Go to Google Cloud Console > APIs & Services > Credentials');
      console.error('   2. Edit the OAuth consent screen');
      console.error('   3. Add the scope: https://www.googleapis.com/auth/calendar');
      console.error('   4. Re-authorize the application');
    }
    
    throw error;
  }
}

/**
 * Update an existing calendar event
 */
async function updateEvent(eventId, updates = {}) {
  try {
    // First get the existing event
    const existing = await calendarAPI(`/calendars/primary/events/${eventId}`);
    
    const eventBody = { ...existing };
    
    // Apply updates
    if (updates.title !== undefined) {
      const title = updates.title.startsWith('[Max]') ? updates.title : `[Max] ${updates.title}`;
      eventBody.summary = title;
    }
    
    if (updates.startDateTime !== undefined) {
      const startTime = new Date(updates.startDateTime);
      const durationMs = updates.durationMinutes ? updates.durationMinutes * 60 * 1000 : 
                        (new Date(existing.end.dateTime) - new Date(existing.start.dateTime));
      const endTime = new Date(startTime.getTime() + durationMs);
      
      eventBody.start = {
        dateTime: startTime.toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
      };
      eventBody.end = {
        dateTime: endTime.toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
      };
    } else if (updates.durationMinutes !== undefined) {
      // Update duration only
      const startTime = new Date(existing.start.dateTime);
      const endTime = new Date(startTime.getTime() + (updates.durationMinutes * 60 * 1000));
      eventBody.end = {
        dateTime: endTime.toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
      };
    }
    
    if (updates.description !== undefined) {
      eventBody.description = updates.description;
    }
    
    const result = await calendarAPI(`/calendars/primary/events/${eventId}`, 'PUT', eventBody);
    
    console.log(`\n✅ Event updated successfully!`);
    console.log(`📌 Title: ${result.summary}`);
    console.log(`📅 Time: ${formatTime(result.start.dateTime)} - ${formatTime(result.end.dateTime)}`);
    console.log(`🔗 Event ID: ${result.id}`);
    console.log();
    
    return result;
  } catch (error) {
    console.error('❌ Failed to update event:', error.message);
    throw error;
  }
}

/**
 * Delete a calendar event
 */
async function deleteEvent(eventId) {
  try {
    // First get event details for confirmation
    const event = await calendarAPI(`/calendars/primary/events/${eventId}`);
    
    await calendarAPI(`/calendars/primary/events/${eventId}`, 'DELETE');
    
    console.log(`\n✅ Event deleted successfully!`);
    console.log(`📌 Deleted: ${event.summary}`);
    console.log(`📅 Was scheduled for: ${formatTime(event.start.dateTime)} - ${formatTime(event.end.dateTime)}`);
    console.log();
    
    return { success: true, deleted: event };
  } catch (error) {
    console.error('❌ Failed to delete event:', error.message);
    throw error;
  }
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

      case 'availability': {
        const [start, end] = args;
        if (!start || !end) {
          console.log('Usage: node google-calendar.js availability <start-datetime> <end-datetime>');
          console.log('Example: node google-calendar.js availability "2024-01-15T09:00:00" "2024-01-15T17:00:00"');
          return;
        }
        await checkAvailability(start, end);
        break;
      }

      case 'create': {
        const [title, datetime, duration, description] = args;
        if (!title || !datetime) {
          console.log('Usage: node google-calendar.js create "title" <datetime> [duration-minutes] [description]');
          console.log('Example: node google-calendar.js create "Meeting with John" "2024-01-15T14:00:00" 60 "Discuss project"');
          return;
        }
        const durationMinutes = duration ? parseInt(duration) : 60;
        await createEvent(title, datetime, durationMinutes, description || '');
        break;
      }

      case 'update': {
        const [eventId, title, datetime, duration, description] = args;
        if (!eventId) {
          console.log('Usage: node google-calendar.js update <event-id> [title] [datetime] [duration-minutes] [description]');
          return;
        }
        
        const updates = {};
        if (title) updates.title = title;
        if (datetime) updates.startDateTime = datetime;
        if (duration) updates.durationMinutes = parseInt(duration);
        if (description) updates.description = description;
        
        await updateEvent(eventId, updates);
        break;
      }

      case 'delete': {
        const eventId = args[0];
        if (!eventId) {
          console.log('Usage: node google-calendar.js delete <event-id>');
          return;
        }
        await deleteEvent(eventId);
        break;
      }

      default:
        console.log(`
Google Calendar CLI Tool

Read commands:
  node google-calendar.js today              Show today's events
  node google-calendar.js tomorrow           Show tomorrow's events  
  node google-calendar.js week               Show next 7 days
  node google-calendar.js date <YYYY-MM-DD>  Show specific date
  node google-calendar.js availability <start> <end> Check availability

Write commands:
  node google-calendar.js create "title" <datetime> [duration] [description] Create event
  node google-calendar.js update <event-id> [title] [datetime] [duration] [description] Update event
  node google-calendar.js delete <event-id>  Delete event

Examples:
  node google-calendar.js create "Meeting with John" "2024-01-15T14:00:00" 60 "Discuss project"
  node google-calendar.js availability "2024-01-15T09:00:00" "2024-01-15T17:00:00"

Note: Requires calendar_refresh_token in credentials.json
Write operations require calendar write scope in Google Cloud Console
        `);
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

// If called directly, run main function
if (require.main === module) {
  main();
}

// Export functions for programmatic use
module.exports = {
  getEvents,
  checkAvailability,
  createEvent,
  updateEvent,
  deleteEvent,
  displayEvents
};
