#!/usr/bin/env node
/**
 * CAPTCHA Solver - 2Captcha integration
 * 
 * Usage:
 *   node captcha-solver.js solve <sitekey> <pageurl> [--type recaptcha|hcaptcha]
 *   node captcha-solver.js balance                    # Check balance
 *   node captcha-solver.js test                       # Test on demo page
 * 
 * Environment:
 *   TWOCAPTCHA_API_KEY - Your 2Captcha API key
 * 
 * Pricing (~$3 per 1000 solves):
 *   - reCAPTCHA v2: $2.99/1000
 *   - reCAPTCHA v3: $2.99/1000
 *   - hCaptcha: $2.99/1000
 *   - Image CAPTCHA: $0.50-1.00/1000
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const API_KEY = process.env.TWOCAPTCHA_API_KEY;
const API_BASE = 'https://api.2captcha.com';

async function checkBalance() {
  const res = await fetch(`${API_BASE}/getBalance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientKey: API_KEY })
  });
  const data = await res.json();
  
  if (data.errorId) {
    throw new Error(`API Error: ${data.errorCode} - ${data.errorDescription}`);
  }
  
  return data.balance;
}

async function solveRecaptchaV2(siteKey, pageUrl, invisible = false) {
  console.log(`🔄 Submitting reCAPTCHA v2 to 2Captcha...`);
  console.log(`   Site key: ${siteKey.substring(0, 20)}...`);
  console.log(`   Page URL: ${pageUrl}`);
  
  // Create task
  const createRes = await fetch(`${API_BASE}/createTask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientKey: API_KEY,
      task: {
        type: 'RecaptchaV2TaskProxyless',
        websiteURL: pageUrl,
        websiteKey: siteKey,
        isInvisible: invisible
      }
    })
  });
  
  const createData = await createRes.json();
  
  if (createData.errorId) {
    throw new Error(`Create task error: ${createData.errorCode} - ${createData.errorDescription}`);
  }
  
  const taskId = createData.taskId;
  console.log(`📋 Task ID: ${taskId}`);
  
  // Poll for result
  return await pollForResult(taskId);
}

async function solveHCaptcha(siteKey, pageUrl) {
  console.log(`🔄 Submitting hCaptcha to 2Captcha...`);
  
  const createRes = await fetch(`${API_BASE}/createTask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientKey: API_KEY,
      task: {
        type: 'HCaptchaTaskProxyless',
        websiteURL: pageUrl,
        websiteKey: siteKey
      }
    })
  });
  
  const createData = await createRes.json();
  
  if (createData.errorId) {
    throw new Error(`Create task error: ${createData.errorCode} - ${createData.errorDescription}`);
  }
  
  const taskId = createData.taskId;
  console.log(`📋 Task ID: ${taskId}`);
  
  return await pollForResult(taskId);
}

async function pollForResult(taskId, maxAttempts = 30, intervalMs = 5000) {
  console.log(`⏳ Waiting for solution (max ${maxAttempts * intervalMs / 1000}s)...`);
  
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(intervalMs);
    
    const res = await fetch(`${API_BASE}/getTaskResult`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: API_KEY,
        taskId
      })
    });
    
    const data = await res.json();
    
    if (data.errorId) {
      throw new Error(`Poll error: ${data.errorCode} - ${data.errorDescription}`);
    }
    
    if (data.status === 'ready') {
      console.log(`✅ Solved in ~${(i + 1) * intervalMs / 1000}s`);
      return data.solution;
    }
    
    process.stdout.write('.');
  }
  
  throw new Error('Timeout waiting for CAPTCHA solution');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testSolve() {
  // Test on Google's reCAPTCHA demo page
  const testSiteKey = '6Le-wvkSAAAAAPBMRTvw0Q4Muexq9bi0DJwx_mJ-';
  const testPageUrl = 'https://www.google.com/recaptcha/api2/demo';
  
  console.log('🧪 Testing CAPTCHA solver on Google demo page...\n');
  
  const solution = await solveRecaptchaV2(testSiteKey, testPageUrl);
  
  console.log('\n📝 Solution token (first 50 chars):');
  console.log(solution.gRecaptchaResponse.substring(0, 50) + '...');
  console.log('\n✅ Test successful! CAPTCHA solver is working.');
}

function showHelp() {
  console.log(`
CAPTCHA Solver - 2Captcha Integration

Usage:
  node captcha-solver.js balance                        Check account balance
  node captcha-solver.js test                           Test on demo page
  node captcha-solver.js solve <sitekey> <url>          Solve reCAPTCHA v2
  node captcha-solver.js solve <sitekey> <url> --hcaptcha  Solve hCaptcha

Environment:
  TWOCAPTCHA_API_KEY    Your 2Captcha API key (add to .env)

Get API key:
  1. Sign up at https://2captcha.com
  2. Add funds ($3 minimum, lasts ~1000 solves)
  3. Copy API key from dashboard
  4. Add to .env: TWOCAPTCHA_API_KEY=your_key_here

Pricing:
  ~$0.003 per CAPTCHA solve (reCAPTCHA, hCaptcha)
`);
}

// Exported functions for use in other scripts
module.exports = {
  solveRecaptchaV2,
  solveHCaptcha,
  checkBalance,
  pollForResult
};

// CLI
async function main() {
  const [,, command, ...args] = process.argv;
  
  if (!API_KEY && command !== 'help' && command !== '--help') {
    console.error('❌ TWOCAPTCHA_API_KEY not set in environment');
    console.error('Add it to your .env file or export it');
    process.exit(1);
  }
  
  try {
    switch (command) {
      case 'balance':
        const balance = await checkBalance();
        console.log(`💰 2Captcha Balance: $${balance.toFixed(2)}`);
        break;
        
      case 'test':
        await testSolve();
        break;
        
      case 'solve':
        if (args.length < 2) {
          console.error('Usage: node captcha-solver.js solve <sitekey> <pageurl> [--hcaptcha]');
          process.exit(1);
        }
        
        const [siteKey, pageUrl, ...flags] = args;
        const isHCaptcha = flags.includes('--hcaptcha');
        
        let solution;
        if (isHCaptcha) {
          solution = await solveHCaptcha(siteKey, pageUrl);
        } else {
          solution = await solveRecaptchaV2(siteKey, pageUrl);
        }
        
        console.log('\n📝 Solution:');
        console.log(JSON.stringify(solution, null, 2));
        break;
        
      case 'help':
      case '--help':
      case '-h':
      default:
        showHelp();
    }
  } catch (err) {
    console.error(`\n❌ Error: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
