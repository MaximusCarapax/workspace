#!/usr/bin/env node
/**
 * Code generation router - routes to DeepSeek (cheap) or Gemini (free)
 * 
 * Usage:
 *   node tools/code.js "prompt"              # DeepSeek (default)
 *   node tools/code.js -g "prompt"           # Gemini (free)
 *   node tools/code.js -f path/to/file "prompt"  # Include file context
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Load .env if present
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;

if (!DEEPSEEK_KEY && !GEMINI_KEY) {
  console.error('Error: No API keys found. Set DEEPSEEK_API_KEY or GEMINI_API_KEY in .env');
  process.exit(1);
}

async function callDeepSeek(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: 'You are an expert programmer. Write clean, working code. Be concise.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 4096
    });

    const req = https.request({
      hostname: 'api.deepseek.com',
      path: '/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DEEPSEEK_KEY}`,
        'Content-Type': 'application/json'
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) reject(new Error(json.error.message));
          else resolve(json.choices[0].message.content);
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function callGemini(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    });

    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) reject(new Error(json.error.message));
          else resolve(json.candidates[0].content.parts[0].text);
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const args = process.argv.slice(2);
  
  let useGemini = false;
  let fileContext = '';
  let prompt = '';
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-g') useGemini = true;
    else if (args[i] === '-f' && args[i+1]) {
      const filePath = args[++i];
      if (fs.existsSync(filePath)) {
        fileContext = `\n\nFile: ${filePath}\n\`\`\`\n${fs.readFileSync(filePath, 'utf8')}\n\`\`\`\n`;
      }
    }
    else prompt += (prompt ? ' ' : '') + args[i];
  }
  
  if (!prompt) {
    console.log('Usage: node code.js [-g] [-f file] "prompt"');
    console.log('  -g: Use Gemini (free) instead of DeepSeek');
    console.log('  -f: Include file as context');
    process.exit(1);
  }
  
  const fullPrompt = prompt + fileContext;
  
  try {
    const provider = useGemini ? 'Gemini' : 'DeepSeek';
    console.error(`[${provider}] Generating...`);
    
    const result = useGemini 
      ? await callGemini(fullPrompt)
      : await callDeepSeek(fullPrompt);
    
    console.log(result);
  } catch(e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

main();
