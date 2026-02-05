#!/usr/bin/env node
/**
 * LinkedIn Tool - Stealth browser automation for engagement
 * 
 * Profile: https://www.linkedin.com/in/maximus-carapax/
 * 
 * Usage:
 *   node linkedin.js help                    # Show all commands
 *   node linkedin.js feed                    # View feed summary
 *   node linkedin.js list                    # List feed posts with index (for like/comment)
 *   node linkedin.js like <index>            # Like a post from feed
 *   node linkedin.js comment <index> "text"  # Comment on a post
 *   node linkedin.js post "text"             # Create a post
 *   node linkedin.js profile [url]           # View profile
 *   node linkedin.js follow <url>            # Follow a profile
 *   node linkedin.js search <query>          # Search for posts/people
 */

const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const fs = require('fs');
const path = require('path');
const db = require('../lib/db');

chromium.use(stealth);

const COOKIES_PATH = '/tmp/linkedin-cookies.json';
const FEED_CACHE_PATH = '/tmp/linkedin-feed-cache.json';
const CREDENTIALS_PATH = path.join(process.env.HOME, '.openclaw/secrets/credentials.json');

let credentials = {};
try {
  credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
} catch (error) {
  // Expected condition: credentials file doesn't exist or is invalid
  // Don't log to error database
}

async function getBrowser() {
  return await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
}

async function getPage(browser) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 }
  });
  
  if (fs.existsSync(COOKIES_PATH)) {
    try {
      const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf8'));
      await context.addCookies(cookies);
    } catch (e) {}
  }
  
  return await context.newPage();
}

async function saveCookies(context) {
  const cookies = await context.cookies();
  fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
}

async function login(page) {
  console.log('🔐 Logging in to LinkedIn...');
  
  await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });
  
  const email = credentials.linkedin?.email || 'maximuscarapax@gmail.com';
  const password = credentials.linkedin?.password;
  
  if (!password) {
    console.error('❌ LinkedIn password not found in credentials.json');
    process.exit(1);
  }
  
  await page.fill('#username', email);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');
  
  await page.waitForTimeout(3000);
  
  if (page.url().includes('challenge') || page.url().includes('checkpoint')) {
    console.error('❌ LinkedIn security challenge detected. Need manual login.');
    process.exit(1);
  }
  
  await saveCookies(page.context());
  console.log('✅ Logged in successfully');
}

async function ensureLoggedIn(page) {
  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  
  if (page.url().includes('login') || page.url().includes('authwall')) {
    await login(page);
    await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
  }
}

// Save feed posts for later reference (like/comment by index)
function saveFeedCache(posts) {
  fs.writeFileSync(FEED_CACHE_PATH, JSON.stringify({ 
    posts, 
    timestamp: Date.now() 
  }, null, 2));
}

function loadFeedCache() {
  try {
    const cache = JSON.parse(fs.readFileSync(FEED_CACHE_PATH, 'utf8'));
    // Cache valid for 30 minutes
    if (Date.now() - cache.timestamp < 30 * 60 * 1000) {
      return cache.posts;
    }
  } catch (e) {}
  return null;
}

