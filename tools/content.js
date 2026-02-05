#!/usr/bin/env node
/**
 * Content Calendar CLI
 * Track content ideas from inception to publication
 * 
 * Usage:
 *   node content.js add "Your idea here" --platform linkedin
 *   node content.js list [--status idea|draft|scheduled|published] [--platform linkedin|x]
 *   node content.js view <id>
 *   node content.js edit <id> --content "New content" --status draft
 *   node content.js schedule <id> --date "2026-02-05"
 *   node content.js publish <id>
 *   node content.js delete <id>
 *   node content.js stats
 */

const { addContentItem, getContentItems, getContentItem, updateContentItem, deleteContentItem } = require('../lib/db');
const { route } = require('../lib/router');
const db = require('../lib/db');

// Parse args
const args = process.argv.slice(2);
const command = args[0];

function getFlag(flag) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) {
    return args[idx + 1];
  }
  return null;
}

function hasFlag(flag) {
  return args.includes(flag);
}

// Format date
function formatDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Status emoji
function statusEmoji(status) {
  const map = {
    idea: '💡',
    hooks: '🪝',
    draft: '📝',
    review: '👁️',
    scheduled: '📅',
    posted: '✅',
    published: '✅'
  };
  return map[status] || '❓';
}

// Platform emoji
function platformEmoji(platform) {
  const map = {
    linkedin: '🔗',
    x: '𝕏',
    twitter: '𝕏',
    both: '🔗𝕏'
  };
  return map[platform] || '📱';
}

// Truncate text
function truncate(text, len = 50) {
  if (!text) return '';
  if (text.length <= len) return text;
  return text.substring(0, len - 3) + '...';
}

