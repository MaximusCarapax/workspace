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
      console.log('   No memories with embeddings found. Creating a test memory...');
      
      // Create a test memory
      const testMemoryId = db.addMemory({
        category: 'fact',
        subject: 'Test Animal',
        content: 'A quick brown fox jumps over a lazy dog in the forest.',
        importance: 5,
        source: 'test'
      });
      
      console.log(`   Created memory with ID: ${testMemoryId}`);
      
      // Generate embedding for it
      await db.generateAndStoreEmbedding(testMemoryId, {
        model: 'text-embedding-3-small',
        sessionId: 'test-session',
        source: 'test'
      });
      
      console.log('   Generated embedding for test memory');
    }
    
    // Test semantic search
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
      console.log('\n   Top results:');
      results.forEach((result, i) => {
        console.log(`   ${i + 1}. Similarity: ${(result.similarity * 100).toFixed(1)}%`);
        console.log(`      Content: ${result.content.substring(0, 60)}...`);
        console.log(`      Category: ${result.category}, Importance: ${result.importance}`);
      });
    } else {
      console.log('   No results found. Try lowering the threshold.');
    }
    
    // Test with different query
    console.log('\n3. Testing semantic search with query: "sleeping animal"');
    const results2 = await db.semanticSearchMemory('sleeping animal', {
      model: 'text-embedding-3-small',
      limit: 5,
      threshold: 0.3,
      sessionId: 'test-session',
      source: 'test'
    });
    
    console.log(`   Found ${results2.length} results`);
    
    console.log('\n✅ Semantic search test completed!');
    
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