async function listFeed() {
  const browser = await getBrowser();
  try {
    const page = await getPage(browser);
    await ensureLoggedIn(page);
    
    console.log('📰 Fetching LinkedIn Feed...\n');
    
    // Wait for feed to load and scroll to load more posts
    await page.waitForTimeout(3000);
    await page.evaluate(() => window.scrollBy(0, 1000));
    await page.waitForTimeout(2000);
    
    // Get feed posts using LinkedIn's current structure (2025)
    const posts = await page.evaluate(() => {
      // Posts are in elements with data-view-name="feed-full-update"
      const postContainers = document.querySelectorAll('[data-view-name="feed-full-update"]');
      
      return Array.from(postContainers).slice(0, 10).map((container, idx) => {
        // Get tracking ID from parent element (used as unique identifier)
        let trackingId = null;
        let parent = container;
        for (let i = 0; i < 5 && parent; i++) {
          parent = parent.parentElement;
          const scope = parent?.getAttribute('data-view-tracking-scope');
          if (scope) {
            try {
              const parsed = JSON.parse(scope);
              trackingId = parsed[0]?.contentTrackingId || null;
            } catch (e) {}
            break;
          }
        }
        
        // Get author from profile link
        const profileLink = container.querySelector('a[href*="/in/"], a[href*="/company/"]');
        let authorUrl = profileLink?.href || null;
        
        // Get author name - try multiple approaches
        let author = 'Unknown';
        
        // Approach 1: Look for "Follow X" button to get name
        const followButton = container.querySelector('button[aria-label^="Follow "]');
        if (followButton) {
          const label = followButton.getAttribute('aria-label');
          author = label.replace('Follow ', '').trim();
        }
        
        // Approach 2: Extract from profile link text
        if (author === 'Unknown' && profileLink) {
          // Find visible text near the link
          const linkText = profileLink.textContent?.trim();
          if (linkText && linkText.length > 0 && linkText.length < 100) {
            author = linkText.split('\n')[0].trim();
          }
        }
        
        // Approach 3: Extract from URL
        if (author === 'Unknown' && authorUrl) {
          const match = authorUrl.match(/\/in\/([^\/]+)/);
          if (match) {
            author = match[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          }
        }
        
        // Get post text - find spans with substantial content
        let postText = '';
        const allSpans = container.querySelectorAll('span');
        for (const span of allSpans) {
          const text = span.textContent?.trim();
          // Look for text that's substantial and not UI elements
          if (text && text.length > 40 && 
              !text.includes('LinkedIn') && 
              !text.includes('Follow') &&
              !text.includes('Feed post') &&
              !text.includes('Reaction') &&
              !text.includes('comments')) {
            postText = text;
            break;
          }
        }
        
        // Check if post is liked
        const likeButton = container.querySelector('button[aria-label*="Reaction button state"]');
        const isLiked = likeButton?.getAttribute('aria-label')?.includes('reacted') || false;
        
        // Get headline/description (author's title)
        let headline = '';
        const actorDesc = container.querySelector('[data-view-name="feed-actor-description"]');
        if (actorDesc) {
          headline = actorDesc.textContent?.trim()?.substring(0, 60) || '';
        }
        
        return { 
          index: idx + 1,
          trackingId,
          authorUrl,
          author: author.substring(0, 50),
          headline: headline.substring(0, 60),
          text: postText.substring(0, 150),
          liked: isLiked
        };
      });
    });
    
    if (posts.length === 0) {
      console.log('Could not parse feed. LinkedIn may have updated their layout.');
      console.log('Try running: node tools/linkedin-debug4.js for diagnostics');
      return;
    }
    
    // Save cache for like/comment commands
    saveFeedCache(posts);
    
    posts.forEach(post => {
      const likeStatus = post.liked ? '❤️' : '○';
      console.log(`[${post.index}] ${likeStatus} ${post.author}`);
      if (post.headline) console.log(`    ${post.headline}`);
      console.log(`    "${post.text}${post.text.length >= 150 ? '...' : ''}"`);
      console.log('');
    });
    
    console.log('─'.repeat(50));
    console.log('Use: node linkedin.js like <index>');
    console.log('Use: node linkedin.js comment <index> "your comment"');
    
    await saveCookies(page.context());
  } finally {
    await browser.close();
  }
}

async function likePost(index) {
  const cache = loadFeedCache();
  if (!cache) {
    console.error('❌ Feed cache expired. Run "node linkedin.js list" first.');
    process.exit(1);
  }
  
  const post = cache.find(p => p.index === parseInt(index));
  if (!post) {
    console.error(`❌ Post #${index} not found. Run "node linkedin.js list" to see posts.`);
    process.exit(1);
  }
  
  const browser = await getBrowser();
  try {
    const page = await getPage(browser);
    await ensureLoggedIn(page);
    
    console.log(`👍 Liking post by ${post.author}...`);
    
    // Wait for feed to load
    await page.waitForTimeout(3000);
    await page.evaluate(() => window.scrollBy(0, 1000));
    await page.waitForTimeout(2000);
    
    // Find the post by index and click like button
    const success = await page.evaluate((targetIndex) => {
      const postContainers = document.querySelectorAll('[data-view-name="feed-full-update"]');
      const targetPost = postContainers[targetIndex - 1];
      
      if (!targetPost) return { success: false, error: 'Post not found' };
      
      // Find like button within this post
      const likeButton = targetPost.querySelector('button[aria-label*="Reaction button state"]');
      
      if (!likeButton) return { success: false, error: 'Like button not found' };
      
      // Check if already liked
      if (likeButton.getAttribute('aria-label')?.includes('reacted')) {
        return { success: true, alreadyLiked: true };
      }
      
      likeButton.click();
      return { success: true };
    }, parseInt(index));
    
    if (!success.success) {
      console.error(`❌ ${success.error}`);
      process.exit(1);
    }
    
    if (success.alreadyLiked) {
      console.log(`ℹ️ Already liked post by ${post.author}`);
    } else {
      await page.waitForTimeout(1500);
      console.log(`✅ Liked post by ${post.author}`);
    }
    
    await saveCookies(page.context());
  } finally {
    await browser.close();
  }
}

async function commentOnPost(index, commentText) {
  const cache = loadFeedCache();
  if (!cache) {
    console.error('❌ Feed cache expired. Run "node linkedin.js list" first.');
    process.exit(1);
  }
  
  const post = cache.find(p => p.index === parseInt(index));
  if (!post) {
    console.error(`❌ Post #${index} not found. Run "node linkedin.js list" to see posts.`);
    process.exit(1);
  }
  
  const browser = await getBrowser();
  try {
    const page = await getPage(browser);
    await ensureLoggedIn(page);
    
    console.log(`💬 Commenting on post by ${post.author}...`);
    
    // Wait for feed to load
    await page.waitForTimeout(3000);
    await page.evaluate(() => window.scrollBy(0, 1000));
    await page.waitForTimeout(2000);
    
    // Find the post by index
    const postIndex = parseInt(index);
    
    // Click comment button within the specific post
    const commentButtonClicked = await page.evaluate((targetIndex) => {
      const postContainers = document.querySelectorAll('[data-view-name="feed-full-update"]');
      const targetPost = postContainers[targetIndex - 1];
      
      if (!targetPost) return { success: false, error: 'Post not found' };
      
      // Find comment button - look for button with "Comment" in aria-label or text
      const buttons = targetPost.querySelectorAll('button');
      for (const btn of buttons) {
        const label = btn.getAttribute('aria-label') || btn.textContent;
        if (label && label.toLowerCase().includes('comment')) {
          btn.click();
          return { success: true };
        }
      }
      
      return { success: false, error: 'Comment button not found' };
    }, postIndex);
    
    if (!commentButtonClicked.success) {
      console.error(`❌ ${commentButtonClicked.error}`);
      process.exit(1);
    }
    
    await page.waitForTimeout(1500);
    
    // Find and fill comment input
    // LinkedIn uses contenteditable divs or textareas
    const commentInput = await page.$('[data-placeholder*="comment" i]') ||
                         await page.$('[contenteditable="true"][role="textbox"]') ||
                         await page.$('.ql-editor') ||
                         await page.$('textarea[placeholder*="comment" i]');
    
    if (!commentInput) {
      console.error('❌ Could not find comment input');
      process.exit(1);
    }
    
    await commentInput.click();
    await page.waitForTimeout(500);
    await page.keyboard.type(commentText, { delay: 30 });
    await page.waitForTimeout(500);
    
    // Submit comment - look for submit button or press Ctrl+Enter
    const submitButton = await page.$('button[type="submit"]') ||
                         await page.$('button[aria-label*="Post" i]') ||
                         await page.$('button[aria-label*="Submit" i]');
    
    if (submitButton) {
      await submitButton.click();
    } else {
      // Try Ctrl+Enter as fallback
      await page.keyboard.press('Control+Enter');
    }
    
    await page.waitForTimeout(2000);
    
    await saveCookies(page.context());
    console.log(`✅ Commented on ${post.author}'s post`);
    console.log(`   "${commentText}"`);
  } finally {
    await browser.close();
  }
}

async function followProfile(url) {
  const browser = await getBrowser();
  try {
    const page = await getPage(browser);
    await ensureLoggedIn(page);
    
    console.log(`👤 Following profile: ${url}`);
    
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    
    const name = await page.$eval('h1', el => el.textContent?.trim()).catch(() => 'Unknown');
    
    // Find follow button
    const followButton = await page.$('button[aria-label*="Follow"]') ||
                         await page.$('button:has-text("Follow")');
    
    if (!followButton) {
      // Check if already following
      const following = await page.$('button[aria-label*="Following"]');
      if (following) {
        console.log(`ℹ️ Already following ${name}`);
        return;
      }
      console.error('❌ Could not find follow button');
      process.exit(1);
    }
    
    await followButton.click();
    await page.waitForTimeout(1500);
    
    await saveCookies(page.context());
    console.log(`✅ Now following ${name}`);
  } finally {
    await browser.close();
  }
}

async function searchLinkedIn(query) {
  const browser = await getBrowser();
  try {
    const page = await getPage(browser);
    await ensureLoggedIn(page);
    
    console.log(`🔍 Searching: "${query}"\n`);
    
    const searchUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(query)}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    
    // Get search results using updated selectors
    const results = await page.evaluate(() => {
      const postContainers = document.querySelectorAll('[data-view-name="feed-full-update"]');
      
      return Array.from(postContainers).slice(0, 5).map(container => {
        // Get author from Follow button or profile link
        let author = 'Unknown';
        const followButton = container.querySelector('button[aria-label^="Follow "]');
        if (followButton) {
          author = followButton.getAttribute('aria-label').replace('Follow ', '').trim();
        } else {
          const profileLink = container.querySelector('a[href*="/in/"]');
          if (profileLink) {
            const match = profileLink.href.match(/\/in\/([^\/]+)/);
            if (match) {
              author = match[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            }
          }
        }
        
        // Get post text
        let text = '';
        const allSpans = container.querySelectorAll('span');
        for (const span of allSpans) {
          const spanText = span.textContent?.trim();
          if (spanText && spanText.length > 40 && 
              !spanText.includes('LinkedIn') && 
              !spanText.includes('Follow') &&
              !spanText.includes('Feed post')) {
            text = spanText.substring(0, 150);
            break;
          }
        }
        
        return { author, text };
      });
    });
    
    if (results.length === 0) {
      console.log('No results found.');
      return;
    }
    
    results.forEach((r, i) => {
      console.log(`[${i + 1}] ${r.author}`);
      console.log(`    "${r.text}${r.text.length >= 150 ? '...' : ''}"`);
      console.log('');
    });
    
    await saveCookies(page.context());
  } finally {
    await browser.close();
  }
}

async function viewFeed() {
  const browser = await getBrowser();
  try {
    const page = await getPage(browser);
    await ensureLoggedIn(page);
    
    console.log('📰 LinkedIn Feed Summary\n');
    
    // Wait for feed to load
    await page.waitForTimeout(3000);
    
    const posts = await page.evaluate(() => {
      const postContainers = document.querySelectorAll('[data-view-name="feed-full-update"]');
      
      return Array.from(postContainers).slice(0, 5).map(container => {
        // Get author
        let author = 'Unknown';
        const followButton = container.querySelector('button[aria-label^="Follow "]');
        if (followButton) {
          author = followButton.getAttribute('aria-label').replace('Follow ', '').trim();
        } else {
          const profileLink = container.querySelector('a[href*="/in/"]');
          if (profileLink) {
            const match = profileLink.href.match(/\/in\/([^\/]+)/);
            if (match) {
              author = match[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            }
          }
        }
        
        // Get post text
        let text = '';
        const allSpans = container.querySelectorAll('span');
        for (const span of allSpans) {
          const spanText = span.textContent?.trim();
          if (spanText && spanText.length > 40 && 
              !spanText.includes('LinkedIn') && 
              !spanText.includes('Follow') &&
              !spanText.includes('Feed post')) {
            text = spanText.substring(0, 150);
            break;
          }
        }
        
        return { author, text };
      });
    }).catch(() => []);
    
    if (posts.length === 0) {
      console.log('Could not parse feed. LinkedIn may have updated their layout.');
    } else {
      posts.forEach((post, i) => {
        console.log(`${i + 1}. ${post.author}`);
        console.log(`   ${post.text}${post.text.length >= 150 ? '...' : ''}\n`);
      });
    }
    
    await saveCookies(page.context());
  } finally {
    await browser.close();
  }
}

async function createPost(text) {
  const browser = await getBrowser();
  try {
    const page = await getPage(browser);
    await ensureLoggedIn(page);
    
    console.log('📝 Creating post...');
    
    // Step 1: Click "Start a post" using Playwright locator
    const startPostBtn = page.getByText('Start a post', { exact: true });
    await startPostBtn.click({ force: true });
    await page.waitForTimeout(2500);
    
    // Step 2: Find editor using placeholder locator (most reliable)
    const editor = page.getByPlaceholder('What do you want to talk about');
    try {
      await editor.click({ timeout: 5000 });
    } catch (e) {
      // Fallback: try other locators
      const fallbackLocators = [
        page.locator('div.ql-editor'),
        page.locator('[data-placeholder]').first(),
        page.locator('.share-creation-state__text-editor')
      ];
      let found = false;
      for (const loc of fallbackLocators) {
        try {
          if (await loc.count() > 0) {
            await loc.click({ timeout: 3000 });
            found = true;
            break;
          }
        } catch (e2) {}
      }
      if (!found) {
        console.error('❌ Could not find post editor');
        process.exit(1);
      }
    }
    
    // Step 3: Type the content
    await page.waitForTimeout(500);
    await page.keyboard.type(text, { delay: 15 });
    await page.waitForTimeout(1000);
    
    // Step 4: Click Post button
    const postBtn = page.getByRole('button', { name: 'Post', exact: true });
    await postBtn.click({ timeout: 5000 });
    
    await page.waitForTimeout(3000);
    await saveCookies(page.context());
    
    console.log('✅ Post created successfully!');
    console.log(`📄 "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
  } finally {
    await browser.close();
  }
}

async function viewProfile(url) {
  const browser = await getBrowser();
  try {
    const page = await getPage(browser);
    await ensureLoggedIn(page);
    
    const profileUrl = url || 'https://www.linkedin.com/in/maximus-carapax/';
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    
    const name = await page.$eval('h1', el => el.textContent?.trim()).catch(() => 'Unknown');
    const headline = await page.$eval('.text-body-medium', el => el.textContent?.trim()).catch(() => '');
    const connections = await page.$eval('[href*="connections"]', el => el.textContent?.trim()).catch(() => '');
    
    console.log(`👤 ${name}`);
    console.log(`📝 ${headline}`);
    if (connections) console.log(`🔗 ${connections}`);
    
    await saveCookies(page.context());
  } finally {
    await browser.close();
  }
}

function showHelp() {
  console.log(`
LinkedIn Tool - Stealth browser automation for engagement

Commands:
  node linkedin.js list                    List feed posts with index
  node linkedin.js like <index>            Like a post (use index from list)
  node linkedin.js comment <index> "text"  Comment on a post
  node linkedin.js follow <profile_url>    Follow a profile
  node linkedin.js post "text"             Create a new post
  node linkedin.js feed                    View feed summary
  node linkedin.js profile [url]           View profile info
  node linkedin.js search <query>          Search LinkedIn
  node linkedin.js help                    Show this help

Engagement Workflow:
  1. node linkedin.js list          # See posts with indexes
  2. node linkedin.js like 3        # Like post #3
  3. node linkedin.js comment 3 "Great insight!"

Profile: https://www.linkedin.com/in/maximus-carapax/
`);
}

async function main() {
  const [,, command, ...args] = process.argv;
  
  try {
    switch (command) {
      case 'list':
        await listFeed();
        break;
      case 'like':
        if (!args[0]) {
          console.error('Usage: node linkedin.js like <index>');
          console.error('Run "node linkedin.js list" first to see post indexes');
          process.exit(1);
        }
        await likePost(args[0]);
        break;
      case 'comment':
        if (!args[0] || !args[1]) {
          console.error('Usage: node linkedin.js comment <index> "your comment"');
          process.exit(1);
        }
        await commentOnPost(args[0], args.slice(1).join(' '));
        break;
      case 'follow':
        if (!args[0]) {
          console.error('Usage: node linkedin.js follow <profile_url>');
          process.exit(1);
        }
        await followProfile(args[0]);
        break;
      case 'search':
        if (!args[0]) {
          console.error('Usage: node linkedin.js search <query>');
          process.exit(1);
        }
        await searchLinkedIn(args.join(' '));
        break;
      case 'feed':
        await viewFeed();
        break;
      case 'post':
        if (!args[0]) {
          console.error('Usage: node linkedin.js post "your post text"');
          process.exit(1);
        }
        await createPost(args.join(' '));
        break;
      case 'profile':
        await viewProfile(args[0]);
        break;
      case 'help':
      case '--help':
      case '-h':
      default:
        showHelp();
    }
  } catch (err) {
    db.logError({
      source: 'linkedin',
      message: err.message,
      details: `LinkedIn CLI command failed: ${command}`,
      stack: err.stack
    });
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

main();
