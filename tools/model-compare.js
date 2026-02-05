#!/usr/bin/env node
/**
 * Quick model comparison test
 * Compares response quality and speed between two OpenRouter models
 */

const fs = require('fs');
const path = require('path');

// Load OpenRouter key
let API_KEY;
try {
  const secretsPath = path.join(process.env.HOME, '.openclaw/secrets/openrouter.json');
  const secrets = JSON.parse(fs.readFileSync(secretsPath));
  API_KEY = secrets.api_key || secrets.apiKey || secrets.OPENROUTER_API_KEY;
} catch (e) {
  console.error('Could not load OpenRouter API key');
  process.exit(1);
}

const TESTS = [
  {
    name: 'Summarization',
    prompt: 'Summarize the key differences between REST and GraphQL APIs in 3 bullet points. Be concise.'
  },
  {
    name: 'Reasoning',
    prompt: 'A farmer has 17 sheep. All but 9 run away. How many sheep does the farmer have left? Explain your reasoning briefly.'
  },
  {
    name: 'Code Generation',
    prompt: 'Write a JavaScript function that checks if a string is a palindrome. Keep it simple, no comments needed.'
  },
  {
    name: 'Creative',
    prompt: 'Write a haiku about debugging code at 3am.'
  },
  {
    name: 'Extraction',
    prompt: 'Extract the names and ages from this text: "John is 25 years old and works with Mary who just turned 30. Their manager Bob is 45." Return as JSON.'
  }
];

async function callModel(model, prompt) {
  const start = Date.now();
  
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
      'HTTP-Referer': 'https://openclaw.ai',
      'X-Title': 'Model Comparison Test'
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 500
    })
  });

  const data = await response.json();
  const elapsed = Date.now() - start;
  
  if (data.error) {
    return { error: data.error.message, elapsed };
  }
  
  const content = data.choices?.[0]?.message?.content || '';
  const tokens = data.usage || {};
  
  return {
    content,
    elapsed,
    tokens_in: tokens.prompt_tokens,
    tokens_out: tokens.completion_tokens
  };
}

async function runTests() {
  const models = [
    'google/gemini-2.5-flash-lite',
    'google/gemini-2.5-flash'
  ];
  
  console.log('# Model Comparison: Gemini 2.5-flash-lite vs 2.5-flash\n');
  console.log('Running', TESTS.length, 'tests per model...\n');
  
  const results = {};
  
  for (const model of models) {
    results[model] = { totalTime: 0, totalTokensOut: 0, responses: [] };
  }
  
  for (const test of TESTS) {
    console.log(`## ${test.name}\n`);
    console.log(`**Prompt:** ${test.prompt}\n`);
    
    for (const model of models) {
      const shortName = model.includes('lite') ? '2.5-flash-lite' : '2.5-flash';
      console.log(`### ${shortName}`);
      
      const result = await callModel(model, test.prompt);
      
      if (result.error) {
        console.log(`Error: ${result.error}\n`);
      } else {
        console.log(`**Response (${result.elapsed}ms, ${result.tokens_out} tokens):**`);
        console.log(result.content);
        console.log('');
        
        results[model].totalTime += result.elapsed;
        results[model].totalTokensOut += result.tokens_out || 0;
        results[model].responses.push(result.content);
      }
    }
    console.log('---\n');
  }
  
  // Summary
  console.log('# Summary\n');
  console.log('| Model | Total Time | Avg Time | Total Tokens Out |');
  console.log('|-------|------------|----------|------------------|');
  
  for (const model of models) {
    const r = results[model];
    const shortName = model.includes('lite') ? '2.5-flash-lite' : '2.5-flash';
    const avgTime = Math.round(r.totalTime / TESTS.length);
    console.log(`| ${shortName} | ${r.totalTime}ms | ${avgTime}ms | ${r.totalTokensOut} |`);
  }
  
  console.log('\n**Cost comparison:**');
  console.log('  - 2.5-flash-lite: $0.10/M in, $0.40/M out');
  console.log('  - 2.5-flash: $0.30/M in, $2.50/M out (3x in, 6x out)');
  console.log('\n**Verdict:** Review responses above for quality differences.');
}

runTests().catch(console.error);
