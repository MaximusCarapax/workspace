#!/usr/bin/env node
/**
 * X/Twitter Mentions Checker
 * Check for new mentions and replies on X
 * 
 * Usage:
 *   node x-mentions.js check              # Check for new mentions
 *   node x-mentions.js check --all        # Show all recent mentions (not just new)
 *   node x-mentions.js reply <id> "text"  # Reply to a mention
 *   node x-mentions.js history            # Show mention history
 *   node x-mentions.js clear              # Clear seen mentions
 * 
 * Strategy:
 *   - Primary: Bird CLI (free, no quota)
 *   - Fallback: X API (counts against 100 reads/month)
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const db = require('../lib/db');

// Paths
const credsPath = path.join(process.env.HOME, '.openclaw/secrets/credentials.json');
const stateFile = path.join(process.env.HOME, '.openclaw/workspace/dashboard/data/x-mentions-state.json');
const envPath = path.join(process.env.HOME, '.openclaw/workspace/.env');

// Load credentials
let creds = {};
try {
  creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
} catch (e) {
  console.error('Warning: Could not load credentials.json');
}

// Load Bird CLI cookies from .env
function loadBirdCookies() {
  try {
    const env = fs.readFileSync(envPath, 'utf8');
    const authToken = env.match(/AUTH_TOKEN=(.+)/)?.[1]?.trim();
    const ct0 = env.match(/CT0=(.+)/)?.[1]?.trim();
    if (authToken && ct0) {
      return { authToken, ct0 };
    }
  } catch (e) {
    // Expected condition: .env file doesn't exist or is invalid
    // Don't log to error database
  }
  return null;
}

// Load state (last seen mention, history)
function loadState() {
  const defaultState = {
    lastSeenId: null,
    lastCheck: null,
    seenIds: [],
    history: [],
    apiUsageThisMonth: 0,
    monthKey: getMonthKey()
  };
  
  try {
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    // Merge with defaults to handle missing fields
    return { ...defaultState, ...saved };
  } catch (error) {
    // Expected condition: file doesn't exist or is invalid
    // Don't log to error database
    return defaultState;
  }
}

// Save state
function saveState(state) {
  const dir = path.dirname(stateFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

// Get current month key
function getMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// Try Bird CLI first (free, no quota)
async function checkMentionsBird() {
  const cookies = loadBirdCookies();
  if (!cookies) {
    throw new Error('Bird CLI cookies not configured');
  }

  try {
    // Bird CLI command for mentions - pass cookies as args
    const cmd = `bird --auth-token "${cookies.authToken}" --ct0 "${cookies.ct0}" mentions --json`;
    
    const result = execSync(cmd, {
      encoding: 'utf8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    const mentions = JSON.parse(result);
    
    // Format to match our standard structure
    const formatted = (Array.isArray(mentions) ? mentions : []).map(m => ({
      id: m.id,
      text: m.text,
      author: m.author?.username || 'unknown',
      authorName: m.author?.name || 'Unknown',
      createdAt: m.createdAt,
      conversationId: m.conversationId
    }));
    
    return {
      source: 'bird',
      mentions: formatted
    };
  } catch (e) {
    db.logError({
      source: 'x-mentions',
      message: e.message,
      details: 'Bird CLI command failed while checking mentions',
      stack: e.stack
    });
    throw new Error(`Bird CLI failed: ${e.message}`);
  }
}

// Fallback to X API (uses quota)
async function checkMentionsAPI(state) {
  if (!creds.x?.apiKey) {
    throw new Error('X API credentials not configured');
  }

  // Check quota
  const monthKey = getMonthKey();
  if (state.monthKey !== monthKey) {
    state.apiUsageThisMonth = 0;
    state.monthKey = monthKey;
  }
  
  if (state.apiUsageThisMonth >= 95) {
    throw new Error('X API read quota nearly exhausted (95/100 this month)');
  }

  const { TwitterApi } = require('twitter-api-v2');
  
  const client = new TwitterApi({
    appKey: creds.x.apiKey,
    appSecret: creds.x.apiSecret,
    accessToken: creds.x.accessToken,
    accessSecret: creds.x.accessTokenSecret,
  });

  try {
    // Get authenticated user ID
    const me = await client.v2.me();
    const userId = me.data.id;
    
    // Get mentions
    const mentionsResponse = await client.v2.userMentionTimeline(userId, {
      max_results: 20,
      'tweet.fields': ['created_at', 'author_id', 'conversation_id', 'in_reply_to_user_id'],
      'user.fields': ['username', 'name'],
      expansions: ['author_id']
    });
    
    state.apiUsageThisMonth++;
    saveState(state);
    
    // Handle twitter-api-v2 response structure
    const mentionsData = mentionsResponse._realData || mentionsResponse;
    const tweets = mentionsData.data || [];
    const includes = mentionsData.includes || mentionsResponse.includes || {};
    
    const users = {};
    if (includes.users) {
      includes.users.forEach(u => users[u.id] = u);
    }
    
    const formatted = tweets.map(tweet => ({
      id: tweet.id,
      text: tweet.text,
      author: users[tweet.author_id]?.username || tweet.author_id || 'unknown',
      authorName: users[tweet.author_id]?.name || 'Unknown',
      createdAt: tweet.created_at,
      conversationId: tweet.conversation_id
    }));
    
    return {
      source: 'api',
      mentions: formatted,
      quotaUsed: state.apiUsageThisMonth
    };
  } catch (e) {
    db.logError({
      source: 'x-mentions',
      message: e.message,
      details: 'X API request failed while fetching mentions',
      stack: e.stack
    });
    throw new Error(`X API failed: ${e.message}`);
  }
}

// Main check function - tries Bird first, falls back to API
async function checkMentions(showAll = false) {
  const state = loadState();
  let result;
  let usedFallback = false;
  
  // Try Bird CLI first
  try {
    result = await checkMentionsBird();
    console.log('✓ Using Bird CLI (free)');
  } catch (birdError) {
    console.log(`⚠ Bird CLI unavailable: ${birdError.message}`);
    console.log('→ Falling back to X API...');
    
    try {
      result = await checkMentionsAPI(state);
      usedFallback = true;
      console.log(`✓ Using X API (${result.quotaUsed}/100 reads this month)`);
    } catch (apiError) {
      // Log error to database
      try {
        db.logError({
          level: 'error',
          source: 'x-mentions.js',
          message: apiError.message,
          details: 'Failed to check mentions via both Bird CLI and X API',
          stack: apiError.stack
        });
      } catch (dbError) {
        console.error('Failed to log error to database:', dbError.message);
      }
      
      console.error(`✗ X API also failed: ${apiError.message}`);
      return { error: 'Both Bird CLI and X API failed', details: { birdError: birdError.message, apiError: apiError.message } };
    }
  }
  
  // Filter to new mentions only (unless --all)
  const mentions = result.mentions || [];
  let newMentions = mentions;
  
  if (!showAll && state.seenIds.length > 0) {
    newMentions = mentions.filter(m => !state.seenIds.includes(m.id));
  }
  
  // Update state
  if (mentions.length > 0) {
    const newIds = mentions.map(m => m.id);
    state.seenIds = [...new Set([...state.seenIds, ...newIds])].slice(-200); // Keep last 200
    state.lastSeenId = mentions[0]?.id || state.lastSeenId;
  }
  state.lastCheck = new Date().toISOString();
  
  // Add to history
  newMentions.forEach(m => {
    if (!state.history.find(h => h.id === m.id)) {
      state.history.unshift({
        id: m.id,
        author: m.author,
        text: m.text?.substring(0, 100),
        checkedAt: new Date().toISOString()
      });
    }
  });
  state.history = state.history.slice(0, 50); // Keep last 50
  
  saveState(state);
  
  return {
    source: result.source,
    usedFallback,
    newCount: newMentions.length,
    totalCount: mentions.length,
    mentions: newMentions,
    lastCheck: state.lastCheck
  };
}

// Reply to a mention (uses x-post.js)
async function replyToMention(tweetId, text) {
  const xPostPath = path.join(__dirname, 'x-post.js');
  
  try {
    const result = execSync(`node "${xPostPath}" reply "${tweetId}" "${text.replace(/"/g, '\\"')}"`, {
      encoding: 'utf8',
      timeout: 30000
    });
    return { success: true, output: result };
  } catch (e) {
    // Log error to database
    try {
      db.logError({
        level: 'error',
        source: 'x-mentions.js',
        message: e.message,
        details: `Failed to reply to mention ${tweetId}`,
        stack: e.stack
      });
    } catch (dbError) {
      console.error('Failed to log error to database:', dbError.message);
    }
    
    return { success: false, error: e.message };
  }
}

// Show history
function showHistory() {
  const state = loadState();
  return {
    lastCheck: state.lastCheck,
    apiUsageThisMonth: state.apiUsageThisMonth,
    monthKey: state.monthKey,
    historyCount: state.history.length,
    history: state.history.slice(0, 20)
  };
}

// Clear seen mentions
function clearSeen() {
  const state = loadState();
  state.seenIds = [];
  state.lastSeenId = null;
  saveState(state);
  return { success: true, message: 'Cleared seen mentions' };
}

// CLI
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  try {
    switch (command) {
      case 'check': {
        const showAll = args.includes('--all');
        const result = await checkMentions(showAll);
        console.log(JSON.stringify(result, null, 2));
        break;
      }
      
      case 'reply': {
        const tweetId = args[1];
        const text = args.slice(2).join(' ');
        if (!tweetId || !text) {
          console.error('Usage: x-mentions.js reply <tweet_id> "text"');
          process.exit(1);
        }
        const result = await replyToMention(tweetId, text);
        console.log(JSON.stringify(result, null, 2));
        break;
      }
      
      case 'history': {
        const result = showHistory();
        console.log(JSON.stringify(result, null, 2));
        break;
      }
      
      case 'clear': {
        const result = clearSeen();
        console.log(JSON.stringify(result, null, 2));
        break;
      }
      
      default:
        console.log(`
X/Twitter Mentions Checker

Usage:
  node x-mentions.js check              # Check for new mentions
  node x-mentions.js check --all        # Show all recent mentions
  node x-mentions.js reply <id> "text"  # Reply to a mention
  node x-mentions.js history            # Show mention history
  node x-mentions.js clear              # Clear seen mentions

Strategy: Bird CLI (free) → X API fallback (100 reads/month)
      `);
    }
  } catch (error) {
    console.error('Error:', error.message);
    
    // Log error to database
    try {
      db.logError({
        level: 'error',
        source: 'x-mentions.js',
        message: error.message,
        details: `Command: ${command}`,
        stack: error.stack
      });
    } catch (dbError) {
      console.error('Failed to log error to database:', dbError.message);
    }
    
    process.exit(1);
  }
}

main().catch(console.error);
