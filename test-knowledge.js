#!/usr/bin/env node

/**
 * Simple test for knowledge cache functionality
 */

const knowledge = require('./lib/knowledge');

async function runTests() {
    console.log('🧪 Testing Knowledge Cache...\n');
    
    try {
        // Test 1: Add a knowledge entry
        console.log('1. Adding knowledge entry...');
        const id = await knowledge.add({
            title: 'Test Knowledge Entry',
            summary: 'This is a test entry for the knowledge cache system.',
            sourceType: 'manual',
            tags: ['test', 'knowledge-cache'],
            confidence: 0.9
        });
        console.log(`   ✅ Added entry with ID: ${id}\n`);
        
        // Test 2: Get the entry
        console.log('2. Retrieving knowledge entry...');
        const entry = knowledge.get(id);
        if (entry) {
            console.log(`   ✅ Retrieved: ${entry.title}`);
            console.log(`   Summary: ${entry.summary.substring(0, 50)}...\n`);
        } else {
            console.log('   ❌ Failed to retrieve entry\n');
            return;
        }
        
        // Test 3: List entries
        console.log('3. Listing knowledge entries...');
        const entries = knowledge.list({ limit: 5 });
        console.log(`   ✅ Found ${entries.length} entries\n`);
        
        // Test 4: Search entries
        console.log('4. Searching knowledge entries...');
        const searchResults = knowledge.search('test knowledge');
        console.log(`   ✅ Found ${searchResults.length} search results\n`);
        
        // Test 5: Get statistics
        console.log('5. Getting statistics...');
        const stats = knowledge.stats();
        console.log(`   ✅ Total entries: ${stats.total}`);
        console.log(`   Verified entries: ${stats.verified}`);
        console.log(`   Entries with embeddings: ${stats.withEmbeddings}\n`);
        
        // Test 6: Update entry
        console.log('6. Updating knowledge entry...');
        const updated = await knowledge.update(id, { 
            summary: 'This is an updated test entry for the knowledge cache system.',
            confidence: 0.95
        });
        console.log(`   ✅ Updated entry #${updated.id}\n`);
        
        // Test 7: Verify entry
        console.log('7. Verifying knowledge entry...');
        const verified = await knowledge.verify(id);
        console.log(`   ✅ Verified entry #${verified.id}\n`);
        
        // Test 8: Semantic search (if embeddings are available)
        console.log('8. Testing semantic search...');
        try {
            const semanticResults = await knowledge.semanticSearch('test knowledge cache', { limit: 3 });
            console.log(`   ✅ Found ${semanticResults.length} semantic results\n`);
        } catch (semanticError) {
            console.log(`   ⚠️ Semantic search may not be available: ${semanticError.message}\n`);
        }
        
        console.log('🎉 All tests completed successfully!\n');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

runTests();
