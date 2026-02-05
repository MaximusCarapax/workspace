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
    
    // Example 2: Add a memory without embedding
    console.log('\n2. Adding memory without embedding ---');
    const memoryId1 = await db.addMemory({
      category: 'fact',
      subject: 'Example 1',
      content: text,
      importance: 5,
      source: 'example',
      generateEmbedding: false
    });
    
    console.log(`   Memory created with ID: ${memoryId1} (no embedding)`);
    
    // Example 3: Add a memory with automatic embedding generation
    console.log('\n3. Adding memory with automatic embedding generation ---');
    const memoryId2 = await db.addMemory({
      category: 'fact',
      subject: 'Example 2',
      content: 'A lazy dog sleeps in the sun while a fox runs by',
      importance: 7,
      source: 'example',
      generateEmbedding: true,
      embeddingOptions: {
        model: 'text-embedding-3-small',
        sessionId: 'example-session',
        source: 'example'
      }
    });
    
    console.log(`   Memory created with ID: ${memoryId2} (embedding generated automatically)`);
    
    // Verify the embedding was stored
    const embeddingDirect = db.getMemoryEmbeddingDirect(memoryId2);
    if (embeddingDirect) {
      console.log(`   Embedding dimensions: ${embeddingDirect.length}`);
    }
    
    // Example 4: Add a memory with provided embedding
    console.log('\n4. Adding memory with provided embedding ---');
    const customEmbedding = await db.generateEmbedding('Custom pre-generated embedding text', {
      model: 'text-embedding-3-small',
      sessionId: 'example-session',
      source: 'example'
    });
    
    const memoryId3 = await db.addMemory({
      category: 'preference',
      subject: 'Example 3',
      content: 'I prefer using embeddings for semantic search',
      importance: 8,
      source: 'example',
      embedding: customEmbedding,
      generateEmbedding: false
    });
    
    console.log(`   Memory created with ID: ${memoryId3} (with provided embedding)`);
    
    // Example 3: Test getEmbeddingDimensions
    console.log('\n3. Testing getEmbeddingDimensions ---');
    const dims = db.getEmbeddingDimensions('text-embedding-3-small');
    console.log(`   text-embedding-3-small dimensions: ${dims}`);
    
    // Example 4: Search for similar memories using embedding
    console.log('\n4. Searching for similar memories using embedding ---');
    const searchResults = db.searchMemoryByEmbedding({
      model: 'text-embedding-3-small',
      embedding: embedding,
      limit: 3,
      threshold: 0.8
    });
    
    console.log(`   Found ${searchResults.length} similar memories using embedding search`);
    
    // Example 5: Semantic search using text query
    console.log('\n5. Semantic search using text query ---');
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
    
    // Example 6: Test batch embeddings
    console.log('\n6. Testing batch embeddings ---');
    const texts = [
      "The quick brown fox jumps over the lazy dog",
      "A fast animal leaps over a sleeping canine",
      "Programming is fun and challenging"
    ];
    console.log(`   Generating embeddings for ${texts.length} texts...`);
    
    const batchEmbeddings = await db.generateEmbeddingsBatch(texts, {
      model: 'text-embedding-3-small',
      sessionId: 'example-session',
      source: 'example'
    });
    
    console.log(`   Generated ${batchEmbeddings.length} embeddings`);
    console.log(`   Each embedding has ${batchEmbeddings[0]?.length || 0} dimensions`);
    
    // Example 7: Another semantic search example
    console.log('\n7. Another semantic search example ---');
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
    console.log('\nSummary of exported embedding functions:');
    console.log('   - generateEmbedding: Generate single embedding');
    console.log('   - generateEmbeddingsBatch: Generate multiple embeddings');
    console.log('   - getEmbeddingDimensions: Get dimensions for a model');
    console.log('   - addEmbeddingToMemory: Add embedding to memory');
    console.log('   - semanticSearchMemory: Search with text query');
    console.log('   - searchMemoryByEmbedding: Search with embedding vector');
    console.log('   - generateAndStoreEmbedding: Generate and store embedding');
    
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
