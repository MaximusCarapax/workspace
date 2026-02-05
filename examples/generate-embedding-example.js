/**
 * Example of using the embedding generation function
 */

const { generateEmbedding } = require('../lib/embeddings');
const db = require('../lib/db');

async function main() {
  try {
    // First, check if OpenAI credentials are available
    const credentials = require('../lib/credentials');
    if (!credentials.has('openai')) {
      console.error('❌ OpenAI API key not found. Please set OPENAI_API_KEY in your .env file');
      console.error('   You can also check available credentials with: node -e "console.log(require(\'./lib/credentials\').list())"');
      process.exit(1);
    }
    
    console.log('✅ OpenAI credentials available\n');
    
    // Example 1: Generate embedding for a text
    const text = "The quick brown fox jumps over the lazy dog";
    console.log('1. Generating embedding for:', text.substring(0, 50) + '...');
    
    const embedding = await generateEmbedding(text, {
      sessionId: 'example-session',
      source: 'example'
    });
    
    console.log(`   Embedding generated: ${embedding.length} dimensions`);
    console.log(`   First 5 values: ${Array.from(embedding.slice(0, 5)).map(v => v.toFixed(6)).join(', ')}`);
    
    // Example 2: Add a memory with embedding
    console.log('\n2. Adding memory with embedding ---');
    const memoryId = db.addMemory({
      category: 'fact',
      subject: 'Example',
      content: text,
      importance: 5,
      source: 'example'
    });
    
    console.log(`   Memory created with ID: ${memoryId}`);
    
    // Generate and store embedding for this memory
    // Note: generateAndStoreEmbedding is not exported in db.js, so we'll use addEmbeddingToMemory from embeddings
    const { addEmbeddingToMemory } = require('../lib/embeddings');
    const result = await addEmbeddingToMemory(memoryId, null, {
      model: 'text-embedding-3-small',
      sessionId: 'example-session',
      source: 'example'
    });
    
    console.log(`   Embedding stored for memory ${result.memoryId}`);
    console.log(`   Model: ${result.model}, Dimensions: ${result.dimensions}`);
    
    // Example 3: Search for similar memories
    console.log('\n3. Searching for similar memories ---');
    const searchResults = db.searchMemoryByEmbedding({
      model: 'text-embedding-3-small',
      embedding: embedding,
      limit: 3,
      threshold: 0.8
    });
    
    console.log(`   Found ${searchResults.length} similar memories`);
    
    console.log('\n✅ All examples completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.message.includes('API key')) {
      console.error('\n   Make sure you have:');
      console.error('   1. OPENAI_API_KEY in your .env file');
      console.error('   2. The .env file is in the project root directory');
      console.error('   3. You have run: npm install');
    }
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { main };
