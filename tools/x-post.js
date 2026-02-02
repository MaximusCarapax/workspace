#!/usr/bin/env node
/**
 * X/Twitter Posting Tool
 * Create posts, threads, and manage content on X
 * 
 * Usage:
 *   node x-post.js post "Your tweet text"          # Post a tweet
 *   node x-post.js thread "Line 1" "Line 2" ...    # Post a thread
 *   node x-post.js reply <tweet_id> "text"         # Reply to a tweet
 *   node x-post.js quote <tweet_id> "text"         # Quote tweet
 *   node x-post.js delete <tweet_id>               # Delete a tweet
 *   node x-post.js stats                           # Show posting stats
 *   node x-post.js test                            # Dry run (no actual post)
 * 
 * Free Tier Limits (as of 2025):
 *   - 500 posts/month
 *   - 100 read requests/month
 *   - Likes/Follows: NOT allowed on free tier
 */

const { TwitterApi } = require('twitter-api-v2');
const fs = require('fs');
const path = require('path');

// Load credentials
const credsPath = path.join(process.env.HOME, '.openclaw/secrets/credentials.json');
const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));

// Stats tracking file
const statsFile = path.join(process.env.HOME, '.openclaw/workspace/dashboard/data/x-post-stats.json');

// Initialize client with OAuth 1.0a (required for posting)
const client = new TwitterApi({
  appKey: creds.x.apiKey,
  appSecret: creds.x.apiSecret,
  accessToken: creds.x.accessToken,
  accessSecret: creds.x.accessTokenSecret,
});

// Twitter character limit
const MAX_CHARS = 280;

// Load posting stats
function loadStats() {
  try {
    return JSON.parse(fs.readFileSync(statsFile, 'utf8'));
  } catch {
    return {
      totalPosts: 0,
      monthlyPosts: {},
      lastPost: null,
      posts: []
    };
  }
}

