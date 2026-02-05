#!/usr/bin/env node
/**
 * Gemini CLI wrapper - uses OpenRouter by default (no rate limits)
 * 
 * Usage:
 *   node gemini.js "your prompt here"
 *   node gemini.js -m gemini-2.5-flash "prompt"
 *   node gemini.js -f file.txt "explain this code"
 *   node gemini.js --no-fallback "prompt"  # Direct Gemini only (free but rate limited)
 */

const fs = require('fs');
const path = require('path');

// Load API keys - collect all Gemini keys for fallback chain
const envPath = path.join(__dirname, '..', '.env');
const GEMINI_KEYS = [];
let OPENROUTER_KEY = null;

// Read from .env
if (fs.existsSync(envPath)) {
  const env = fs.readFileSync(envPath, 'utf8');
  const geminiMatch = env.match(/GEMINI_API_KEY=(.+)/m);
  if (geminiMatch) GEMINI_KEYS.push(geminiMatch[1].trim());
  const gemini2Match = env.match(/GEMINI_API_KEY_2=(.+)/m);
  if (gemini2Match && gemini2Match[1].trim() !== GEMINI_KEYS[0]) {
    GEMINI_KEYS.push(gemini2Match[1].trim());
  }
  const orMatch = env.match(/OPENROUTER_API_KEY=(.+)/m);
  if (orMatch) OPENROUTER_KEY = orMatch[1].trim();
}

// Read from credentials.json (backup key)
try {
  const creds = JSON.parse(fs.readFileSync(path.join(process.env.HOME, '.openclaw/secrets/credentials.json')));
  if (creds.gemini?.apiKey && !GEMINI_KEYS.includes(creds.gemini.apiKey)) {
    GEMINI_KEYS.push(creds.gemini.apiKey);
  }
} catch {}

// Environment variables as last resort
if (GEMINI_KEYS.length === 0 && process.env.GEMINI_API_KEY) {
  GEMINI_KEYS.push(process.env.GEMINI_API_KEY);
}
if (!OPENROUTER_KEY) OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;

// Try OpenRouter secrets file
if (!OPENROUTER_KEY) {
  try {
    const secrets = JSON.parse(fs.readFileSync(path.join(process.env.HOME, '.openclaw/secrets/openrouter.json')));
    OPENROUTER_KEY = secrets.api_key;
  } catch {}
}

// Model mapping for OpenRouter
const OPENROUTER_MODELS = {
  'gemini-2.5-flash': 'google/gemini-2.5-flash-lite',  // Lite for cost efficiency
  'gemini-2.5-flash-lite': 'google/gemini-2.5-flash-lite',
  'gemini-2.0-flash': 'google/gemini-2.5-flash-lite',  // Upgraded to 2.5-lite
  'gemini-2.5-pro': 'google/gemini-2.5-flash-lite',    // Fallback to flash-lite
};

// Parse args
const args = process.argv.slice(2);
let model = 'gemini-2.5-flash';
let fileContext = null;
let prompt = null;
let allowFallback = true;

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
    prompt = fs.readFileSync(0, 'utf8').trim();
  } else if (args[i] === '--no-fallback') {
    allowFallback = false;
  } else if (!prompt) {
    prompt = args[i];
  }
}

if (!prompt) {
  console.error('Usage: gemini.js [-m model] [-f file] [--no-fallback] "prompt"');
  console.error('Models: gemini-2.5-flash (default), gemini-2.0-flash, gemini-2.5-pro');
  console.error('Falls back to OpenRouter if Gemini quota exceeded.');
  process.exit(1);
}

if (fileContext) {
  prompt = `File contents:\n\`\`\`\n${fileContext}\n\`\`\`\n\n${prompt}`;
}

// Log usage to SQLite
function logUsage(provider, modelName, tokensIn, tokensOut, cost) {
  try {
    const db = require('../lib/db');
    db.logUsage({
      model: modelName,
      provider: provider,
      tokensIn: tokensIn || 0,
      tokensOut: tokensOut || 0,
      costUsd: cost || 0,
      taskType: 'tool',
      taskDetail: 'gemini.js CLI'
    });
  } catch {}
}

