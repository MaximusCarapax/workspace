#!/usr/bin/env node

/**
 * Knowledge Cache CLI
 * 
 * Store and retrieve reusable knowledge (research findings, web summaries, facts)
 * 
 * Usage:
 *   node tools/knowledge.js add "title" --summary "content" --tags "tag1,tag2"
 *   node tools/knowledge.js list [--limit N]
 *   node tools/knowledge.js get <id>
 *   node tools/knowledge.js search "query"
 *   node tools/knowledge.js update <id> --summary "new content"
 *   node tools/knowledge.js verify <id>
 *   node tools/knowledge.js remove <id>
 *   node tools/knowledge.js stats
 */

const { program } = require('commander');
const knowledge = require('../lib/knowledge');

program
  .name('knowledge')
  .description('Knowledge Cache CLI - store and retrieve reusable knowledge');

program
  .command('add <title>')
  .description('Add a new knowledge entry')
  .option('-s, --summary <text>', 'Knowledge content/summary (required)')
  .option('-t, --tags <tags>', 'Comma-separated tags')
  .option('--source-type <type>', 'Source type (manual, research, web, conversation)', 'manual')
  .option('--source-url <url>', 'Source URL if from web')
  .option('--confidence <n>', 'Confidence score 0-1', parseFloat, 1.0)
  .option('--expires <date>', 'Expiration date (ISO format)')
  .action((title, options) => {
    if (!options.summary) {
      console.error('Error: --summary is required');
      process.exit(1);
    }
    
    const tags = options.tags ? options.tags.split(',').map(t => t.trim()) : [];
    
    try {
      const id = knowledge.add({
        title,
        summary: options.summary,
        sourceType: options.sourceType,
        sourceUrl: options.sourceUrl,
        tags,
        confidence: options.confidence,
        expiresAt: options.expires
      });
      
      console.log(`✅ Knowledge entry created with ID: ${id}`);
      console.log(`   Title: ${title}`);
      console.log(`   Tags: ${tags.join(', ') || 'none'}`);
    } catch (e) {
      console.error('Error adding knowledge:', e.message);
      process.exit(1);
    }
  });

program
  .command('list')
  .description('List knowledge entries')
  .option('-l, --limit <n>', 'Number of entries to show', parseInt, 20)
  .option('--source <type>', 'Filter by source type')
  .option('--verified', 'Only show verified entries')
  .option('--include-expired', 'Include expired entries')
  .action((options) => {
    try {
      const entries = knowledge.list({
        limit: options.limit,
        sourceType: options.source,
        verified: options.verified ? true : null,
        includeExpired: options.includeExpired
      });
      
      if (entries.length === 0) {
        console.log('No knowledge entries found.');
        return;
      }
      
      console.log(`📚 Knowledge Cache (${entries.length} entries)\n`);
      
      entries.forEach(entry => {
        const verified = entry.verified ? '✓' : ' ';
        const expired = entry.expires_at && new Date(entry.expires_at) < new Date() ? '⏰' : '';
        const tags = entry.topic_tags.length > 0 ? `[${entry.topic_tags.join(', ')}]` : '';
        
        console.log(`[${entry.id}] ${verified} ${entry.title} ${expired}`);
        console.log(`    ${entry.source_type} | ${new Date(entry.created_at).toLocaleDateString()}`);
        if (tags) console.log(`    ${tags}`);
        console.log(`    ${entry.summary.substring(0, 100)}${entry.summary.length > 100 ? '...' : ''}`);
        console.log('');
      });
    } catch (e) {
      console.error('Error listing knowledge:', e.message);
      process.exit(1);
    }
  });

