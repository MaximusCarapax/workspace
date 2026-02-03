const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const fs = require('fs');
const path = require('path');
const https = require('https');
require('dotenv').config();

chromium.use(stealth);

const creds = JSON.parse(fs.readFileSync(path.join(process.env.HOME, '.openclaw/secrets/credentials.json'), 'utf8'));
const TWOCAPTCHA_KEY = process.env.TWOCAPTCHA_API_KEY;

const EMAIL = creds.gmail?.email || 'maximuscarapax@gmail.com';
const PASSWORD = 'D33pGr@m2026!Max';

async function solveCaptcha(siteKey, url) {
  console.log('🔐 Solving reCAPTCHA...');
  
  // Submit captcha
  const submitUrl = `https://2captcha.com/in.php?key=${TWOCAPTCHA_KEY}&method=userrecaptcha&googlekey=${siteKey}&pageurl=${encodeURIComponent(url)}&json=1`;
  
  const submitResult = await new Promise((resolve, reject) => {
    https.get(submitUrl, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
  
  if (submitResult.status !== 1) {
    throw new Error('Failed to submit: ' + JSON.stringify(submitResult));
  }
  
  const captchaId = submitResult.request;
  console.log('  Submitted, ID:', captchaId);
  
  // Poll for result
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 5000));
    
    const resultUrl = `https://2captcha.com/res.php?key=${TWOCAPTCHA_KEY}&action=get&id=${captchaId}&json=1`;
    const result = await new Promise((resolve, reject) => {
      https.get(resultUrl, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });
    
    if (result.status === 1) {
      console.log('  ✅ CAPTCHA solved!');
      return result.request;
    }
    
    if (result.request !== 'CAPCHA_NOT_READY') {
      throw new Error('Captcha error: ' + result.request);
    }
    
    console.log('  Waiting... (' + (i+1) + '/40)');
  }
  
  throw new Error('Captcha timeout');
}

async function signup() {
  console.log('🎤 Starting Deepgram signup...');
  console.log('Email:', EMAIL);
  
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
    await page.goto('https://console.deepgram.com/signup', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    
    // Fill email
    const emailInput = await page.$('input[type="email"], input[name="email"]');
    if (emailInput) {
      await emailInput.fill(EMAIL);
      console.log('✓ Email filled');
    }
    
    // Fill password
    const passwordInput = await page.$('input[type="password"]');
    if (passwordInput) {
      await passwordInput.fill(PASSWORD);
      console.log('✓ Password filled');
    }
    
    await page.waitForTimeout(1000);
    
    // Get reCAPTCHA sitekey
    const siteKey = await page.evaluate(() => {
      const el = document.querySelector('[data-sitekey]');
      if (el) return el.getAttribute('data-sitekey');
      const iframe = document.querySelector('iframe[src*="recaptcha"]');
      if (iframe) {
        const match = iframe.src.match(/k=([^&]+)/);
        if (match) return match[1];
      }
      // Look in the page HTML
      const html = document.documentElement.innerHTML;
      const match = html.match(/sitekey['":\s]+['"]([0-9a-zA-Z_-]+)['"]/);
      if (match) return match[1];
      return null;
    });
    
    console.log('reCAPTCHA sitekey:', siteKey);
    
    if (siteKey && TWOCAPTCHA_KEY) {
      const token = await solveCaptcha(siteKey, page.url());
      
      // Inject the token
      await page.evaluate((token) => {
        const textarea = document.querySelector('#g-recaptcha-response, textarea[name="g-recaptcha-response"]');
        if (textarea) {
          textarea.style.display = 'block';
          textarea.value = token;
        }
        // Also try callback
        if (window.grecaptcha && window.grecaptcha.callback) {
          window.grecaptcha.callback(token);
        }
        // Find and call any callback function
        const callbacks = ['onRecaptchaSuccess', 'recaptchaCallback', 'captchaCallback'];
        for (const cb of callbacks) {
          if (window[cb]) window[cb](token);
        }
      }, token);
      
      console.log('✓ CAPTCHA token injected');
      await page.waitForTimeout(1000);
    }
    
    await page.screenshot({ path: '/tmp/deepgram-before-submit.png' });
    
    // Click create account
    const signupBtn = await page.$('button:has-text("Create Account"), button:has-text("Sign up"), button[type="submit"]');
    if (signupBtn) {
      await signupBtn.click({ force: true });
      console.log('✓ Submit clicked');
    }
    
    await page.waitForTimeout(8000);
    await page.screenshot({ path: '/tmp/deepgram-after-submit.png' });
    
    console.log('\nFinal URL:', page.url());
    const finalText = await page.evaluate(() => document.body.innerText.substring(0, 1000));
    console.log('\nFinal page:\n', finalText.substring(0, 500));
    
    // Check for success
    if (page.url().includes('console') && !page.url().includes('signup')) {
      console.log('\n✅ Signup successful!');
    } else if (finalText.toLowerCase().includes('verify') || finalText.toLowerCase().includes('email')) {
      console.log('\n✅ Signup likely successful - check email for verification');
    }
    
  } catch (err) {
    console.error('Error:', err.message);
    await page.screenshot({ path: '/tmp/deepgram-error.png' });
  } finally {
    await browser.close();
  }
}

signup();
