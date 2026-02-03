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

async function screenshot() {
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
  
  console.log('Current URL:', page.url());
  
  // Take screenshot
  await page.screenshot({ path: '/tmp/linkedin-feed.png', fullPage: false });
  console.log('Screenshot saved to /tmp/linkedin-feed.png');
  
  // Get page title
  const title = await page.title();
  console.log('Page title:', title);
  
  // Check for common elements
  const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
  console.log('Body text preview:', bodyText);
  
  await browser.close();
}

screenshot().catch(console.error);