program
  .command('get <id>')
  .description('Get a knowledge entry by ID')
  .action((id) => {
    try {
      const entry = knowledge.get(parseInt(id));
      
      if (!entry) {
        console.error(`Knowledge entry ${id} not found.`);
        process.exit(1);
      }
      
      console.log(`📖 Knowledge Entry #${entry.id}\n`);
      console.log(`Title: ${entry.title}`);
      console.log(`Source: ${entry.source_type}${entry.source_url ? ` (${entry.source_url})` : ''}`);
      console.log(`Created: ${entry.created_at}`);
      console.log(`Updated: ${entry.updated_at}`);
      console.log(`Verified: ${entry.verified ? 'Yes' : 'No'}`);
      console.log(`Confidence: ${entry.confidence}`);
      if (entry.expires_at) console.log(`Expires: ${entry.expires_at}`);
      if (entry.topic_tags.length > 0) console.log(`Tags: ${entry.topic_tags.join(', ')}`);
      if (entry.superseded_by) console.log(`⚠️ Superseded by entry #${entry.superseded_by}`);
      console.log(`\n--- Summary ---\n${entry.summary}`);
    } catch (e) {
      console.error('Error getting knowledge:', e.message);
      process.exit(1);
    }
  });

program
  .command('search <query>')
  .description('Search knowledge entries')
  .option('-l, --limit <n>', 'Number of results', parseInt, 10)
  .option('--include-expired', 'Include expired entries')
  .action((query, options) => {
    try {
      const results = knowledge.search(query, {
        limit: options.limit,
        includeExpired: options.includeExpired
      });
      
      if (results.length === 0) {
        console.log(`No results found for: "${query}"`);
        return;
      }
      
      console.log(`🔍 Search results for "${query}" (${results.length} found)\n`);
      
      results.forEach((entry, i) => {
        const verified = entry.verified ? '✓' : ' ';
        console.log(`[${i + 1}] #${entry.id} ${verified} ${entry.title}`);
        console.log(`    ${entry.source_type} | ${new Date(entry.created_at).toLocaleDateString()}`);
        console.log(`    ${entry.summary.substring(0, 120)}${entry.summary.length > 120 ? '...' : ''}`);
        console.log('');
      });
    } catch (e) {
      console.error('Error searching knowledge:', e.message);
      process.exit(1);
    }
  });

program
  .command('update <id>')
  .description('Update a knowledge entry')
  .option('-s, --summary <text>', 'New summary')
  .option('-t, --tags <tags>', 'New comma-separated tags')
  .option('--confidence <n>', 'New confidence score', parseFloat)
  .option('--expires <date>', 'New expiration date')
  .action((id, options) => {
    try {
      const updates = {};
      
      if (options.summary) updates.summary = options.summary;
      if (options.tags) updates.tags = options.tags.split(',').map(t => t.trim());
      if (options.confidence !== undefined) updates.confidence = options.confidence;
      if (options.expires) updates.expiresAt = options.expires;
      
      if (Object.keys(updates).length === 0) {
        console.error('No updates provided. Use --summary, --tags, --confidence, or --expires.');
        process.exit(1);
      }
      
      const entry = knowledge.update(parseInt(id), updates);
      console.log(`✅ Updated knowledge entry #${entry.id}`);
    } catch (e) {
      console.error('Error updating knowledge:', e.message);
      process.exit(1);
    }
  });

program
  .command('verify <id>')
  .description('Mark a knowledge entry as verified')
  .action((id) => {
    try {
      const entry = knowledge.verify(parseInt(id));
      console.log(`✅ Verified knowledge entry #${entry.id}: ${entry.title}`);
    } catch (e) {
      console.error('Error verifying knowledge:', e.message);
      process.exit(1);
    }
  });

program
  .command('remove <id>')
  .description('Remove a knowledge entry')
  .action((id) => {
    try {
      const removed = knowledge.remove(parseInt(id));
      if (removed) {
        console.log(`✅ Removed knowledge entry #${id}`);
      } else {
        console.error(`Knowledge entry ${id} not found.`);
        process.exit(1);
      }
    } catch (e) {
      console.error('Error removing knowledge:', e.message);
      process.exit(1);
    }
  });

