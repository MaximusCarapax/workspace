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
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    viewport: { width: 1280, height: 800 }
  });
  
  if (fs.existsSync(COOKIES_PATH)) {
    const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf8'));
    await context.addCookies(cookies);
  }
  
  const page = await context.newPage();
  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  
  // Check if logged in
  if (page.url().includes('login')) {
    console.log('Not logged in, logging in...');
    await page.goto('https://www.linkedin.com/login');
    await page.fill('#username', credentials.linkedin?.email || 'maximuscarapax@gmail.com');
    await page.fill('#password', credentials.linkedin?.password);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);
    await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
  }
  
  // Scroll a bit
  await page.evaluate(() => window.scrollBy(0, 500));
  await page.waitForTimeout(2000);
  
  // Try different selectors to find posts
  const selectors = [
    '[data-urn*="urn:li:activity"]',
    '.feed-shared-update-v2',
    '[data-id*="urn:li:activity"]',
    '.update-components-actor',
    'article',
    '[class*="feed-shared"]',
    '[class*="occludable-update"]'
  ];
  
  for (const sel of selectors) {
    const count = await page.$$eval(sel, els => els.length).catch(() => 0);
    console.log(`${sel}: ${count} elements`);
  }
  
  // Try to find actual post content with different approaches
  const posts = await page.evaluate(() => {
    // Look for any element with activity URN
    const withUrn = document.querySelectorAll('[data-urn]');
    const urns = Array.from(withUrn).map(el => el.getAttribute('data-urn')).filter(u => u && u.includes('activity'));
    
    // Look for feed items by class patterns
    const feedItems = document.querySelectorAll('[class*="feed"][class*="update"]');
    
    return {
      urnsFound: urns.length,
      sampleUrns: urns.slice(0, 3),
      feedItemsCount: feedItems.length
    };
  });
  
  console.log('\nPost detection:', JSON.stringify(posts, null, 2));
  
  await browser.close();
}

debug().catch(console.error);
