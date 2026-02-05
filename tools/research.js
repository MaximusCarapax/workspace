#!/usr/bin/env node
/**
 * Research helper - fetches URLs and summarizes using Gemini via OpenRouter or DeepSeek
 * 
 * Usage:
 *   node tools/research.js -q "question" url1 url2 url3
 *   node tools/research.js -q "question" -f urls.txt
 *   node tools/research.js --deepseek -q "question" url1  # Force DeepSeek
 * 
 * The script:
 * 1. Fetches each URL (with content limits)
 * 2. Sends all content to Gemini (via OpenRouter) or DeepSeek with the research question
 * 3. Returns a structured summary
 * 
 * Token-efficient: Opus plans, cheap models fetch & summarize
 * Cost: Gemini ~$0.10/M via OpenRouter, DeepSeek ~$0.27/M
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');

// Load .env
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// API Keys (from environment or secrets file)
let OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;
let BRAVE_API_KEY = process.env.BRAVE_API_KEY;

// Try loading OpenRouter key from secrets file if not in env
if (!OPENROUTER_KEY) {
  try {
    const secretsPath = path.join(process.env.HOME, '.openclaw/secrets/openrouter.json');
    if (fs.existsSync(secretsPath)) {
      const secrets = JSON.parse(fs.readFileSync(secretsPath));
      OPENROUTER_KEY = secrets.apiKey || secrets.OPENROUTER_API_KEY;
    }
  } catch (e) {}
}

// Try loading Brave API key from config file if not in env
if (!BRAVE_API_KEY) {
  try {
    const configPath = path.join(process.env.HOME, '.openclaw/openclaw.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      BRAVE_API_KEY = config.tools?.web?.search?.apiKey;
    }
  } catch (e) {}
}

if (!OPENROUTER_KEY && !DEEPSEEK_KEY) {
  console.error('Error: No API keys found. Set OPENROUTER_API_KEY or DEEPSEEK_API_KEY in .env');
  process.exit(1);
}

// Config
const MAX_CHARS_PER_PAGE = 4000;
const MAX_TOTAL_CHARS = 20000;
const FETCH_TIMEOUT = 10000;

// Search Brave API
async function searchBrave(query, count = 5) {
  if (!BRAVE_API_KEY) {
    throw new Error('Brave API key not found. Set BRAVE_API_KEY in .env or in ~/.openclaw/openclaw.json');
  }
  
  return new Promise((resolve, reject) => {
    const encodedQuery = encodeURIComponent(query);
    const options = {
      hostname: 'api.search.brave.com',
      path: `/res/v1/web/search?q=${encodedQuery}&count=${count}&safesearch=off`,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'X-Subscription-Token': BRAVE_API_KEY
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            reject(new Error(json.error.message || 'Brave API error'));
          } else if (json.web && json.web.results) {
            const urls = json.web.results.map(result => result.url).filter(url => url);
            resolve(urls);
          } else {
            resolve([]);
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    
    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Brave search timeout'));
    });
    req.end();
  });
}

// Fetch URL content
async function fetchUrl(url) {
  return new Promise((resolve) => {
    const protocol = url.startsWith('https') ? https : http;
    const timeout = setTimeout(() => resolve({ url, error: 'Timeout' }), FETCH_TIMEOUT);
    
    const req = protocol.get(url, { 
      headers: { 
        'User-Agent': 'Mozilla/5.0 (compatible; ResearchBot/1.0)',
        'Accept': 'text/html,application/xhtml+xml'
      }
    }, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        clearTimeout(timeout);
        const newUrl = new URL(res.headers.location, url).href;
        resolve(fetchUrl(newUrl));
        return;
      }
      
      if (res.statusCode !== 200) {
        clearTimeout(timeout);
        resolve({ url, error: `HTTP ${res.statusCode}` });
        return;
      }
      
      let data = '';
      res.on('data', chunk => {
        data += chunk;
        if (data.length > 500000) res.destroy(); // Limit raw HTML
      });
      res.on('end', () => {
        clearTimeout(timeout);
        resolve({ url, html: data });
      });
    });
    
    req.on('error', (e) => {
      clearTimeout(timeout);
      resolve({ url, error: e.message });
    });
  });
}

// Extract readable content from HTML
function extractContent(html, url) {
  try {
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    
    if (article && article.textContent) {
      let content = article.textContent
        .replace(/\s+/g, ' ')
        .replace(/\n\s*\n/g, '\n\n')
        .trim();
      
      if (content.length > MAX_CHARS_PER_PAGE) {
        content = content.slice(0, MAX_CHARS_PER_PAGE) + '... [truncated]';
      }
      
      return {
        title: article.title || 'Untitled',
        content
      };
    }
  } catch (e) {}
  
  // Fallback: basic text extraction
  const text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CHARS_PER_PAGE);
  
  return { title: 'Untitled', content: text };
}

// Call Gemini via OpenRouter (avoids rate limits)
async function callGemini(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'google/gemini-2.5-flash-lite',
      messages: [
        { role: 'system', content: 'You are a research assistant. Analyze the provided sources and answer the question. Be thorough but concise. Cite sources when making claims.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 2048
    });

    const req = https.request({
      hostname: 'openrouter.ai',
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
        'HTTP-Referer': 'https://openclaw.ai',
        'X-Title': 'OpenClaw Research'
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            // Check if it's a quota/rate error
            if (json.error.code === 429 || json.error.message?.includes('quota') || json.error.message?.includes('rate')) {
              reject(new Error('QUOTA_EXCEEDED'));
            } else {
              reject(new Error(json.error.message || JSON.stringify(json.error)));
            }
          } else if (json.choices && json.choices[0]) {
            resolve(json.choices[0].message.content);
          } else {
            reject(new Error('No response from Gemini via OpenRouter'));
          }
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Call DeepSeek
async function callDeepSeek(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: 'You are a research assistant. Analyze the provided sources and answer the question. Be thorough but concise. Cite sources when making claims.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 2048
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

// Main
async function main() {
  const args = process.argv.slice(2);
  
  let question = '';
  let urls = [];
  let forceDeepSeek = false;
  let urlFile = null;
  let searchQuery = null;
  
  // Parse args
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-q' || args[i] === '--question') {
      question = args[++i];
    } else if (args[i] === '-f' || args[i] === '--file') {
      urlFile = args[++i];
    } else if (args[i] === '--deepseek' || args[i] === '-d') {
      forceDeepSeek = true;
    } else if (args[i] === '-s' || args[i] === '--search') {
      searchQuery = args[++i];
    } else if (args[i] === '-h' || args[i] === '--help') {
      console.log(`
Research Helper - Fetch and summarize URLs using Gemini/DeepSeek

Usage:
  node research.js -q "question" url1 url2 url3
  node research.js -q "question" -f urls.txt
  node research.js --deepseek -q "question" url1
  node research.js -s 'search query' -q 'research question'

Options:
  -q, --question   Research question (required)
  -f, --file       File containing URLs (one per line)
  -d, --deepseek   Force DeepSeek (skip Gemini)
  -s, --search     Search query for Brave Search (optional)
  -h, --help       Show this help

The script fetches URLs, extracts content, and summarizes using:
1. Gemini via OpenRouter (~$0.10/M) - primary, no rate limits
2. DeepSeek (~$0.27/M) - fallback

Max ${MAX_CHARS_PER_PAGE} chars per page, ${MAX_TOTAL_CHARS} total.
`);
      process.exit(0);
    } else if (args[i].startsWith('http')) {
      urls.push(args[i]);
    }
  }
  
  // Handle search query
  if (searchQuery) {
    console.error(`[Research] Searching Brave for: "${searchQuery}"...`);
    try {
      const searchUrls = await searchBrave(searchQuery, 5);
      if (searchUrls.length === 0) {
        console.error('Error: No search results found');
        process.exit(1);
      }
      console.error(`[Research] Found ${searchUrls.length} result(s):`);
      searchUrls.forEach((url, i) => console.error(`  ${i + 1}. ${url}`));
      urls = [...urls, ...searchUrls];
    } catch (e) {
      console.error(`Error searching Brave: ${e.message}`);
      process.exit(1);
    }
  }
  
  // Load URLs from file if specified
  if (urlFile && fs.existsSync(urlFile)) {
    const fileUrls = fs.readFileSync(urlFile, 'utf8')
      .split('\n')
      .map(u => u.trim())
      .filter(u => u.startsWith('http'));
    urls = [...urls, ...fileUrls];
  }
  
  if (!question) {
    console.error('Error: Question required. Use -q "your question"');
    process.exit(1);
  }
  
  if (urls.length === 0) {
    console.error('Error: No URLs provided (and no search query used)');
    console.error('Either provide URLs directly or use -s to search');
    process.exit(1);
  }
  
  console.error(`[Research] Fetching ${urls.length} URL(s)...`);
  
  // Fetch all URLs in parallel
  const results = await Promise.all(urls.map(fetchUrl));
  
  // Extract content
  let sources = [];
  let totalChars = 0;
  
  for (const result of results) {
    if (result.error) {
      console.error(`  ✗ ${result.url}: ${result.error}`);
      continue;
    }
    
    const extracted = extractContent(result.html, result.url);
    if (extracted.content.length < 100) {
      console.error(`  ✗ ${result.url}: Too little content`);
      continue;
    }
    
    // Check total limit
    if (totalChars + extracted.content.length > MAX_TOTAL_CHARS) {
      const remaining = MAX_TOTAL_CHARS - totalChars;
      if (remaining > 500) {
        extracted.content = extracted.content.slice(0, remaining) + '... [truncated]';
      } else {
        console.error(`  ⚠ ${result.url}: Skipped (total limit reached)`);
        continue;
      }
    }
    
    sources.push({
      url: result.url,
      title: extracted.title,
      content: extracted.content
    });
    totalChars += extracted.content.length;
    console.error(`  ✓ ${result.url} (${extracted.content.length} chars)`);
  }
  
  if (sources.length === 0) {
    console.error('Error: No content could be extracted from any URL');
    process.exit(1);
  }
  
  // Build prompt
  const sourcesText = sources.map((s, i) => 
    `[Source ${i + 1}] ${s.title}\nURL: ${s.url}\n\n${s.content}`
  ).join('\n\n---\n\n');
  
  const prompt = `Research Question: ${question}

I have gathered the following sources. Please analyze them and provide a comprehensive answer to the research question.

Structure your response as:
1. **Summary** - Direct answer to the question (2-3 sentences)
2. **Key Findings** - Main points from the sources (bullet points)
3. **Details** - Deeper analysis if relevant
4. **Sources Used** - Which sources were most useful

---

${sourcesText}`;

  console.error(`[Research] Summarizing ${sources.length} source(s) (${totalChars} chars)...`);
  
  // Try Gemini first, fall back to DeepSeek
  let result;
  let provider;
  
  if (!forceDeepSeek) {
    try {
      console.error('[Research] Using Gemini...');
      result = await callGemini(prompt);
      provider = 'Gemini';
    } catch (e) {
      if (e.message === 'QUOTA_EXCEEDED') {
        console.error('[Research] Gemini quota exceeded, falling back to DeepSeek...');
      } else {
        console.error(`[Research] Gemini failed: ${e.message}, falling back to DeepSeek...`);
      }
    }
  }
  
  if (!result) {
    try {
      console.error('[Research] Using DeepSeek...');
      result = await callDeepSeek(prompt);
      provider = 'DeepSeek';
    } catch (e) {
      console.error(`[Research] DeepSeek failed: ${e.message}`);
      process.exit(1);
    }
  }
  
  console.error(`[Research] Done (${provider})\n`);
  console.log(result);
}

// Check for required dependencies
try {
  require('jsdom');
  require('@mozilla/readability');
} catch (e) {
  console.error('Installing required dependencies...');
  require('child_process').execSync('npm install jsdom @mozilla/readability', { 
    stdio: 'inherit',
    cwd: __dirname 
  });
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
