/**
 * Embedding generation utilities
 * Uses OpenAI's text-embedding-3-small model
 */

const credentials = require('./credentials');
const { logUsage } = require('./db');

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
 * @returns {Promise<Float32Array>} - The embedding vector
 */
async function generateEmbedding(text, options = {}) {
  const {
    model = DEFAULT_EMBEDDING_MODEL,
    sessionId = null,
    source = 'embedding'
  } = options;

  // Get OpenAI API key from credentials
  const apiKey = credentials.get('openai');
  if (!apiKey) {
    // Check if credentials module is working
    const hasOpenAI = credentials.has('openai');
    throw new Error(`OpenAI API key not found. Credentials has 'openai': ${hasOpenAI}. Set OPENAI_API_KEY in .env file or check lib/credentials.js configuration`);
  }

  // Prepare the request
  const url = 'https://api.openai.com/v1/embeddings';
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`
  };
  
  const body = JSON.stringify({
    model: model,
    input: text,
    encoding_format: 'float'  // Request float format for better precision
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
      logUsage({
        sessionId,
        source,
        model,
        provider: 'openai',
        tokensIn: data.usage.prompt_tokens,
        tokensOut: 0, // Embedding models don't have output tokens
        costUsd: calculateEmbeddingCost(model, data.usage.prompt_tokens),
        taskType: 'embedding',
        taskDetail: `embedding for text of length ${text.length}`,
        latencyMs
      });
    }

    // Convert to Float32Array for efficient storage
    return new Float32Array(embeddingArray);
  } catch (error) {
    console.error('Failed to generate embedding:', error.message);
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

  // Get OpenAI API key from credentials
  const apiKey = credentials.get('openai');
  if (!apiKey) {
    // Check if credentials module is working
    const hasOpenAI = credentials.has('openai');
    throw new Error(`OpenAI API key not found. Credentials has 'openai': ${hasOpenAI}. Set OPENAI_API_KEY in .env file or check lib/credentials.js configuration`);
  }

  // Prepare the request
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
      logUsage({
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

    // Convert each embedding to Float32Array
    return data.data.map(item => new Float32Array(item.embedding));
  } catch (error) {
    console.error('Failed to generate batch embeddings:', error.message);
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
 * @returns {Promise<Object>} - Result with embedding and metadata
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
