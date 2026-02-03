#!/usr/bin/env node
/**
 * ElevenLabs TTS - Text to Speech
 * 
 * Usage:
 *   node elevenlabs-tts.js "Hello world"                    # Default voice
 *   node elevenlabs-tts.js "Hello" -v Roger                 # Specific voice
 *   node elevenlabs-tts.js "Hello" -o output.mp3            # Save to file
 *   node elevenlabs-tts.js voices                           # List voices
 */

const fs = require('fs');
const path = require('path');

// Load env
function loadEnv() {
  const envPath = path.join(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
      const match = line.match(/^([A-Z_0-9]+)=(.+)$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].trim();
      }
    });
  }
}

loadEnv();

const API_KEY = process.env.ELEVENLABS_API_KEY;
const DEFAULT_VOICE = 'Roger';
const OUTPUT_DIR = path.join(__dirname, '../media/tts');

if (!API_KEY) {
  console.error('ELEVENLABS_API_KEY not set in .env');
  process.exit(1);
}

// Get list of voices
async function listVoices() {
  const response = await fetch('https://api.elevenlabs.io/v1/voices', {
    headers: { 'xi-api-key': API_KEY }
  });
  const data = await response.json();
  
  console.log('\n🎙️  Available Voices:\n');
  data.voices.forEach(v => {
    const labels = v.labels || {};
    console.log(`  ${v.name}`);
    console.log(`    ID: ${v.voice_id}`);
    console.log(`    ${labels.gender || ''} | ${labels.age || ''} | ${labels.accent || ''}`);
    console.log(`    Use: ${labels.use_case || 'general'}`);
    console.log('');
  });
  
  return data.voices;
}

// Find voice by name (partial match)
async function findVoice(name) {
  const response = await fetch('https://api.elevenlabs.io/v1/voices', {
    headers: { 'xi-api-key': API_KEY }
  });
  const data = await response.json();
  
  const voice = data.voices.find(v => 
    v.name.toLowerCase().includes(name.toLowerCase())
  );
  
  if (!voice) {
    console.error(`Voice "${name}" not found. Run 'node elevenlabs-tts.js voices' to see options.`);
    process.exit(1);
  }
  
  return voice;
}

// Generate speech
async function speak(text, voiceName, outputPath) {
  const voice = await findVoice(voiceName);
  console.log(`🎙️  Using voice: ${voice.name}`);
  
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voice.voice_id}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_flash_v2_5',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75
        }
      })
    }
  );
  
  if (!response.ok) {
    const error = await response.json();
    console.error('Error:', error);
    process.exit(1);
  }
  
  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  // Generate filename if not provided
  if (!outputPath) {
    const timestamp = Date.now();
    outputPath = path.join(OUTPUT_DIR, `tts_${timestamp}.mp3`);
  }
  
  // Save audio
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
  
  console.log(`✅ Saved to: ${outputPath}`);
  console.log(`   Text: "${text.slice(0, 50)}${text.length > 50 ? '...' : ''}"`);
  console.log(`   Size: ${(buffer.length / 1024).toFixed(1)} KB`);
  
  return outputPath;
}

// Main
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === 'help' || args[0] === '--help') {
    console.log(`
ElevenLabs TTS

Usage:
  node elevenlabs-tts.js "Text to speak"              # Speak with default voice
  node elevenlabs-tts.js "Text" -v VoiceName          # Speak with specific voice
  node elevenlabs-tts.js "Text" -o output.mp3         # Save to specific file
  node elevenlabs-tts.js voices                       # List available voices

Examples:
  node elevenlabs-tts.js "Hello, I'm Maximus"
  node elevenlabs-tts.js "Good morning!" -v Rachel
`);
    return;
  }
  
  if (args[0] === 'voices') {
    await listVoices();
    return;
  }
  
  // Parse args
  const text = args[0];
  let voice = DEFAULT_VOICE;
  let output = null;
  
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '-v' && args[i + 1]) {
      voice = args[++i];
    } else if (args[i] === '-o' && args[i + 1]) {
      output = args[++i];
    }
  }
  
  await speak(text, voice, output);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
