/**
 * Embedding generation utilities
 * Uses OpenAI's text-embedding-3-small model
 */

const credentials = require('./credentials');

// Lazy import to avoid circular dependency with db.js
let _logUsage = null;
function getLogUsage() {
  if (!_logUsage) {
    _logUsage = require('./db').logUsage;
  }
  return _logUsage;
}

// Default embedding model
const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';
// Dimensions for the model
const EMBEDDING_DIMENSIONS = 1536;

/**
 * Generate an embedding for the given text using OpenAI's API
 * @param {string} text - The text to embed
 * @param {Object} options - Optional settings
 * @param {string} options.model - The embedding model to use (default: text-embedding-3-small)
 * @param {string} options.sessionId - Session ID for token usage tracking
 * @param {string} options.source - Source identifier for token usage tracking
 * @returns {Promise<Float32Array>} - The embedding vector as a Float32Array
 */
async function generateEmbedding(text, options = {}) {
  const {
    model = DEFAULT_EMBEDDING_MODEL,
    sessionId = null,
    source = 'embedding'
  } = options;

  const openaiKey = credentials.get('openai');
  if (!openaiKey) {
    throw new Error('OPENAI_API_KEY required for embeddings. Set it in your .env file.');
  }
  
  return await generateEmbeddingOpenAI(text, openaiKey, { model, sessionId, source });
}

/**
 * Generate embedding using OpenAI's API
 * @returns {Promise<Float32Array>} - The embedding vector as a Float32Array
 */
async function generateEmbeddingOpenAI(text, apiKey, options) {
  const { model, sessionId, source } = options;
  
  const url = 'https://api.openai.com/v1/embeddings';
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`
  };
  
  const body = JSON.stringify({
    model: model,
    input: text,
    encoding_format: 'float'
  });

  try {
    const startTime = Date.now();
    const response = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: body
    });

    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    
    // Extract the embedding
    const embeddingArray = data.data[0].embedding;
    
    // Log token usage
    if (data.usage) {
      getLogUsage()({
        sessionId,
        source,
        model,
        provider: 'openai',
        tokensIn: data.usage.prompt_tokens,
        tokensOut: 0,
        costUsd: calculateEmbeddingCost(model, data.usage.prompt_tokens),
        taskType: 'embedding',
        taskDetail: `embedding for text of length ${text.length}`,
        latencyMs
      });
    }

    return new Float32Array(embeddingArray);
  } catch (error) {
    console.error('Failed to generate embedding with OpenAI:', error.message);
    throw error;
  }
}

/**
 * Generate embedding using OpenRouter with Gemini model
 * @returns {Promise<Float32Array>} - The embedding vector as a Float32Array
 */
async function generateEmbeddingOpenRouter(text, apiKey, options) {
  const { sessionId, source } = options;
  
  const url = 'https://openrouter.ai/api/v1/embeddings';
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
    'HTTP-Referer': 'https://openclaw.local', // OpenRouter requires a referer
    'X-Title': 'OpenClaw Agent'
  };
  
  // Use Gemini embedding model via OpenRouter
  const model = 'google/gemini-embedding-exp-03-07';
  
  const body = JSON.stringify({
    model: model,
    input: text
  });

  try {
    const startTime = Date.now();
    const response = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: body
    });

    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    
    // Extract the embedding
    const embeddingArray = data.data[0].embedding;
    
    // Log token usage
    if (data.usage) {
      getLogUsage()({
        sessionId,
        source,
        model,
        provider: 'openrouter',
        tokensIn: data.usage.prompt_tokens,
        tokensOut: 0,
        costUsd: calculateOpenRouterCost(data.usage.prompt_tokens),
        taskType: 'embedding',
        taskDetail: `embedding via OpenRouter for text of length ${text.length}`,
        latencyMs
      });
    }

    return new Float32Array(embeddingArray);
  } catch (error) {
    console.error('Failed to generate embedding with OpenRouter:', error.message);
    throw error;
  }
}

/**
 * Calculate the cost for embedding usage
 * @param {string} model - The embedding model used
 * @param {number} tokens - Number of input tokens
 * @returns {number} - Cost in USD
 */
function calculateEmbeddingCost(model, tokens) {
  // Pricing per 1K tokens (as of 2024)
  const PRICING = {
    'text-embedding-3-small': 0.00002,    // $0.02 per 1M tokens
    'text-embedding-3-large': 0.00013,    // $0.13 per 1M tokens
    'text-embedding-ada-002': 0.00010,    // $0.10 per 1M tokens
  };
  
  const pricePerToken = PRICING[model] || PRICING['text-embedding-3-small'];
  return (tokens * pricePerToken) / 1000; // Convert from per 1K tokens to per token
}

/**
 * Calculate cost for OpenRouter usage
 * @param {number} tokens - Number of input tokens
 * @returns {number} - Cost in USD
 */
function calculateOpenRouterCost(tokens) {
  // OpenRouter pricing for Gemini embedding model (approximate)
  // This is an estimate - actual pricing may vary
  const pricePerToken = 0.0000002; // $0.20 per 1M tokens
  return tokens * pricePerToken;
}

/**
 * Generate embeddings for multiple texts in batch
 * @param {string[]} texts - Array of texts to embed
 * @param {Object} options - Optional settings
 * @returns {Promise<Float32Array[]>} - Array of embedding vectors
 */
async function generateEmbeddingsBatch(texts, options = {}) {
  const {
    model = DEFAULT_EMBEDDING_MODEL,
    sessionId = null,
    source = 'embedding'
  } = options;

  const openaiKey = credentials.get('openai');
  if (!openaiKey) {
    throw new Error('OPENAI_API_KEY required for embeddings. Set it in your .env file.');
  }
  
  return await generateEmbeddingsBatchOpenAI(texts, openaiKey, { model, sessionId, source });
}

/**
 * Generate batch embeddings using OpenAI's API
 */
async function generateEmbeddingsBatchOpenAI(texts, apiKey, options) {
  const { model, sessionId, source } = options;
  
  const url = 'https://api.openai.com/v1/embeddings';
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`
  };
  
  const body = JSON.stringify({
    model: model,
    input: texts,
    encoding_format: 'float'
  });

  try {
    const startTime = Date.now();
    const response = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: body
    });

    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    
    // Log token usage
    if (data.usage) {
      getLogUsage()({
        sessionId,
        source,
        model,
        provider: 'openai',
        tokensIn: data.usage.prompt_tokens,
        tokensOut: 0,
        costUsd: calculateEmbeddingCost(model, data.usage.prompt_tokens),
        taskType: 'embedding_batch',
        taskDetail: `batch embedding for ${texts.length} texts`,
        latencyMs
      });
    }

    return data.data.map(item => new Float32Array(item.embedding));
  } catch (error) {
    console.error('Failed to generate batch embeddings with OpenAI:', error.message);
    throw error;
  }
}