program
  .command('stats')
  .description('Show knowledge cache statistics')
  .action(() => {
    try {
      const s = knowledge.stats();
      
      console.log('📊 Knowledge Cache Stats\n');
      console.log(`Total entries: ${s.total}`);
      console.log(`Verified: ${s.verified}`);
      console.log(`Expired: ${s.expired}`);
      console.log('\nBy source type:');
      s.bySource.forEach(({ source_type, count }) => {
        console.log(`  ${source_type}: ${count}`);
      });
    } catch (e) {
      console.error('Error getting stats:', e.message);
      process.exit(1);
    }
  });

program.parse();
#!/usr/bin/env node

const KnowledgeCache = require('../lib/knowledge-cache');
const { program } = require('commander');

program
    .name('knowledge')
    .description('Knowledge Cache CLI - Store and retrieve reusable knowledge')
    .version('1.0.0');

// Add command
program
    .command('add')
    .description('Add a new knowledge entry')
    .argument('<title>', 'Title of the knowledge entry')
    .requiredOption('--summary <summary>', 'Summary/content of the knowledge')
    .option('--source-type <type>', 'Source type (research, web, conversation, manual)', 'manual')
    .option('--source-url <url>', 'Source URL if from web')
    .option('--source-session <session>', 'Source session ID')
    .option('--tags <tags>', 'Comma-separated list of topic tags')
    .option('--entities <entities>', 'Comma-separated list of entities (JSON array)')
    .option('--confidence <confidence>', 'Confidence level (0.0-1.0)', parseFloat, 1.0)
    .option('--expires-at <date>', 'Expiration date (ISO format)')
    .option('--no-embedding', 'Skip embedding generation')
    .action(async (title, options) => {
        try {
            const topic_tags = options.tags ? options.tags.split(',').map(t => t.trim()) : null;
            const entities = options.entities ? options.entities.split(',').map(e => e.trim()) : null;
            
            const entry = await KnowledgeCache.add({
                title,
                summary: options.summary,
                source_type: options.sourceType,
                source_url: options.sourceUrl,
                source_session: options.sourceSession,
                topic_tags,
                entities,
                confidence: options.confidence,
                expires_at: options.expiresAt,
                generateEmbedding: options.embedding
            });
            
            console.log('✅ Knowledge entry added:');
            console.log(`   ID: ${entry.id}`);
            console.log(`   Title: ${entry.title}`);
            console.log(`   Created: ${entry.created_at}`);
        } catch (error) {
            console.error('❌ Error:', error.message);
            process.exit(1);
        }
    });

// Learn command (from URL)
program
    .command('learn <url>')
    .description('Fetch, summarize, and store knowledge from a URL')
    .option('--topic <topic>', 'Topic for the knowledge')
    .option('--title <title>', 'Custom title (default: extracted from content)')
    .action(async (url, options) => {
        try {
            console.log(`📚 Learning from ${url}...`);
            // For now, we'll implement a basic version
            // In the future, this should fetch and summarize the content
            const title = options.title || `Content from ${url}`;
            const summary = `Web content from ${url}. Topic: ${options.topic || 'general'}`;
            
            const entry = await KnowledgeCache.add({
                title,
                summary,
                source_type: 'web',
                source_url: url,
                topic_tags: options.topic ? [options.topic] : null,
                generateEmbedding: true
            });
            
            console.log('✅ Knowledge learned and stored:');
            console.log(`   ID: ${entry.id}`);
            console.log(`   Title: ${entry.title}`);
            console.log(`   Source: ${entry.source_url}`);
        } catch (error) {
            console.error('❌ Error:', error.message);
            process.exit(1);
        }
    });

// Get command
program
    .command('get <id>')
    .description('Get a knowledge entry by ID')
    .action((id) => {
        try {
            const entry = KnowledgeCache.get(id);
            if (!entry) {
                console.error('❌ Entry not found');
                process.exit(1);
            }
            
            console.log(`ID: ${entry.id}`);
            console.log(`Title: ${entry.title}`);
            console.log(`Summary: ${entry.summary}`);
            console.log(`Source Type: ${entry.source_type}`);
            console.log(`Source URL: ${entry.source_url || 'N/A'}`);
            console.log(`Tags: ${entry.topic_tags ? entry.topic_tags.join(', ') : 'N/A'}`);
            console.log(`Confidence: ${entry.confidence}`);
            console.log(`Verified: ${entry.verified ? 'Yes' : 'No'}`);
            console.log(`Created: ${entry.created_at}`);
            console.log(`Updated: ${entry.updated_at}`);
        } catch (error) {
            console.error('❌ Error:', error.message);
            process.exit(1);
        }
    });

