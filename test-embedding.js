/**
 * Test script for embedding generation
 * This script tests the embedding generation without making actual API calls
 * by checking if the module loads and credentials are available
 */

const credentials = require('./lib/credentials');

console.log('Testing embedding system...\n');

// Check if OpenAI credentials are available
const hasOpenAI = credentials.has('openai');
console.log(`1. OpenAI credentials available: ${hasOpenAI}`);
if (hasOpenAI) {
  console.log('   Key present (first 10 chars):', credentials.get('openai').substring(0, 10) + '...');
} else {
  console.log('   To set up: Add OPENAI_API_KEY to your .env file');
}

// Check if OpenRouter credentials are available (fallback)
const hasOpenRouter = credentials.has('openrouter');
console.log(`\n2. OpenRouter credentials available: ${hasOpenRouter}`);
if (hasOpenRouter) {
  console.log('   Key present (first 10 chars):', credentials.get('openrouter').substring(0, 10) + '...');
} else {
  console.log('   Optional: Add OPENROUTER_API_KEY for fallback embedding generation');
}

// Test loading the embeddings module
try {
  const embeddings = require('./lib/embeddings');
  console.log('\n3. Embeddings module loaded successfully');
  console.log('   Available functions:', Object.keys(embeddings).join(', '));
  
  // Test getEmbeddingDimensions
  const dims = embeddings.getEmbeddingDimensions();
  console.log(`\n4. Default embedding dimensions: ${dims}`);
  
  console.log('\n✅ All checks passed!');
  console.log('\nEmbedding generation will use:');
  console.log('   - OpenAI if OPENAI_API_KEY is available');
  console.log('   - OpenRouter with Gemini embeddings as fallback');
  console.log('\nTo test embedding generation (returns Float32Array):');
  console.log('   node -e "const { generateEmbedding } = require(\'./lib/embeddings\');');
  console.log('   generateEmbedding(\'test text\').then(e => {');
  console.log('     console.log(\'Type:\', e.constructor.name);');
  console.log('     console.log(\'Dimensions:\', e.length);');
  console.log('   }).catch(console.error);"');
  
} catch (error) {
  console.error('\n❌ Failed to load embeddings module:', error.message);
  process.exit(1);
}
