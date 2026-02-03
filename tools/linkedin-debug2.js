const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const fs = require('fs');
const path = require('path');

chromium.use(stealth);

const COOKIES_PATH = '/tmp/linkedin-cookies.json';
const CREDENTIALS_PATH = path.join(process.env.HOME, '.openclaw/secrets/credentials.json');

let credentials = {};
try {
  credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
} catch (e) {}

async function debug() {
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 }
  });
  
  if (fs.existsSync(COOKIES_PATH)) {
    const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf8'));
    await context.addCookies(cookies);
  }
  
  const page = await context.newPage();
  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  
  // Scroll to load content
  await page.evaluate(() => window.scrollBy(0, 800));
  await page.waitForTimeout(2000);
  
  // Get the main feed area and examine its structure
  const feedInfo = await page.evaluate(() => {
    // Find main content area
    const main = document.querySelector('main');
    if (!main) return { error: 'No main element found' };
    
    // Get all divs with data attributes that might be posts
    const allWithData = main.querySelectorAll('[data-id]');
    const dataIds = Array.from(allWithData).map(el => ({
      dataId: el.getAttribute('data-id'),
      className: el.className.substring(0, 100),
      tagName: el.tagName
    })).slice(0, 10);
    
    // Look for elements containing author names (they usually have specific patterns)
    const textContent = main.innerText;
    const hasFollowing = textContent.includes('Following');
    const hasLike = textContent.includes('Like');
    const hasComment = textContent.includes('Comment');
    
    // Try to find post containers by looking for Like buttons
    const likeButtons = document.querySelectorAll('button[aria-label*="Like"]');
    
    // Get parent containers of like buttons (these are likely posts)
    const postContainers = Array.from(likeButtons).slice(0, 5).map(btn => {
      // Walk up to find a reasonable container
      let container = btn;
      for (let i = 0; i < 10 && container.parentElement; i++) {
        container = container.parentElement;
        if (container.getAttribute('data-id') || container.getAttribute('data-urn')) {
          return {
            found: true,
            dataId: container.getAttribute('data-id'),
            dataUrn: container.getAttribute('data-urn'),
            className: container.className.substring(0, 100)
          };
        }
      }
      return { found: false, nearestClass: container.className.substring(0, 100) };
    });
    
    return {
      dataIds,
      likeButtonCount: likeButtons.length,
      postContainers,
      hasFollowing,
      hasLike,
      hasComment
    };
  });
  
  console.log('Feed analysis:', JSON.stringify(feedInfo, null, 2));
  
  await browser.close();
}

debug().catch(console.error);