/**
 * Generate batch embeddings using OpenRouter with Gemini model
 */
async function generateEmbeddingsBatchOpenRouter(texts, apiKey, options) {
  const { sessionId, source } = options;
  
  const url = 'https://openrouter.ai/api/v1/embeddings';
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
    'HTTP-Referer': 'https://openclaw.local',
    'X-Title': 'OpenClaw Agent'
  };
  
  const model = 'google/gemini-embedding-exp-03-07';
  
  const body = JSON.stringify({
    model: model,
    input: texts
  });

  try {
    const startTime = Date.now();
    const response = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: body
    });

    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    
    // Log token usage
    if (data.usage) {
      getLogUsage()({
        sessionId,
        source,
        model,
        provider: 'openrouter',
        tokensIn: data.usage.prompt_tokens,
        tokensOut: 0,
        costUsd: calculateOpenRouterCost(data.usage.prompt_tokens),
        taskType: 'embedding_batch',
        taskDetail: `batch embedding via OpenRouter for ${texts.length} texts`,
        latencyMs
      });
    }

    return data.data.map(item => new Float32Array(item.embedding));
  } catch (error) {
    console.error('Failed to generate batch embeddings with OpenRouter:', error.message);
    throw error;
  }
}

/**
 * Get the embedding dimensions for a given model
 * @param {string} model - The embedding model name
 * @returns {number} - Number of dimensions
 */
function getEmbeddingDimensions(model = DEFAULT_EMBEDDING_MODEL) {
  const DIMENSIONS = {
    'text-embedding-3-small': 1536,
    'text-embedding-3-large': 3072,
    'text-embedding-ada-002': 1536,
  };
  
  return DIMENSIONS[model] || EMBEDDING_DIMENSIONS;
}

/**
 * Helper function to add embedding to a memory
 * This creates or updates the embedding in both the memory table and memory_embeddings table
 * @param {number} memoryId - The ID of the memory to update
 * @param {string} text - The text to embed (if not provided, uses memory content)
 * @param {Object} options - Optional settings
 * @returns {Promise<Object>} - Result with embedding (as Float32Array) and metadata
 */
async function addEmbeddingToMemory(memoryId, text = null, options = {}) {
  const { 
    model = DEFAULT_EMBEDDING_MODEL,
    sessionId = null,
    source = 'memory_embedding'
  } = options;
  
  // We need to import db functions here to avoid circular dependencies
  const db = require('./db');
  
  // If text is not provided, fetch the memory content
  let content = text;
  if (!content) {
    const memory = db.prepare('SELECT content FROM memory WHERE id = ?').get(memoryId);
    if (!memory) {
      throw new Error(`Memory with ID ${memoryId} not found`);
    }
    content = memory.content;
  }
  
  // Generate the embedding
  const embedding = await generateEmbedding(content, {
    model,
    sessionId,
    source
  });
  
  // Update the memory table's embedding column
  const updateStmt = db.prepare('UPDATE memory SET embedding = ? WHERE id = ?');
  updateStmt.run(Buffer.from(embedding.buffer), memoryId);
  
  // Also add to memory_embeddings table
  db.addMemoryEmbedding({
    memoryId,
    model,
    embedding
  });
  
  return {
    memoryId,
    model,
    dimensions: embedding.length,
    embedding: embedding
  };
}

module.exports = {
  generateEmbedding,
  generateEmbeddingsBatch,
  getEmbeddingDimensions,
  addEmbeddingToMemory,
  DEFAULT_EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS
};
