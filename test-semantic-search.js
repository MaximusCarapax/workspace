/**
 * Test semantic search functionality
 */

const db = require('./lib/db');

async function testSemanticSearch() {
  console.log('Testing semantic search...\n');
  
  try {
    // First, check if we have any memories with embeddings
    const memoriesWithEmbeddings = db.getMemoriesWithEmbeddings('text-embedding-3-small', 5);
    console.log(`1. Found ${memoriesWithEmbeddings.length} memories with embeddings`);
    
    if (memoriesWithEmbeddings.length === 0) {
      console.log('   No memories with embeddings found. Creating test memories...');
      
      // Create a test memory without embedding
      const testMemoryId1 = await db.addMemory({
        category: 'fact',
        subject: 'Test Animal 1',
        content: 'A quick brown fox jumps over a lazy dog in the forest.',
        importance: 5,
        source: 'test',
        generateEmbedding: false
      });
      
      console.log(`   Created memory without embedding: ID ${testMemoryId1}`);
      
      // Create a test memory with automatic embedding generation
      const testMemoryId2 = await db.addMemory({
        category: 'fact',
        subject: 'Test Animal 2',
        content: 'Foxes are quick and agile animals that can jump high fences.',
        importance: 6,
        source: 'test',
        generateEmbedding: true,
        embeddingOptions: {
          model: 'text-embedding-3-small',
          sessionId: 'test-session',
          source: 'test'
        }
      });
      
      console.log(`   Created memory with auto-embedding: ID ${testMemoryId2}`);
      
      // Create another memory with different content
      const testMemoryId3 = await db.addMemory({
        category: 'lesson',
        subject: 'Programming Tip',
        content: 'Always write tests for your code to ensure it works correctly.',
        importance: 8,
        source: 'test',
        generateEmbedding: true,
        embeddingOptions: {
          model: 'text-embedding-3-small',
          sessionId: 'test-session',
          source: 'test'
        }
      });
      
      console.log(`   Created memory with auto-embedding: ID ${testMemoryId3}`);
    }
    
    // Test semantic search with a query similar to the memory content
    console.log('\n2. Testing semantic search with query: "fast fox jumping"');
    const results = await db.semanticSearchMemory('fast fox jumping', {
      model: 'text-embedding-3-small',
      limit: 5,
      threshold: 0.5,
      sessionId: 'test-session',
      source: 'test'
    });
    
    console.log(`   Found ${results.length} results`);
    
    if (results.length > 0) {
      console.log('\n   Top results (with similarity scores):');
      results.forEach((result, i) => {
        console.log(`   ${i + 1}. Similarity: ${(result.similarity * 100).toFixed(1)}%`);
        console.log(`      Content: ${result.content.substring(0, 60)}...`);
        console.log(`      Category: ${result.category}, Importance: ${result.importance}`);
      });
      console.log('\n   Note: All results include similarity scores between 0 and 1');
      console.log('         where 1 means identical and 0 means completely different');
    } else {
      console.log('   No results found. Try lowering the threshold.');
    }
    
    // Test with a different query that should still be somewhat related
    console.log('\n3. Testing semantic search with query: "sleeping animal"');
    const results2 = await db.semanticSearchMemory('sleeping animal', {
      model: 'text-embedding-3-small',
      limit: 5,
      threshold: 0.3,
      sessionId: 'test-session',
      source: 'test'
    });
    
    console.log(`   Found ${results2.length} results`);
    
    // Test with an unrelated query
    console.log('\n4. Testing semantic search with unrelated query: "programming computer science"');
    const results3 = await db.semanticSearchMemory('programming computer science', {
      model: 'text-embedding-3-small',
      limit: 5,
      threshold: 0.1, // Very low threshold to see if anything matches
      sessionId: 'test-session',
      source: 'test'
    });
    
    console.log(`   Found ${results3.length} results with low threshold`);
    
    console.log('\n✅ Semantic search test completed!');
    console.log('\nSummary: semanticSearchMemory takes a query string, generates an embedding,');
    console.log('and finds the most similar memories using cosine similarity.');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.message.includes('API key')) {
      console.error('\n   Make sure you have embedding API keys set up:');
      console.error('   Set either OPENAI_API_KEY or OPENROUTER_API_KEY in your .env file');
    }
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  testSemanticSearch();
}

module.exports = { testSemanticSearch };