// Save posting stats
function saveStats(stats) {
  const dir = path.dirname(statsFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(statsFile, JSON.stringify(stats, null, 2));
}

// Get current month key
function getMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// Track a new post
function trackPost(tweetId, text, type = 'post') {
  const stats = loadStats();
  const monthKey = getMonthKey();
  
  stats.totalPosts++;
  stats.monthlyPosts[monthKey] = (stats.monthlyPosts[monthKey] || 0) + 1;
  stats.lastPost = new Date().toISOString();
  stats.posts.push({
    id: tweetId,
    text: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
    type,
    timestamp: new Date().toISOString()
  });
  
  // Keep only last 50 posts in history
  if (stats.posts.length > 50) {
    stats.posts = stats.posts.slice(-50);
  }
  
  saveStats(stats);
  return stats;
}

// Validate tweet text
function validateTweet(text) {
  if (!text || text.trim().length === 0) {
    throw new Error('Tweet text cannot be empty');
  }
  if (text.length > MAX_CHARS) {
    throw new Error(`Tweet exceeds ${MAX_CHARS} characters (got ${text.length})`);
  }
  return text.trim();
}

// Post a single tweet
async function postTweet(text, options = {}) {
  const validated = validateTweet(text);
  
  if (options.dryRun) {
    console.log('🔍 DRY RUN - Would post:');
    console.log(`"${validated}"`);
    console.log(`Length: ${validated.length}/${MAX_CHARS}`);
    return { dryRun: true, text: validated };
  }
  
  try {
    const params = { text: validated };
    
    // If replying to a tweet
    if (options.replyTo) {
      params.reply = { in_reply_to_tweet_id: options.replyTo };
    }
    
    // If quoting a tweet
    if (options.quoteTweet) {
      params.quote_tweet_id = options.quoteTweet;
    }
    
    const result = await client.v2.tweet(params);
    const tweetUrl = `https://x.com/MaximusCarapax/status/${result.data.id}`;
    
    console.log(`✅ Posted: ${tweetUrl}`);
    console.log(`📝 Text: "${validated}"`);
    
    trackPost(result.data.id, validated, options.replyTo ? 'reply' : options.quoteTweet ? 'quote' : 'post');
    
    return {
      success: true,
      id: result.data.id,
      url: tweetUrl,
      text: validated
    };
  } catch (e) {
    console.error('❌ Failed to post:', e.message);
    if (e.data) {
      console.error('API Error:', JSON.stringify(e.data, null, 2));
    }
    throw e;
  }
}

// Post a thread (multiple tweets)
async function postThread(tweets, options = {}) {
  if (!Array.isArray(tweets) || tweets.length === 0) {
    throw new Error('Thread must be an array of tweets');
  }
  
  // Validate all tweets first
  const validated = tweets.map((t, i) => {
    try {
      return validateTweet(t);
    } catch (e) {
      throw new Error(`Tweet ${i + 1}: ${e.message}`);
    }
  });
  
  if (options.dryRun) {
    console.log('🔍 DRY RUN - Would post thread:');
    validated.forEach((t, i) => {
      console.log(`\n${i + 1}/${validated.length}: "${t}"`);
      console.log(`   Length: ${t.length}/${MAX_CHARS}`);
    });
    return { dryRun: true, tweets: validated };
  }
  
  const posted = [];
  let lastId = null;
  
  for (let i = 0; i < validated.length; i++) {
    const params = { text: validated[i] };
    
    // Chain to previous tweet
    if (lastId) {
      params.reply = { in_reply_to_tweet_id: lastId };
    }
    
    try {
      const result = await client.v2.tweet(params);
      lastId = result.data.id;
      posted.push({
        id: result.data.id,
        url: `https://x.com/MaximusCarapax/status/${result.data.id}`,
        text: validated[i]
      });
      
      console.log(`✅ ${i + 1}/${validated.length}: ${posted[i].url}`);
      
      trackPost(result.data.id, validated[i], 'thread');
      
      // Small delay between tweets to avoid rate limits
      if (i < validated.length - 1) {
        await new Promise(r => setTimeout(r, 1000));
      }
    } catch (e) {
      console.error(`❌ Failed at tweet ${i + 1}:`, e.message);
      console.log('Posted so far:', posted.length);
      throw e;
    }
  }
  
  console.log(`\n🧵 Thread posted! ${posted.length} tweets`);
  console.log(`First: ${posted[0].url}`);
  
  return {
    success: true,
    tweets: posted
  };
}

// Delete a tweet
async function deleteTweet(tweetId) {
  try {
    await client.v2.deleteTweet(tweetId);
    console.log(`🗑️  Deleted tweet: ${tweetId}`);
    return { success: true, deleted: tweetId };
  } catch (e) {
    console.error('❌ Failed to delete:', e.message);
    throw e;
  }
}

// Show posting statistics
function showStats() {
  const stats = loadStats();
  const monthKey = getMonthKey();
  const monthlyCount = stats.monthlyPosts[monthKey] || 0;
  const remaining = 500 - monthlyCount;
  
  console.log('📊 X Posting Statistics');
  console.log('========================');
  console.log(`Total posts (all time): ${stats.totalPosts}`);
  console.log(`Posts this month: ${monthlyCount}/500`);
  console.log(`Remaining: ${remaining}`);
  console.log(`Last post: ${stats.lastPost || 'Never'}`);
  
  if (stats.posts.length > 0) {
    console.log('\n📜 Recent posts:');
    stats.posts.slice(-5).forEach(p => {
      console.log(`  [${p.type}] ${p.timestamp.split('T')[0]}: "${p.text}"`);
    });
  }
  
  return stats;
}

// CLI
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  try {
    switch (command) {
      case 'post': {
        const text = args.slice(1).join(' ');
        await postTweet(text);
        break;
      }
      
      case 'thread': {
        const tweets = args.slice(1);
        await postThread(tweets);
        break;
      }
      
      case 'reply': {
        const tweetId = args[1];
        const text = args.slice(2).join(' ');
        if (!tweetId || !text) {
          console.log('Usage: node x-post.js reply <tweet_id> "reply text"');
          process.exit(1);
        }
        await postTweet(text, { replyTo: tweetId });
        break;
      }
      
      case 'quote': {
        const tweetId = args[1];
        const text = args.slice(2).join(' ');
        if (!tweetId || !text) {
          console.log('Usage: node x-post.js quote <tweet_id> "your comment"');
          process.exit(1);
        }
        await postTweet(text, { quoteTweet: tweetId });
        break;
      }
      
      case 'delete': {
        const tweetId = args[1];
        if (!tweetId) {
          console.log('Usage: node x-post.js delete <tweet_id>');
          process.exit(1);
        }
        await deleteTweet(tweetId);
        break;
      }
      
      case 'stats': {
        showStats();
        break;
      }
      
      case 'test': {
        const text = args.slice(1).join(' ') || 'This is a test tweet from Maximus 🤖';
        await postTweet(text, { dryRun: true });
        break;
      }
      
      default:
        console.log(`X/Twitter Posting Tool (@MaximusCarapax)
        
Usage:
  node x-post.js post "Your tweet text"          Post a tweet
  node x-post.js thread "Line 1" "Line 2" ...    Post a thread
  node x-post.js reply <tweet_id> "text"         Reply to a tweet
  node x-post.js quote <tweet_id> "text"         Quote tweet
  node x-post.js delete <tweet_id>               Delete a tweet
  node x-post.js stats                           Show posting stats
  node x-post.js test "text"                     Dry run (no actual post)

Free Tier Limits (2025):
  - 500 posts/month
  - Likes/Follows NOT allowed on free tier
`);
    }
  } catch (e) {
    process.exit(1);
  }
}

main();
