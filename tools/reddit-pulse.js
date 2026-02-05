#!/usr/bin/env node
/**
 * Reddit Pulse - Track trends and sentiment across subreddits
 * 
 * Usage:
 *   node reddit-pulse.js check                    # Quick pulse check
 *   node reddit-pulse.js check -s ai,openai       # Specific subreddits
 *   node reddit-pulse.js trending                 # What's hot right now
 *   node reddit-pulse.js analyze "topic"          # Deep dive on a topic
 *   node reddit-pulse.js history                  # Show recent pulses
 */

const fs = require('fs');
const path = require('path');

// Config
const CONFIG = {
  defaultSubreddits: ['artificial', 'openai', 'LocalLLaMA', 'singularity', 'ChatGPT', 'MachineLearning'],
  postsPerSubreddit: 10,
  historyFile: path.join(__dirname, '../dashboard/data/reddit-pulse-history.json'),
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

// Load env vars from .env file
function loadEnv() {
  const envPath = path.join(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const match = line.match(/^([A-Z_]+)=(.+)$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].trim();
      }
    });
  }
}

// Gemini via OpenRouter (no rate limits)
async function callGemini(prompt) {
  loadEnv();
  
  // Get OpenRouter API key
  let apiKey = process.env.OPENROUTER_API_KEY;
  
  // Try loading from secrets file if not in env
  if (!apiKey) {
    try {
      const secretsPath = path.join(process.env.HOME, '.openclaw/secrets/openrouter.json');
      if (fs.existsSync(secretsPath)) {
        const secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
        apiKey = secrets.apiKey || secrets.OPENROUTER_API_KEY;
      }
    } catch (e) {}
  }
  
  if (!apiKey) {
    throw new Error('No OPENROUTER_API_KEY found in .env or secrets');
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://openclaw.ai',
      'X-Title': 'OpenClaw Reddit Pulse'
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash-lite',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 2000
    })
  });

  const data = await response.json();
  
  if (data.error) {
    throw new Error(data.error.message || JSON.stringify(data.error));
  }
  
  return data.choices?.[0]?.message?.content || '';
}

// Parse simple XML (no external deps)
function parseRSSItems(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  
  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1];
    const title = item.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1') || '';
    const link = item.match(/<link>([\s\S]*?)<\/link>/)?.[1] || '';
    const pubDate = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || '';
    
    items.push({ title: title.trim(), link: link.trim(), pubDate });
  }
  
  return items;
}

// Fetch posts from a subreddit via RSS (still works without auth)
async function fetchSubreddit(subreddit, limit = 10, sort = 'hot') {
  // RSS feeds still work! Use .rss endpoint
  const url = `https://www.reddit.com/r/${subreddit}/${sort}.rss?limit=${limit}`;
  
  try {
    const response = await fetch(url, {
      headers: { 
        'User-Agent': CONFIG.userAgent,
        'Accept': 'application/rss+xml, application/xml, text/xml'
      }
    });
    
    if (!response.ok) {
      // Try alternative: JSON via cors proxy or direct
      console.error(`RSS failed for r/${subreddit}: ${response.status}, trying JSON...`);
      return await fetchSubredditJSON(subreddit, limit, sort);
    }
    
    const xml = await response.text();
    const items = parseRSSItems(xml);
    
    return items.slice(0, limit).map(item => ({
      subreddit,
      title: item.title,
      score: 0, // RSS doesn't include score
      comments: 0,
      url: item.link,
      created: item.pubDate ? new Date(item.pubDate).toISOString() : null,
      flair: null,
      selftext: null
    }));
  } catch (err) {
    console.error(`Error fetching r/${subreddit}:`, err.message);
    return [];
  }
}