// Search command
program
    .command('search <query>')
    .description('Search knowledge entries')
    .option('--limit <number>', 'Maximum results', parseInt, 10)
    .option('--offset <number>', 'Offset for pagination', parseInt, 0)
    .option('--source-type <type>', 'Filter by source type')
    .option('--min-confidence <confidence>', 'Minimum confidence', parseFloat, 0.0)
    .option('--include-expired', 'Include expired entries', false)
    .action((query, options) => {
        try {
            const results = KnowledgeCache.search(query, {
                limit: options.limit,
                offset: options.offset,
                source_type: options.sourceType,
                min_confidence: options.minConfidence,
                include_expired: options.includeExpired
            });
            
            console.log(`🔍 Found ${results.length} result(s):\n`);
            results.forEach(entry => {
                console.log(`ID: ${entry.id}`);
                console.log(`Title: ${entry.title}`);
                console.log(`Summary: ${entry.summary.substring(0, 100)}...`);
                console.log(`Source: ${entry.source_type} | Confidence: ${entry.confidence} | Verified: ${entry.verified ? 'Yes' : 'No'}`);
                console.log(`Created: ${entry.created_at}`);
                console.log('---');
            });
        } catch (error) {
            console.error('❌ Error:', error.message);
            process.exit(1);
        }
    });

// List command
program
    .command('list')
    .description('List recent knowledge entries')
    .option('--limit <number>', 'Number of entries to list', parseInt, 50)
    .action((options) => {
        try {
            const entries = KnowledgeCache.list(options.limit);
            console.log(`📚 Recent knowledge entries (${entries.length}):\n`);
            entries.forEach(entry => {
                console.log(`${entry.id.toString().padEnd(6)} ${entry.created_at} ${entry.verified ? '✅' : '⬜'} ${entry.source_type.padEnd(12)} ${entry.title}`);
            });
        } catch (error) {
            console.error('❌ Error:', error.message);
            process.exit(1);
        }
    });

// Update command
program
    .command('update <id>')
    .description('Update a knowledge entry')
    .option('--title <title>', 'New title')
    .option('--summary <summary>', 'New summary')
    .option('--tags <tags>', 'Comma-separated list of topic tags')
    .option('--confidence <confidence>', 'Confidence level', parseFloat)
    .option('--verify', 'Mark as verified')
    .action(async (id, options) => {
        try {
            const updates = {};
            if (options.title) updates.title = options.title;
            if (options.summary) updates.summary = options.summary;
            if (options.tags) updates.topic_tags = options.tags.split(',').map(t => t.trim());
            if (options.confidence) updates.confidence = options.confidence;
            if (options.verify) updates.verified = true;
            
            const entry = await KnowledgeCache.update(id, updates);
            console.log('✅ Knowledge entry updated:');
            console.log(`   ID: ${entry.id}`);
            console.log(`   Title: ${entry.title}`);
            console.log(`   Updated: ${entry.updated_at}`);
        } catch (error) {
            console.error('❌ Error:', error.message);
            process.exit(1);
        }
    });

// Verify command
program
    .command('verify <id>')
    .description('Mark a knowledge entry as verified')
    .action(async (id) => {
        try {
            await KnowledgeCache.verify(id);
            console.log(`✅ Entry ${id} marked as verified`);
        } catch (error) {
            console.error('❌ Error:', error.message);
            process.exit(1);
        }
    });

// Delete command
program
    .command('delete <id>')
    .description('Delete a knowledge entry')
    .action((id) => {
        try {
            KnowledgeCache.delete(id);
            console.log(`✅ Entry ${id} deleted`);
        } catch (error) {
            console.error('❌ Error:', error.message);
            process.exit(1);
        }
    });

program.parse(process.argv);
