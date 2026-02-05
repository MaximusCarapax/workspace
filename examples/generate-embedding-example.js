/**
 * Example of using the embedding generation function
 */

const { generateEmbedding } = require('../lib/embeddings');
const db = require('../lib/db');

async function main() {
  try {
    // First, check if any embedding credentials are available
    const credentials = require('../lib/credentials');
    const hasOpenAI = credentials.has('openai');
    const hasOpenRouter = credentials.has('openrouter');
    
    if (!hasOpenAI && !hasOpenRouter) {
      console.error('❌ No embedding API keys found.');
      console.error('   Please set either OPENAI_API_KEY or OPENROUTER_API_KEY in your .env file');
      console.error('   You can check available credentials with: node -e "console.log(require(\'./lib/credentials\').list())"');
      process.exit(1);
    }
    
    console.log('✅ Embedding credentials available:');
    if (hasOpenAI) console.log('   - OpenAI');
    if (hasOpenRouter) console.log('   - OpenRouter (fallback)');
    console.log();
    
    // Example 1: Generate embedding for a text
    const text = "The quick brown fox jumps over the lazy dog";
    console.log('1. Generating embedding for:', text.substring(0, 50) + '...');
    
    const embedding = await generateEmbedding(text, {
      sessionId: 'example-session',
      source: 'example'
    });
    
    console.log(`   Embedding generated: ${embedding.length} dimensions`);
    console.log(`   Type: ${embedding.constructor.name}`); // Should be Float32Array
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
    // Use the generateAndStoreEmbedding function from db.js
    const result = await db.generateAndStoreEmbedding(memoryId, {
      model: 'text-embedding-3-small',
      sessionId: 'example-session',
      source: 'example'
    });
    
    console.log(`   Embedding stored for memory ${result.memoryId}`);
    console.log(`   Model: ${result.model}, Dimensions: ${result.dimensions}`);
    
    // Example 3: Search for similar memories using embedding
    console.log('\n3. Searching for similar memories using embedding ---');
    const searchResults = db.searchMemoryByEmbedding({
      model: 'text-embedding-3-small',
      embedding: embedding,
      limit: 3,
      threshold: 0.8
    });
    
    console.log(`   Found ${searchResults.length} similar memories using embedding search`);
    
    // Example 4: Semantic search using text query
    console.log('\n4. Semantic search using text query ---');
    console.log('   This function takes a query string, generates an embedding for it,');
    console.log('   and finds the most similar memories using cosine similarity.');
    
    const semanticQuery = "fast animal jumping over a sleeping dog";
    console.log(`   Query: "${semanticQuery}"`);
    
    const semanticResults = await db.semanticSearchMemory(semanticQuery, {
      model: 'text-embedding-3-small',
      limit: 3,
      threshold: 0.7,
      sessionId: 'example-session',
      source: 'example'
    });
    
    console.log(`   Found ${semanticResults.length} semantically similar memories`);
    if (semanticResults.length > 0) {
      semanticResults.forEach((result, i) => {
        console.log(`   ${i + 1}. Similarity: ${(result.similarity * 100).toFixed(1)}%`);
        console.log(`      Content: ${result.content.substring(0, 60)}...`);
      });
    }
    
    // Example 5: Another semantic search example
    console.log('\n5. Another semantic search example ---');
    const semanticQuery2 = "wildlife in the forest";
    console.log(`   Query: "${semanticQuery2}"`);
    
    const semanticResults2 = await db.semanticSearchMemory(semanticQuery2, {
      model: 'text-embedding-3-small',
      limit: 2,
      threshold: 0.5,
      sessionId: 'example-session',
      source: 'example'
    });
    
    console.log(`   Found ${semanticResults2.length} results`);
    if (semanticResults2.length > 0) {
      semanticResults2.forEach((result, i) => {
        console.log(`   ${i + 1}. Similarity: ${(result.similarity * 100).toFixed(1)}%`);
        console.log(`      Content: ${result.content.substring(0, 60)}...`);
      });
    }
    
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
