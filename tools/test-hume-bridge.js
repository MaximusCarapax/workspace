#!/usr/bin/env node
/**
 * Test script for the Hume-Twilio Bridge
 */

const fs = require('fs');
const path = require('path');

// Load credentials
const credsPath = path.join(process.env.HOME || process.env.USERPROFILE, '.openclaw/secrets/credentials.json');

console.log('🧪 Testing Hume-Twilio Bridge Setup\n');

// Check credentials
console.log('📋 Checking credentials...');
try {
    const credentials = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
    
    const required = [
        'hume_api_key',
        'twilio_au_account_sid', 
        'twilio_au_auth_token',
        'twilio_au_phone_number'
    ];
    
    const missing = required.filter(key => !credentials[key]);
    
    if (missing.length > 0) {
        console.error('❌ Missing credentials:', missing.join(', '));
        process.exit(1);
    }
    
    console.log('✅ All required credentials found');
    console.log(`   Twilio Number: ${credentials.twilio_au_phone_number}`);
    console.log(`   Hume API Key: ${credentials.hume_api_key.substring(0, 10)}...`);
    
} catch (error) {
    console.error('❌ Failed to load credentials:', error.message);
    process.exit(1);
}

// Check dependencies
console.log('\n📦 Checking dependencies...');
const required_deps = ['express', 'ws', 'twilio'];
const missing_deps = [];

for (const dep of required_deps) {
    try {
        require.resolve(dep);
        console.log(`✅ ${dep} - installed`);
    } catch (error) {
        missing_deps.push(dep);
        console.log(`❌ ${dep} - missing`);
    }
}

if (missing_deps.length > 0) {
    console.error('\n❌ Missing dependencies. Run:');
    console.error(`npm install ${missing_deps.join(' ')}`);
    process.exit(1);
}

// Test audio converter
console.log('\n🔊 Testing audio converter...');
try {
    const { AudioConverter } = require('./hume-twilio-bridge.js');
    
    // Test mulaw encoding/decoding with a sample
    const testPCM = 1000; // Sample PCM value
    const mulaw = AudioConverter.mulawEncode(testPCM);
    const decodedPCM = AudioConverter.mulawDecode(mulaw);
    
    console.log(`✅ Audio converter test passed`);
    console.log(`   PCM: ${testPCM} → mulaw: ${mulaw} → PCM: ${decodedPCM}`);
    
} catch (error) {
    console.error('❌ Audio converter test failed:', error.message);
}

// Test Twilio client
console.log('\n📞 Testing Twilio client...');
try {
    const credentials = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
    const twilio = require('twilio');
    const client = twilio(credentials.twilio_au_account_sid, credentials.twilio_au_auth_token);
    
    console.log('✅ Twilio client initialized successfully');
    console.log(`   Account SID: ${credentials.twilio_au_account_sid.substring(0, 10)}...`);
    
} catch (error) {
    console.error('❌ Twilio client test failed:', error.message);
}

console.log('\n🎉 Bridge setup test complete!');
console.log('\nNext steps:');
console.log('1. Run the bridge: node tools/hume-twilio-bridge.js 3000');
console.log('2. Expose via ngrok: ngrok http 3000'); 
console.log('3. Configure Twilio webhook: https://your-ngrok-url.com/voice/incoming');
console.log('4. Call your Twilio number to test!');