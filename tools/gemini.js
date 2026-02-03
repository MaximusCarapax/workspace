#!/usr/bin/env node
/**
 * Gemini CLI wrapper - free tier, rate-limit aware
 * 
 * Usage:
 *   node gemini.js "your prompt here"
 *   node gemini.js -m gemini-2.5-flash "prompt"
 *   echo "prompt" | node gemini.js -
 *   node gemini.js -f file.txt "explain this code"
 */

const fs = require('fs');
const path = require('path');

// Load API key from .env
const envPath = path.join(__dirname, '..', '.env');
let API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY && fs.existsSync(envPath)) {
  const env = fs.readFileSync(envPath, 'utf8');
  const match = env.match(/GEMINI_API_KEY=(.+)/);
  if (match) API_KEY = match[1].trim();
}

if (!API_KEY) {
  console.error('Error: GEMINI_API_KEY not found in environment or .env');
  process.exit(1);
}

// Parse args
const args = process.argv.slice(2);
let model = 'gemini-2.5-flash';  // Default to 2.5-flash (2.0 has tighter limits)
let fileContext = null;
let prompt = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '-m' && args[i + 1]) {
    model = args[++i];
    if (!model.startsWith('gemini-')) model = `gemini-${model}`;
  } else if (args[i] === '-f' && args[i + 1]) {
    const filePath = args[++i];
    if (fs.existsSync(filePath)) {
      fileContext = fs.readFileSync(filePath, 'utf8');
    } else {
      console.error(`Error: File not found: ${filePath}`);
      process.exit(1);
    }
  } else if (args[i] === '-') {
    // Read from stdin
    prompt = fs.readFileSync(0, 'utf8').trim();
  } else if (!prompt) {
    prompt = args[i];
  }
}

if (!prompt) {
  console.error('Usage: gemini.js [-m model] [-f file] "prompt"');
  console.error('Models: gemini-2.5-flash (default), gemini-2.0-flash, gemini-2.5-pro');
  process.exit(1);
}

// Build full prompt with file context
if (fileContext) {
  prompt = `File contents:\n\`\`\`\n${fileContext}\n\`\`\`\n\n${prompt}`;
}

async function callGemini(prompt, retries = 3) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 8192,
          }
        })
      });

      const data = await res.json();

      if (data.error) {
        // Rate limit - wait and retry
        if (data.error.code === 429) {
          const retryMatch = data.error.message.match(/retry in ([\d.]+)s/i);
          const waitTime = retryMatch ? parseFloat(retryMatch[1]) + 1 : 30;
          
          if (attempt < retries) {
            console.error(`Rate limited. Waiting ${waitTime}s... (attempt ${attempt}/${retries})`);
            await new Promise(r => setTimeout(r, waitTime * 1000));
            continue;
          }
        }
        console.error(`Error: ${data.error.message}`);
        process.exit(1);
      }

      // Extract response text
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        console.log(text);
        return;
      } else {
        console.error('No response generated');
        process.exit(1);
      }
    } catch (err) {
      console.error(`Request failed: ${err.message}`);
      if (attempt === retries) process.exit(1);
    }
  }
}

callGemini(prompt);