// Commands
const commands = {
  add: () => {
    const content = args.slice(1).filter(a => !a.startsWith('--')).join(' ');
    if (!content) {
      console.log('Usage: content add "Your idea here" [--platform linkedin|x|both]');
      process.exit(1);
    }
    
    try {
      const id = addContentItem({
        title: content,
        platform: getFlag('--platform') || 'linkedin',
        status: 'idea',
        notes: getFlag('--notes') || ''
      });
      console.log(`✅ Added item ${id}: "${truncate(content, 60)}"`);
    } catch (error) {
      db.logError({
        source: 'content',
        message: error.message,
        details: 'Failed to add content item to database',
        stack: error.stack
      });
      console.error(`❌ Failed to add item: ${error.message}`);
      process.exit(1);
    }
  },

  hooks: async () => {
    const id = args[1];
    if (!id) {
      console.log('Usage: content hooks <id>');
      process.exit(1);
    }

    try {
      // Get the item from database
      const item = getContentItem(parseInt(id));
      if (!item) {
        console.error(`❌ Item ${id} not found`);
        process.exit(1);
      }

      if (item.status !== 'idea') {
        console.error(`❌ Item ${id} is not in 'idea' status (current: ${item.status})`);
        process.exit(1);
      }

      console.log(`🔄 Generating hooks for: "${truncate(item.title, 50)}"`);

      // Generate hooks using AI
      const prompt = `Idea: ${item.title}
Context: ${item.notes || 'None'}
Platform: ${item.platform}

Generate 5 hook options. Each should:
- Stop the scroll
- Be under 15 words
- Create curiosity or make a bold claim

Return as JSON array: ["hook1", "hook2", ...]`;

      const response = await route({
        type: 'generate',
        prompt: prompt,
        sessionId: 'content-hooks',
        source: 'content-pipeline'
      });

      // Parse the response to get hooks
      let hooks;
      let responseText = response.result || response.content || response;
      
      // Remove markdown code block formatting if present
      responseText = responseText.replace(/```json\s*|\s*```/g, '').trim();
      
      try {
        hooks = JSON.parse(responseText);
      } catch (parseError) {
        // If direct JSON parsing fails, try to extract JSON from the response
        const arrayMatch = responseText.match(/\[.*?\]/s);
        if (arrayMatch) {
          hooks = JSON.parse(arrayMatch[0]);
        } else {
          throw new Error(`Failed to parse AI response as JSON array. Response: ${responseText}`);
        }
      }

      if (!Array.isArray(hooks) || hooks.length === 0) {
        throw new Error('AI response is not a valid array of hooks');
      }

      // Update item in database
      updateContentItem(parseInt(id), {
        hooks: JSON.stringify(hooks),
        status: 'hooks'
      });

      console.log(`\n✅ Generated ${hooks.length} hooks for item ${id}:`);
      hooks.forEach((hook, index) => {
        console.log(`  ${index + 1}. ${hook}`);
      });
      console.log(`\nStatus updated to 'hooks'. Use "content select ${id} <number>" to choose one.`);

    } catch (error) {
      db.logError({
        source: 'content',
        message: error.message,
        details: 'Failed to generate hooks for content item',
        stack: error.stack
      });
      console.error(`❌ Failed to generate hooks: ${error.message}`);
      process.exit(1);
    }
  },
  
  list: () => {
    try {
      const statusFilter = getFlag('--status');
      const platformFilter = getFlag('--platform');
      
      const items = getContentItems({ 
        status: statusFilter, 
        platform: platformFilter 
      });
      
      if (items.length === 0) {
        console.log('No content items found.');
        return;
      }
      
      // Group by status  
      const grouped = { idea: [], hooks: [], draft: [], review: [], scheduled: [], posted: [] };
      items.forEach(i => {
        if (grouped[i.status]) grouped[i.status].push(i);
      });
      
      for (const [status, group] of Object.entries(grouped)) {
        if (group.length === 0) continue;
        console.log(`\n${statusEmoji(status)} ${status.toUpperCase()} (${group.length})`);
        console.log('─'.repeat(60));
        
        group.forEach(i => {
          const sched = i.scheduled_for ? ` 📅 ${formatDate(i.scheduled_for)}` : '';
          console.log(`  ${i.id} ${platformEmoji(i.platform)} ${truncate(i.title || i.content, 45)}${sched}`);
        });
      }
      console.log('');
    } catch (error) {
      db.logError({
        source: 'content',
        message: error.message,
        details: 'Failed to list content items from database',
        stack: error.stack
      });
      console.error(`❌ Failed to list items: ${error.message}`);
      process.exit(1);
    }
  },
  
  view: () => {
    const id = args[1];
    if (!id) {
      console.log('Usage: content view <id>');
      process.exit(1);
    }
    
    try {
      const item = getContentItem(parseInt(id));
      
      if (!item) {
        console.log(`❌ Item ${id} not found`);
        process.exit(1);
      }
      
      console.log(`\n${statusEmoji(item.status)} ${item.id} - ${item.status.toUpperCase()}`);
      console.log('─'.repeat(60));
      console.log(`Platform:  ${platformEmoji(item.platform)} ${item.platform}`);
      console.log(`Created:   ${formatDate(item.created_at)}`);
      console.log(`Updated:   ${formatDate(item.updated_at)}`);
      if (item.scheduled_time) console.log(`Scheduled: ${formatDate(item.scheduled_time)}`);
      if (item.posted_time) console.log(`Posted:    ${formatDate(item.posted_time)}`);
      if (item.post_url) console.log(`URL:       ${item.post_url}`);
      if (item.tags) console.log(`Tags:      ${item.tags}`);
      console.log('─'.repeat(60));
      console.log('\nContent:');
      console.log(item.title || item.content);
      if (item.notes) {
        console.log('\nNotes:');
        console.log(item.notes);
      }
      if (item.hooks) {
        console.log('\nGenerated Hooks:');
        try {
          const hooks = JSON.parse(item.hooks);
          hooks.forEach((hook, index) => {
            console.log(`  ${index + 1}. ${hook}`);
          });
        } catch (e) {
          console.log('  [Invalid hooks data]');
        }
      }
      if (item.selected_hook) {
        console.log('\nSelected Hook:');
        console.log(`  ${item.selected_hook}`);
      }
      if (item.draft) {
        console.log('\nDraft:');
        console.log(item.draft);
      }
      if (item.review_score) {
        console.log(`\nReview Score: ${item.review_score}/10`);
        if (item.review_notes) {
          console.log('Review Notes:');
          console.log(item.review_notes);
        }
      }
      console.log('');
    } catch (error) {
      db.logError({
        source: 'content',
        message: error.message,
        details: 'Failed to view content item from database',
        stack: error.stack
      });
      console.error(`❌ Failed to view item: ${error.message}`);
      process.exit(1);
    }
  },
  
  edit: () => {
    const id = args[1];
    if (!id) {
      console.log('Usage: content edit <id> [--title "..."] [--status ...] [--platform ...] [--notes "..."]');
      process.exit(1);
    }
    
    try {
      const item = getContentItem(parseInt(id));
      if (!item) {
        console.log(`❌ Item ${id} not found`);
        process.exit(1);
      }
      
      const updates = {};
      const title = getFlag('--title') || getFlag('--content');
      const status = getFlag('--status');
      const platform = getFlag('--platform');
      const notes = getFlag('--notes');
      
      if (title) updates.title = title;
      if (status) updates.status = status;
      if (platform) updates.platform = platform;
      if (notes) updates.notes = notes;
      
      if (Object.keys(updates).length === 0) {
        console.log('No changes specified. Use --title, --status, --platform, or --notes');
        return;
      }
      
      updateContentItem(parseInt(id), updates);
      console.log(`✅ Updated item ${id}`);
    } catch (error) {
      db.logError({
        source: 'content',
        message: error.message,
        details: 'Failed to update content item in database',
        stack: error.stack
      });
      console.error(`❌ Failed to update item: ${error.message}`);
      process.exit(1);
    }
  },
  
  schedule: () => {
    const id = args[1];
    const time = getFlag('--time') || getFlag('--date');
    
    if (!id || !time) {
      console.log('Usage: content schedule <id> --time "2026-02-05 09:00"');
      process.exit(1);
    }
    
    try {
      const item = getContentItem(parseInt(id));
      if (!item) {
        console.log(`❌ Item ${id} not found`);
        process.exit(1);
      }
      
      updateContentItem(parseInt(id), {
        status: 'scheduled',
        scheduled_time: new Date(time).toISOString()
      });
      
      console.log(`📅 Scheduled item ${id} for ${formatDate(new Date(time).toISOString())}`);
    } catch (error) {
      db.logError({
        source: 'content',
        message: error.message,
        details: 'Failed to schedule content item in database',
        stack: error.stack
      });
      console.error(`❌ Failed to schedule item: ${error.message}`);
      process.exit(1);
    }
  },
  
  publish: () => {
    const id = args[1];
    if (!id) {
      console.log('Usage: content publish <id>');
      process.exit(1);
    }
    
    try {
      const item = getContentItem(parseInt(id));
      if (!item) {
        console.log(`❌ Item ${id} not found`);
        process.exit(1);
      }
      
      updateContentItem(parseInt(id), {
        status: 'posted',
        posted_time: new Date().toISOString()
      });
      
      console.log(`✅ Marked item ${id} as posted`);
    } catch (error) {
      db.logError({
        source: 'content',
        message: error.message,
        details: 'Failed to mark content item as published in database',
        stack: error.stack
      });
      console.error(`❌ Failed to mark as published: ${error.message}`);
      process.exit(1);
    }
  },
  
  delete: () => {
    const id = args[1];
    if (!id) {
      console.log('Usage: content delete <id>');
      process.exit(1);
    }
    
    try {
      const item = getContentItem(parseInt(id));
      if (!item) {
        console.log(`❌ Item ${id} not found`);
        process.exit(1);
      }
      
      deleteContentItem(parseInt(id));
      console.log(`🗑️ Deleted item ${id}: "${truncate(item.title || item.content, 40)}"`);
    } catch (error) {
      db.logError({
        source: 'content',
        message: error.message,
        details: 'Failed to delete content item from database',
        stack: error.stack
      });
      console.error(`❌ Failed to delete item: ${error.message}`);
      process.exit(1);
    }
  },
  
  stats: () => {
    try {
      const items = getContentItems({});
      
      const byStatus = { idea: 0, hooks: 0, draft: 0, review: 0, scheduled: 0, posted: 0 };
      const byPlatform = { linkedin: 0, x: 0 };
      
      items.forEach(i => {
        byStatus[i.status] = (byStatus[i.status] || 0) + 1;
        byPlatform[i.platform] = (byPlatform[i.platform] || 0) + 1;
      });
      
      console.log('\n📊 Content Stats');
      console.log('─'.repeat(40));
      console.log(`Total items: ${items.length}`);
      console.log('');
      console.log('By Status:');
      Object.entries(byStatus).forEach(([s, c]) => {
        if (c > 0) console.log(`  ${statusEmoji(s)} ${s}: ${c}`);
      });
      console.log('');
      console.log('By Platform:');
      Object.entries(byPlatform).forEach(([p, c]) => {
        if (c > 0) console.log(`  ${platformEmoji(p)} ${p}: ${c}`);
      });
      
      // Upcoming scheduled
      const scheduled = items
        .filter(i => i.status === 'scheduled' && i.scheduled_time)
        .sort((a, b) => new Date(a.scheduled_time) - new Date(b.scheduled_time))
        .slice(0, 5);
      
      if (scheduled.length > 0) {
        console.log('');
        console.log('📅 Upcoming:');
        scheduled.forEach(i => {
          console.log(`  ${formatDate(i.scheduled_time)} - ${truncate(i.title || i.content, 35)}`);
        });
      }
      console.log('');
    } catch (error) {
      // Log error to database
      try {
        db.logError({
          level: 'error',
          source: 'content.js',
          message: error.message,
          details: 'Command: stats',
          stack: error.stack
        });
      } catch (dbError) {
        console.error('Failed to log error to database:', dbError.message);
      }
      
      console.error(`❌ Failed to get stats: ${error.message}`);
      process.exit(1);
    }
  },
  
  help: () => {
    console.log(`
📝 Content Pipeline v2 CLI

Pipeline: idea → hooks → draft → review → scheduled → posted

Commands:
  add <content> [--platform linkedin|x] [--notes "..."]  Add new idea
  hooks <id>                                           Generate hook options
  list [--status ...] [--platform ...]                 List items  
  view <id>                                            View item details
  edit <id> [--title] [--status] [--platform] [--notes] Edit item
  schedule <id> --time "YYYY-MM-DD HH:MM"              Schedule for posting
  publish <id>                                         Mark as posted
  delete <id>                                          Delete item
  stats                                                Show statistics
  help                                                 Show this help

Statuses: idea, hooks, draft, review, scheduled, posted
Platforms: linkedin, x

Examples:
  node content.js add "AI tools are changing how we work" --platform linkedin
  node content.js hooks 1
  node content.js list --status idea
  node content.js view 1
  node content.js schedule 1 --time "2026-02-06 09:00"
`);
  }
};

// Run command with error logging
try {
  if (!command || command === 'help' || command === '-h' || command === '--help') {
    commands.help();
  } else if (commands[command]) {
    commands[command]();
  } else {
    console.log(`Unknown command: ${command}`);
    console.log('Run "node content.js help" for usage');
    process.exit(1);
  }
} catch (error) {
  console.error(`❌ Error: ${error.message}`);
    
  // Log error to database
  try {
    db.logError({
      level: 'error',
      source: 'content.js',
      message: error.message,
      details: `Command: ${command}`,
      stack: error.stack
    });
  } catch (dbError) {
    console.error('Failed to log error to database:', dbError.message);
  }
    
  process.exit(1);
}
