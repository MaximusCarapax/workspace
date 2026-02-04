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
const db = require('../lib/db');

// Load credentials
const credsPath = path.join(process.env.HOME, '.openclaw/secrets/credentials.json');
const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));

// Legacy stats file (for migration)
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

// Migrate legacy stats file to SQLite (run once)
function migrateLegacyStats() {
  try {
    if (!fs.existsSync(statsFile)) return 0;
    const stats = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
    let migrated = 0;
    for (const post of (stats.posts || [])) {
      try {
        db.trackSocialPost({
          platform: 'x',
          postId: post.id,
          postType: post.type || 'post',
          content: post.text,
          url: post.id ? `https://x.com/MaximusCarapax/status/${post.id}` : null
        });
        migrated++;
      } catch (e) {
        // Skip duplicates or errors
      }
    }
    // Rename old file to mark as migrated
    if (migrated > 0) {
      fs.renameSync(statsFile, statsFile + '.migrated');
    }
    return migrated;
  } catch {
    return 0;
  }
}

// Track a new post (uses SQLite)
function trackPost(tweetId, text, type = 'post', replyTo = null) {
  const url = `https://x.com/MaximusCarapax/status/${tweetId}`;
  db.trackSocialPost({
    platform: 'x',
    postId: tweetId,
    postType: type,
    content: text,
    url: url,
    inReplyTo: replyTo
  });
  return { id: tweetId, url };
}

// Check for duplicate/similar content (uses SQLite)
function checkDuplicate(text, threshold = 0.6) {
  const result = db.checkSocialDuplicate('x', text, threshold);
  if (result.isDuplicate && result.matchedPost) {
    // Format for display
    return {
      isDuplicate: true,
      similarity: result.similarity,
      matchedPost: {
        text: result.matchedPost.content,
        timestamp: result.matchedPost.created_at
      }
    };
  }
  return { isDuplicate: false };
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
  
  // Check for duplicates (unless explicitly skipped)
  if (!options.skipDupeCheck) {
    const dupeCheck = checkDuplicate(validated);
    if (dupeCheck.isDuplicate) {
      console.log(`⚠️  DUPLICATE DETECTED (${dupeCheck.similarity} similar)`);
      console.log(`📝 New: "${validated.substring(0, 60)}..."`);
      console.log(`📝 Old: "${dupeCheck.matchedPost.text}"`);
      console.log(`🕐 Posted: ${dupeCheck.matchedPost.timestamp}`);
      
      if (!options.forceDupe) {
        console.log('\n❌ Blocked duplicate post. Use --force to override.');
        return { blocked: true, reason: 'duplicate', similarity: dupeCheck.similarity };
      }
      console.log('\n⚠️  Forcing duplicate post (--force flag used)');
    }
  }
  
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
    
    trackPost(result.data.id, validated, options.replyTo ? 'reply' : options.quoteTweet ? 'quote' : 'post', options.replyTo);
    
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

// Show posting statistics (uses SQLite)
function showStats() {
  const stats = db.getSocialStats('x');
  const remaining = 500 - stats.postsThisMonth;
  
  console.log('📊 X Posting Statistics');
  console.log('========================');
  console.log(`Total posts (all time): ${stats.totalPosts}`);
  console.log(`Posts this month: ${stats.postsThisMonth}/500`);
  console.log(`Remaining: ${remaining}`);
  console.log(`Last post: ${stats.lastPost ? stats.lastPost.created_at : 'Never'}`);
  
  const recentPosts = db.getRecentSocialPosts('x', 5);
  if (recentPosts.length > 0) {
    console.log('\n📜 Recent posts:');
    recentPosts.forEach(p => {
      const truncated = p.content.substring(0, 80) + (p.content.length > 80 ? '...' : '');
      console.log(`  [${p.post_type}] ${p.created_at.split('T')[0]}: "${truncated}"`);
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
        const hasForce = args.includes('--force');
        const filteredArgs = args.slice(1).filter(a => a !== '--force');
        const text = filteredArgs.join(' ');
        await postTweet(text, { forceDupe: hasForce });
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
      
      case 'migrate': {
        const count = migrateLegacyStats();
        console.log(`✅ Migrated ${count} posts from legacy JSON to SQLite`);
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
