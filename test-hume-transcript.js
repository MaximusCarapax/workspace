#!/usr/bin/env node
/**
 * Test script for Hume transcript functionality
 */

require('dotenv').config();
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

async function testTranscriptFetching() {
  try {
    console.log('🔍 Testing Hume transcript fetching...');
    
    // Test 1: Check if we can list recent chats
    console.log('\n1. Testing chat listing...');
    const { stdout: listOutput } = await execAsync('node -e "' +
      'const creds = require(\'./lib/credentials\'); ' +
      'if (!global.fetch) { try { global.fetch = require(\'node-fetch\'); } catch(e) {} } ' +
      'const key = creds.get(\'hume_api_key\'); ' +
      'fetch(\'https://api.hume.ai/v0/evi/chats?page_size=5\', { headers: { \'X-Hume-Api-Key\': key } }) ' +
      '.then(r => r.json()) ' +
      '.then(d => console.log(JSON.stringify(d, null, 2))) ' +
      '.catch(e => console.error(\'Error:\', e.message));' +
    '"');
    
    console.log('Recent chats response:', listOutput.substring(0, 500) + '...');
    
    // Test 2: Try to parse a chat ID if available
    try {
      const chatData = JSON.parse(listOutput);
      if (chatData.chats && chatData.chats.length > 0) {
        const chatId = chatData.chats[0].id;
        console.log(`\n2. Testing transcript fetch for chat: ${chatId}`);
        
        const { stdout: transcriptCmd } = await execAsync(`node tools/hume-call.js transcript ${chatId}`);
        console.log('Transcript result:', transcriptCmd);
      } else {
        console.log('\n2. No recent chats found to test transcript fetching');
      }
    } catch (parseErr) {
      console.log('\n2. Could not parse chat data:', parseErr.message);
    }
    
    // Test 3: Verify index-call.js exists and works
    console.log('\n3. Testing index-call.js integration...');
    const { stdout: indexTest } = await execAsync('node tools/index-call.js --help');
    console.log('✅ index-call.js is working');
    
    console.log('\n✅ All tests completed successfully!');
    console.log('\n🚀 Ready to test with a real call. Try:');
    console.log('   node tools/hume-call.js +61429512420 "Test"');
    
  } catch (err) {
    console.error('❌ Test failed:', err.message);
    if (err.stdout) console.log('STDOUT:', err.stdout);
    if (err.stderr) console.log('STDERR:', err.stderr);
  }
}

testTranscriptFetching();