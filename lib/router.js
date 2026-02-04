/**
 * Model Router - Automatic routing to cost-effective models
 * 
 * Philosophy: Expensive models think, cheap models do.
 */

const fs = require('fs');
const path = require('path');

// Load db for cost logging
let db;
try {
  db = require('./db');
} catch (e) {
  console.warn('Warning: db.js not found, cost logging disabled');
}

// Routing configuration
const DEFAULT_CONFIG = {
  routes: {
    // Free tier - Gemini
    summarize: 'gemini',
    research: 'gemini',
    extract: 'gemini',
    translate: 'gemini',
    
    // Cheap tier - DeepSeek
    code: 'deepseek',
    debug: 'deepseek',
    refactor: 'deepseek',
    test: 'deepseek',
    
    // Default fallback
    default: 'gemini',
  },
  
  fallbacks: {
    gemini: ['deepseek'],
    deepseek: ['gemini'],
  },
};

// Provider implementations
const providers = {
  gemini: {
    name: 'Gemini (OpenRouter)',
    model: 'google/gemini-2.0-flash-001',
    cost: { in: 0.1, out: 0.4 }, // OpenRouter pricing per million tokens
    
    async complete({ prompt, content, stream }) {
      // Use OpenRouter for Gemini to avoid rate limits
      const creds = require('./credentials');
      const apiKey = creds.getRequired('openrouter');
      
      const OpenAI = require('openai');
      const client = new OpenAI({
        apiKey,
        baseURL: 'https://openrouter.ai/api/v1',
      });
      
      const fullPrompt = content ? `${prompt}\n\n${content}` : prompt;
      
      const response = await client.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: fullPrompt }],
        stream: false,
      });
      
      return {
        text: response.choices[0].message.content,
        tokens: {
          in: response.usage?.prompt_tokens || 0,
          out: response.usage?.completion_tokens || 0,
        },
      };
    },
  },
  
  deepseek: {
    name: 'DeepSeek V3.2',
    model: 'deepseek-chat',
    cost: { in: 0.27, out: 1.10 }, // V3.2 pricing per million tokens
    
    async complete({ prompt, content, stream }) {
      const creds = require('./credentials');
      const apiKey = creds.getRequired('deepseek');
      
      const OpenAI = require('openai');
      
      const client = new OpenAI({
        apiKey,
        baseURL: 'https://api.deepseek.com/v1',
      });
      
      const messages = [
        { role: 'user', content: content ? `${prompt}\n\n${content}` : prompt }
      ];
      
      const response = await client.chat.completions.create({
        model: this.model,
        messages,
        stream: false,
      });
      
      return {
        text: response.choices[0].message.content,
        tokens: {
          in: response.usage?.prompt_tokens || 0,
          out: response.usage?.completion_tokens || 0,
        },
      };
    },
  },
};

/**
 * Detect task type from prompt/content
 */
function detectTaskType(prompt, content) {
  const text = ((prompt || '') + ' ' + (content || '')).toLowerCase();
  
  // Keyword matching
  if (/summarize|summary|tldr|brief|condense/i.test(text)) return 'summarize';
  if (/write (a |the )?(code|function|class|script|program)/i.test(text)) return 'code';
  if (/debug|fix|error|bug|broken|not working/i.test(text)) return 'debug';
  if (/translate|in (spanish|french|german|chinese|japanese)/i.test(text)) return 'translate';
  if (/refactor|clean up|improve|optimize/i.test(text)) return 'refactor';
  if (/test|spec|unit test/i.test(text)) return 'test';
  if (/extract|parse|find all|pull out/i.test(text)) return 'extract';
  if (/research|find out|look up|search for/i.test(text)) return 'research';
  
  // Content analysis
  if (content && content.length > 5000) return 'summarize';
  if (/```/.test(content || '')) return 'code';
  
  return 'default';
}

/**
 * Calculate cost in USD
 */
function calculateCost(provider, tokens) {
  const pricing = providers[provider]?.cost || { in: 0, out: 0 };
  return (tokens.in * pricing.in + tokens.out * pricing.out) / 1_000_000;
}

/**
 * Route a task to the best model
 * 
 * @param {Object} options
 * @param {string} options.type - Explicit task type (optional)
 * @param {string} options.prompt - The prompt/instruction
 * @param {string} options.content - Additional content (optional)
 * @param {string} options.provider - Force specific provider (optional)
 * @param {boolean} options.stream - Stream response (optional)
 * @returns {Promise<Object>} { result, provider, taskType, tokens, cost, latency }
 */
async function route({ type, prompt, content, provider: forceProvider, stream = false }) {
  const config = DEFAULT_CONFIG;
  
  // Detect task type if not specified
  const taskType = type || detectTaskType(prompt, content);
  
  // Get provider from rules (or use override)
  const selectedProvider = forceProvider || config.routes[taskType] || config.routes.default;
  
  // Build provider chain with fallbacks
  const providerChain = [selectedProvider, ...(config.fallbacks[selectedProvider] || [])];
  
  let lastError;
  
  for (const providerName of providerChain) {
    const provider = providers[providerName];
    if (!provider) {
      console.warn(`Unknown provider: ${providerName}`);
      continue;
    }
    
    try {
      const startTime = Date.now();
      const result = await provider.complete({ prompt, content, stream });
      const latency = Date.now() - startTime;
      
      // Calculate cost
      const cost = calculateCost(providerName, result.tokens);
      
      // Log to database
      if (db) {
        try {
          db.logUsage({
            model: `${providerName}/${provider.model}`,
            provider: providerName,
            tokensIn: result.tokens.in,
            tokensOut: result.tokens.out,
            costUsd: cost,
            taskType,
            latencyMs: latency,
          });
        } catch (e) {
          // Non-fatal
        }
      }
      
      return {
        result: result.text,
        provider: providerName,
        model: provider.model,
        taskType,
        tokens: result.tokens,
        cost,
        latency,
      };
    } catch (err) {
      lastError = err;
      const isRetryable = err.message?.includes('quota') || 
                          err.message?.includes('rate limit') ||
                          err.message?.includes('429') ||
                          err.message?.includes('503');
      
      if (isRetryable) {
        console.warn(`${providerName} failed (${err.message}), trying fallback...`);
        continue;
      }
      
      throw err;
    }
  }
  
  throw lastError || new Error('All providers failed');
}

/**
 * Dry run - show what would be selected without executing
 */
function dryRun({ type, prompt, content, provider: forceProvider }) {
  const taskType = type || detectTaskType(prompt, content);
  const selectedProvider = forceProvider || DEFAULT_CONFIG.routes[taskType] || DEFAULT_CONFIG.routes.default;
  const provider = providers[selectedProvider];
  
  return {
    taskType,
    provider: selectedProvider,
    model: provider?.model || 'unknown',
    fallbacks: DEFAULT_CONFIG.fallbacks[selectedProvider] || [],
  };
}

/**
 * Get routing stats from database
 */
async function getStats(days = 7) {
  if (!db) return null;
  
  const stats = db.db.prepare(`
    SELECT 
      task_type,
      model,
      COUNT(*) as calls,
      SUM(tokens_in) as total_in,
      SUM(tokens_out) as total_out,
      SUM(cost_usd) as total_cost
    FROM token_usage
    WHERE created_at > datetime('now', '-' || ? || ' days')
    GROUP BY task_type, model
    ORDER BY total_cost DESC
  `).all(days);
  
  return stats;
}

module.exports = {
  route,
  dryRun,
  detectTaskType,
  getStats,
  providers,
  DEFAULT_CONFIG,
};
