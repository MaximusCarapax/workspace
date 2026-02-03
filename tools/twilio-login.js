const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const fs = require('fs');
const path = require('path');

chromium.use(stealth);

const creds = JSON.parse(fs.readFileSync(path.join(process.env.HOME, '.openclaw/secrets/credentials.json'), 'utf8'));

const EMAIL = creds.gmail?.email || 'maximuscarapax@gmail.com';
const PASSWORD = creds.gmail?.password; // Try Gmail password first

async function loginTwilio() {
  console.log('📞 Logging into Twilio as', EMAIL);
  
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    viewport: { width: 1280, height: 800 }
  });
  
  const page = await context.newPage();
  
  try {
    await page.goto('https://www.twilio.com/login', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    
    // Fill email
    const emailInput = await page.$('input[type="email"], input[name="email"]');
    if (emailInput) {
      await emailInput.fill(EMAIL);
      console.log('✓ Email filled');
    }
    
    // Look for "Continue with Google" or password field
    await page.screenshot({ path: '/tmp/twilio-login-1.png' });
    
    // Try finding next/continue button
    const continueBtn = await page.$('button:has-text("Continue"), button:has-text("Next"), button[type="submit"]');
    if (continueBtn) {
      await continueBtn.click();
      await page.waitForTimeout(3000);
    }
    
    await page.screenshot({ path: '/tmp/twilio-login-2.png' });
    console.log('Current URL:', page.url());
    
    // Check for Google sign-in option
    const googleBtn = await page.$('button:has-text("Google"), a:has-text("Google")');
    if (googleBtn) {
      console.log('Google sign-in available - might need to use that');
    }
    
    // Check if we're at the console
    if (page.url().includes('console.twilio.com')) {
      console.log('✅ Logged into Twilio console!');
      
      // Go to dashboard to get account SID
      await page.goto('https://console.twilio.com/', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
      
      await page.screenshot({ path: '/tmp/twilio-dashboard.png' });
      
      const pageText = await page.evaluate(() => document.body.innerText);
      console.log('\nLooking for Account SID and Auth Token...');
      
      // Try to find the credentials
      const sidMatch = pageText.match(/AC[a-f0-9]{32}/);
      if (sidMatch) {
        console.log('Account SID:', sidMatch[0]);
      }
    }
    
    const pageText = await page.evaluate(() => document.body.innerText.substring(0, 1500));
    console.log('\nPage text:\n', pageText);
    
  } catch (err) {
    console.error('Error:', err.message);
    await page.screenshot({ path: '/tmp/twilio-error.png' });
  } finally {
    await browser.close();
  }
}

loginTwilio();