// Call Gemini directly (free tier) - tries multiple keys
async function callGemini(prompt) {
  if (GEMINI_KEYS.length === 0) {
    throw new Error('No GEMINI_API_KEY found');
  }
  
  for (let keyIndex = 0; keyIndex < GEMINI_KEYS.length; keyIndex++) {
    const apiKey = GEMINI_KEYS[keyIndex];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    
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
        // Rate limit or quota - try next key
        if (data.error.code === 429 || data.error.message?.includes('quota') || 
            data.error.message?.includes('exhausted') || data.error.message?.includes('expired')) {
          if (keyIndex < GEMINI_KEYS.length - 1) {
            console.error(`⚡ Key ${keyIndex + 1} quota exceeded, trying key ${keyIndex + 2}...`);
            continue;
          }
          throw new Error(`QUOTA_EXCEEDED: ${data.error.message}`);
        }
        throw new Error(data.error.message);
      }

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        const usage = data.usageMetadata || {};
        logUsage('gemini', model, usage.promptTokenCount, usage.candidatesTokenCount, 0);
        if (keyIndex > 0) console.error(`[Used Gemini key ${keyIndex + 1}]`);
        return text;
      }
      
      throw new Error('No response generated');
    } catch (err) {
      // If it's a quota error and we have more keys, continue
      if (err.message.includes('QUOTA_EXCEEDED') && keyIndex < GEMINI_KEYS.length - 1) {
        continue;
      }
      throw err;
    }
  }
  
  throw new Error('All Gemini keys exhausted');
}

// Call OpenRouter as fallback
async function callOpenRouter(prompt) {
  if (!OPENROUTER_KEY) {
    throw new Error('OPENROUTER_API_KEY not found for fallback');
  }
  
  const orModel = OPENROUTER_MODELS[model] || 'google/gemini-2.5-flash-lite';
  
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://openclaw.ai',
      'X-Title': 'OpenClaw Gemini Fallback'
    },
    body: JSON.stringify({
      model: orModel,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`OpenRouter error: ${res.status} - ${error}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  
  if (text) {
    const usage = data.usage || {};
    // OpenRouter charges ~$0.10/M for Gemini Flash
    const cost = ((usage.prompt_tokens || 0) * 0.075 + (usage.completion_tokens || 0) * 0.30) / 1_000_000;
    logUsage('openrouter', orModel, usage.prompt_tokens, usage.completion_tokens, cost);
    console.error(`[OpenRouter: ${usage.prompt_tokens || 0} in / ${usage.completion_tokens || 0} out | $${cost.toFixed(6)}]`);
    return text;
  }
  
  throw new Error('No response from OpenRouter');
}

// Topic extraction function
async function extractTopics(text) {
    try {
        // Use the first available Gemini key
        if (GEMINI_KEYS.length === 0) {
            throw new Error('No GEMINI_API_KEY found');
        }
        
        const apiKey = GEMINI_KEYS[0];
        const model = 'gemini-2.0-flash';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        
        const prompt = `Extract 1-3 main topic tags from the following conversation chunk. 
        Return only a comma-separated list of tags, no other text.
        
        Conversation:
        ${text.substring(0, 2000)}`;
        
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.1,
                    maxOutputTokens: 50,
                }
            })
        });

        const data = await res.json();
        
        if (data.error) {
            throw new Error(data.error.message);
        }

        const topicsText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (!topicsText) {
            throw new Error('No response generated');
        }
        
        // Parse comma-separated tags
        const topics = topicsText.split(',').map(tag => 
            tag.trim().toLowerCase().replace(/[^a-z0-9\-]/g, '-')
        ).filter(tag => tag.length > 0);
        
        return topics.slice(0, 3);
    } catch (error) {
        console.warn('Gemini topic extraction failed, using fallback:', error.message);
        // Fallback to keyword extraction
        const words = text.toLowerCase().split(/\s+/);
        const commonWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were']);
        const keywords = words
            .filter(word => word.length > 3 && !commonWords.has(word))
            .slice(0, 3);
        return keywords;
    }
}

// Auto-log tool usage (silent fail)
function logToolUsage(provider, promptLength, success) {
  try {
    const { logTool } = require('../lib/auto-log');
    logTool('gemini', `Gemini query (${provider}): ${promptLength} chars`, {
      provider,
      prompt_length: promptLength,
      model,
      success
    });
  } catch (e) {
    // Silent fail
  }
}

// Main
async function main() {
  // Default: Use OpenRouter (no rate limits)
  // Fallback: Direct Gemini API (free but rate limited)
  
  if (OPENROUTER_KEY && allowFallback) {
    try {
      const result = await callOpenRouter(prompt);
      logToolUsage('openrouter', prompt.length, true);
      console.log(result);
      return;
    } catch (err) {
      console.error(`⚡ OpenRouter failed (${err.message}), trying direct Gemini...`);
    }
  }
  
  // Fallback to direct Gemini
  try {
    const result = await callGemini(prompt);
    logToolUsage('gemini-direct', prompt.length, true);
    console.log(result);
  } catch (err) {
    logToolUsage('gemini-direct', prompt.length, false);
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

// Export for use by other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        extractTopics,
        callGemini,
        callOpenRouter,
        logUsage,
        logToolUsage
    };
}

// Only run main if this is the main module
if (require.main === module) {
    main();
}