// Fallback: try JSON endpoint (may work for some subreddits)
async function fetchSubredditJSON(subreddit, limit = 10, sort = 'hot') {
  const url = `https://www.reddit.com/r/${subreddit}/${sort}.json?limit=${limit}&raw_json=1`;
  
  try {
    const response = await fetch(url, {
      headers: { 
        'User-Agent': CONFIG.userAgent,
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) return [];
    
    const data = await response.json();
    return data.data.children.map(post => ({
      subreddit,
      title: post.data.title,
      score: post.data.score,
      comments: post.data.num_comments,
      url: `https://reddit.com${post.data.permalink}`,
      created: new Date(post.data.created_utc * 1000).toISOString(),
      flair: post.data.link_flair_text || null,
      selftext: post.data.selftext?.slice(0, 500) || null
    }));
  } catch (err) {
    return [];
  }
}

// Fetch from multiple subreddits
async function fetchAllSubreddits(subreddits, limit = 10) {
  const results = [];
  
  for (const sub of subreddits) {
    // Small delay to be nice to Reddit
    await new Promise(r => setTimeout(r, 500));
    const posts = await fetchSubreddit(sub, limit);
    results.push(...posts);
  }
  
  // If direct Reddit access failed, try Brave Search fallback
  if (results.length === 0) {
    console.log('Direct Reddit access blocked. Using Brave Search fallback...\n');
    return await fetchViaBraveSearch(subreddits);
  }
  
  return results;
}

// Fallback: Use Brave Search to find Reddit discussions
async function fetchViaBraveSearch(subreddits) {
  let braveKey = process.env.BRAVE_API_KEY;
  if (!braveKey) {
    // Try loading from gateway config (openclaw.json)
    try {
      const configPath = '/home/node/.openclaw/openclaw.json';
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        braveKey = config?.tools?.web?.search?.apiKey;
        if (braveKey) process.env.BRAVE_API_KEY = braveKey;
      }
    } catch (e) {}
  }
  
  if (!process.env.BRAVE_API_KEY) {
    console.log('No BRAVE_API_KEY set. Cannot use search fallback.');
    console.log('Set up Reddit OAuth or run from a residential IP.');
    return [];
  }
  
  const results = [];
  const query = `site:reddit.com (${subreddits.map(s => `r/${s}`).join(' OR ')})`;
  
  try {
    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=20&freshness=pw`,
      {
        headers: {
          'X-Subscription-Token': process.env.BRAVE_API_KEY,
          'Accept': 'application/json'
        }
      }
    );
    
    if (!response.ok) {
      console.log(`Brave Search failed: ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    
    for (const result of (data.web?.results || [])) {
      if (result.url.includes('reddit.com/r/')) {
        // Extract subreddit from URL
        const subMatch = result.url.match(/reddit\.com\/r\/([^\/]+)/);
        const subreddit = subMatch ? subMatch[1] : 'unknown';
        
        results.push({
          subreddit,
          title: result.title.replace(/ : .*$/, '').replace(/ - Reddit$/, ''),
          score: 0,
          comments: 0,
          url: result.url,
          created: null,
          flair: null,
          selftext: result.description?.slice(0, 500) || null
        });
      }
    }
    
    console.log(`Found ${results.length} Reddit posts via Brave Search\n`);
  } catch (err) {
    console.error('Brave Search error:', err.message);
  }
  
  return results;
}

// Analyze posts with Gemini
async function analyzePosts(posts) {
  if (posts.length === 0) return { error: 'No posts to analyze' };
  
  const postSummaries = posts
    .sort((a, b) => b.score - a.score)
    .slice(0, 30)
    .map(p => `[r/${p.subreddit}] (${p.score}↑) ${p.title}`)
    .join('\n');

  const prompt = `Analyze these Reddit posts from AI/tech subreddits. Give me:

1. **Top 3 Themes** - What topics are people talking about most?
2. **Sentiment** - Overall mood (excited/neutral/concerned/mixed)
3. **Hot Takes** - Any controversial or notable opinions?
4. **Emerging Trends** - Anything new gaining traction?
5. **One-liner Summary** - TL;DR in one sentence

Posts:
${postSummaries}

Be concise and direct. Use bullet points.`;

  const analysis = await callGemini(prompt);
  return {
    timestamp: new Date().toISOString(),
    postCount: posts.length,
    topPosts: posts.sort((a, b) => b.score - a.score).slice(0, 5),
    analysis
  };
}

// Save pulse to history
function savePulse(pulse) {
  const dir = path.dirname(CONFIG.historyFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  
  let history = [];
  if (fs.existsSync(CONFIG.historyFile)) {
    history = JSON.parse(fs.readFileSync(CONFIG.historyFile, 'utf8'));
  }
  
  history.unshift(pulse);
  history = history.slice(0, 50); // Keep last 50 pulses
  
  fs.writeFileSync(CONFIG.historyFile, JSON.stringify(history, null, 2));
}

// Commands
async function cmdCheck(subreddits) {
  const subs = subreddits || CONFIG.defaultSubreddits;
  console.log(`\n🔍 Checking pulse across ${subs.length} subreddits...\n`);
  
  const posts = await fetchAllSubreddits(subs, CONFIG.postsPerSubreddit);
  console.log(`📊 Fetched ${posts.length} posts\n`);
  
  if (posts.length === 0) {
    console.log('No posts found. Check your internet connection or subreddit names.');
    return;
  }
  
  console.log('🧠 Analyzing with Gemini...\n');
  const pulse = await analyzePosts(posts);
  pulse.subreddits = subs;
  
  savePulse(pulse);
  
  console.log('═'.repeat(60));
  console.log('📡 REDDIT PULSE');
  console.log('═'.repeat(60));
  console.log(`\nSubreddits: ${subs.join(', ')}`);
  console.log(`Posts analyzed: ${pulse.postCount}`);
  console.log(`Time: ${new Date().toLocaleString()}\n`);
  console.log('─'.repeat(60));
  console.log('\n' + pulse.analysis);
  console.log('\n' + '─'.repeat(60));
  console.log('\n🔥 TOP POSTS:\n');
  pulse.topPosts.forEach((p, i) => {
    console.log(`${i + 1}. [${p.score}↑] r/${p.subreddit}`);
    console.log(`   ${p.title}`);
    console.log(`   ${p.url}\n`);
  });
  
  return pulse;
}

async function cmdTrending() {
  // Check r/all for what's generally trending
  console.log('\n🔥 Checking Reddit trending...\n');
  
  const posts = await fetchSubreddit('all', 25, 'hot');
  const techPosts = posts.filter(p => 
    ['technology', 'programming', 'artificial', 'openai', 'chatgpt', 'tech', 'science', 'futurology']
    .some(sub => p.subreddit.toLowerCase().includes(sub) || p.title.toLowerCase().includes('ai'))
  );
  
  console.log(`Found ${techPosts.length} tech-related posts in r/all top 25\n`);
  
  if (techPosts.length > 0) {
    techPosts.forEach((p, i) => {
      console.log(`${i + 1}. [${p.score}↑] r/${p.subreddit}`);
      console.log(`   ${p.title}\n`);
    });
  } else {
    console.log('No major tech posts in r/all right now.');
    console.log('Run "node reddit-pulse.js check" for AI-specific subreddits.');
  }
}

async function cmdAnalyze(topic) {
  if (!topic) {
    console.log('Usage: node reddit-pulse.js analyze "topic"');
    return;
  }
  
  console.log(`\n🔍 Deep dive on: "${topic}"\n`);
  
  // Search Reddit for the topic
  const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(topic)}&sort=relevance&t=week&limit=25`;
  
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': CONFIG.userAgent }
    });
    const data = await response.json();
    const posts = data.data.children.map(post => ({
      subreddit: post.data.subreddit,
      title: post.data.title,
      score: post.data.score,
      comments: post.data.num_comments,
      url: `https://reddit.com${post.data.permalink}`
    }));
    
    console.log(`Found ${posts.length} posts about "${topic}"\n`);
    
    if (posts.length > 0) {
      const analysis = await analyzePosts(posts);
      console.log(analysis.analysis);
      console.log('\n🔥 TOP POSTS:\n');
      analysis.topPosts.forEach((p, i) => {
        console.log(`${i + 1}. [${p.score}↑] r/${p.subreddit}: ${p.title}`);
      });
    }
  } catch (err) {
    console.error('Search failed:', err.message);
  }
}

