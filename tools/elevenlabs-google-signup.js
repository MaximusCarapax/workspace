#!/usr/bin/env node
/**
 * ElevenLabs Google Sign-in
 */

const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const fs = require('fs');
const path = require('path');
require('dotenv').config();

chromium.use(stealth);

const CREDENTIALS_PATH = path.join(process.env.HOME, '.openclaw/secrets/credentials.json');
const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));

const GOOGLE_EMAIL = creds.gmail?.email || 'maximuscarapax@gmail.com';
const GOOGLE_PASSWORD = creds.gmail?.password;

async function signup() {
  console.log('🚀 Starting ElevenLabs Google sign-in...\n');
  console.log('Using email:', GOOGLE_EMAIL);
  
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 }
  });
  
  const page = await context.newPage();
  
  try {
    // Go to signup page
    console.log('📄 Loading ElevenLabs...');
    await page.goto('https://elevenlabs.io/app/sign-up', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    
    // Click Google sign-in button
    console.log('🔍 Looking for Google sign-in button...');
    const googleBtn = await page.$('button:has-text("Sign up with Google")');
    
    if (!googleBtn) {
      console.log('❌ Google sign-in button not found');
      await page.screenshot({ path: '/tmp/el-google-1.png' });
      return;
    }
    
    // Handle popup
    const [popup] = await Promise.all([
      context.waitForEvent('page', { timeout: 10000 }),
      googleBtn.click()
    ]).catch(async (e) => {
      console.log('  No popup detected, checking for redirect...');
      await page.waitForTimeout(3000);
      return [null];
    });
    
    if (popup) {
      console.log('📱 Google popup opened');
      await popup.waitForLoadState('domcontentloaded');
      await popup.screenshot({ path: '/tmp/el-google-popup.png' });
      
      // Fill Google email
      const emailInput = await popup.$('input[type="email"]');
      if (emailInput) {
        await emailInput.fill(GOOGLE_EMAIL);
        await popup.click('button:has-text("Next"), #identifierNext');
        console.log('  ✓ Email entered');
        await popup.waitForTimeout(3000);
      }
      
      // Fill Google password
      const passwordInput = await popup.$('input[type="password"]');
      if (passwordInput) {
        await passwordInput.fill(GOOGLE_PASSWORD);
        await popup.click('button:has-text("Next"), #passwordNext');
        console.log('  ✓ Password entered');
        await popup.waitForTimeout(5000);
      }
      
      await popup.screenshot({ path: '/tmp/el-google-popup2.png' });
      
      // Check for 2FA or continue
      const twoFactor = await popup.$('text=2-Step Verification');
      if (twoFactor) {
        console.log('⚠️ 2FA required - need manual intervention');
      }
      
    } else {
      // Check if we're on Google's page now
      console.log('📍 Current URL:', page.url());
      await page.screenshot({ path: '/tmp/el-google-redirect.png' });
      
      if (page.url().includes('accounts.google.com')) {
        console.log('  On Google login page');
        
        // Fill email
        const emailInput = await page.$('input[type="email"]');
        if (emailInput) {
          await emailInput.fill(GOOGLE_EMAIL);
          await page.keyboard.press('Enter');
          console.log('  ✓ Email entered');
          await page.waitForTimeout(3000);
        }
        
        // Fill password
        await page.waitForSelector('input[type="password"]', { timeout: 10000 }).catch(() => null);
        const passwordInput = await page.$('input[type="password"]');
        if (passwordInput) {
          await passwordInput.fill(GOOGLE_PASSWORD);
          await page.keyboard.press('Enter');
          console.log('  ✓ Password entered');
          await page.waitForTimeout(5000);
        }
        
        await page.screenshot({ path: '/tmp/el-google-after-login.png' });
      }
    }
    
    // Wait and check final state
    await page.waitForTimeout(5000);
    await page.screenshot({ path: '/tmp/el-google-final.png' });
    
    console.log('\n📍 Final URL:', page.url());
    
    const pageText = await page.evaluate(() => document.body.innerText.substring(0, 1000));
    console.log('\n📄 Page text:\n', pageText.substring(0, 500));
    
    // Check for success
    if (page.url().includes('app') && !page.url().includes('sign')) {
      console.log('\n✅ Success! Logged into ElevenLabs');
      
      // Try to get API key
      await page.goto('https://elevenlabs.io/app/settings/api-keys', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
      await page.screenshot({ path: '/tmp/el-api-keys.png' });
      console.log('  Screenshot of API keys page saved');
    }
    
  } catch (err) {
    console.error('❌ Error:', err.message);
    await page.screenshot({ path: '/tmp/el-google-error.png' });
  } finally {
    await browser.close();
  }
}

signup();
