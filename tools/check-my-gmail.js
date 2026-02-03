const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const fs = require('fs');
const path = require('path');

chromium.use(stealth);

const COOKIES_PATH = '/tmp/gmail-maximus-cookies.json';
const creds = JSON.parse(fs.readFileSync(path.join(process.env.HOME, '.openclaw/secrets/credentials.json'), 'utf8'));

const EMAIL = creds.gmail?.email || 'maximuscarapax@gmail.com';
const PASSWORD = creds.gmail?.password;

const SEARCH_TERM = process.argv[2] || 'deepgram OR twilio';

async function checkGmail() {
  console.log('📧 Checking Gmail for', EMAIL);
  console.log('Search:', SEARCH_TERM);
  
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    viewport: { width: 1280, height: 800 }
  });
  
  // Load cookies if exist
  if (fs.existsSync(COOKIES_PATH)) {
    const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf8'));
    await context.addCookies(cookies);
  }
  
  const page = await context.newPage();
  await page.goto('https://mail.google.com', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  
  // Check if logged in
  if (page.url().includes('accounts.google.com')) {
    console.log('Not logged in, logging in...');
    
    const emailInput = await page.$('input[type="email"]');
    if (emailInput) {
      await emailInput.fill(EMAIL);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(3000);
    }
    
    const passwordInput = await page.$('input[type="password"]');
    if (passwordInput) {
      await passwordInput.fill(PASSWORD);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(5000);
    }
  }
  
  console.log('Current URL:', page.url());
  
  // Search
  if (page.url().includes('mail.google.com')) {
    console.log('Searching...');
    await page.goto(`https://mail.google.com/mail/u/0/#search/${encodeURIComponent(SEARCH_TERM)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: '/tmp/my-gmail-search.png' });
    
    const pageText = await page.evaluate(() => document.body.innerText.substring(0, 3000));
    console.log('\n' + pageText);
  }
  
  // Save cookies
  const cookies = await context.cookies();
  fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
  
  await browser.close();
}

checkGmail().catch(console.error);