function cmdHistory() {
  if (!fs.existsSync(CONFIG.historyFile)) {
    console.log('No pulse history yet. Run "node reddit-pulse.js check" first.');
    return;
  }
  
  const history = JSON.parse(fs.readFileSync(CONFIG.historyFile, 'utf8'));
  console.log(`\n📜 PULSE HISTORY (${history.length} entries)\n`);
  console.log('─'.repeat(60));
  
  history.slice(0, 10).forEach((pulse, i) => {
    const date = new Date(pulse.timestamp).toLocaleString();
    console.log(`\n${i + 1}. ${date}`);
    console.log(`   Subreddits: ${pulse.subreddits?.join(', ') || 'default'}`);
    console.log(`   Posts: ${pulse.postCount}`);
    // Extract one-liner if present
    const oneLiner = pulse.analysis?.match(/One-liner.*?:(.*?)(?:\n|$)/i)?.[1]?.trim();
    if (oneLiner) console.log(`   TL;DR: ${oneLiner}`);
  });
}

function showHelp() {
  console.log(`
Reddit Pulse - Track trends and sentiment

Commands:
  check                     Pulse check on default AI subreddits
  check -s sub1,sub2        Pulse check on specific subreddits
  trending                  What's hot on Reddit right now
  analyze "topic"           Deep dive on a specific topic
  history                   Show recent pulse checks

Examples:
  node reddit-pulse.js check
  node reddit-pulse.js check -s startups,entrepreneur
  node reddit-pulse.js analyze "GPT-5"
  node reddit-pulse.js trending
`);
}

// Main
async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  
  try {
    switch (cmd) {
      case 'check': {
        let subs = null;
        const subIdx = args.indexOf('-s');
        if (subIdx !== -1 && args[subIdx + 1]) {
          subs = args[subIdx + 1].split(',').map(s => s.trim());
        }
        await cmdCheck(subs);
        break;
      }
      case 'trending':
        await cmdTrending();
        break;
      case 'analyze':
        await cmdAnalyze(args.slice(1).join(' '));
        break;
      case 'history':
        cmdHistory();
        break;
      default:
        showHelp();
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
