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

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'dashboard', 'data', 'content.json');

// Ensure data directory exists
const dataDir = path.dirname(DATA_FILE);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Load data
function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    return { items: [], lastId: 0 };
  }
}

// Save data
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Generate short ID
function genId(data) {
  data.lastId = (data.lastId || 0) + 1;
  return `C${data.lastId.toString().padStart(3, '0')}`;
}

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
    draft: '📝',
    scheduled: '📅',
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
    
    const data = loadData();
    const item = {
      id: genId(data),
      content,
      platform: getFlag('--platform') || 'linkedin',
      status: 'idea',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      scheduledFor: null,
      publishedAt: null,
      notes: '',
      tags: []
    };
    
    data.items.push(item);
    saveData(data);
    console.log(`✅ Added ${item.id}: "${truncate(content, 60)}"`);
  },
  
  list: () => {
    const data = loadData();
    let items = data.items;
    
    const statusFilter = getFlag('--status');
    const platformFilter = getFlag('--platform');
    
    if (statusFilter) {
      items = items.filter(i => i.status === statusFilter);
    }
    if (platformFilter) {
      items = items.filter(i => i.platform === platformFilter || i.platform === 'both');
    }
    
    if (items.length === 0) {
      console.log('No content items found.');
      return;
    }
    
    // Group by status
    const grouped = { idea: [], draft: [], scheduled: [], published: [] };
    items.forEach(i => {
      if (grouped[i.status]) grouped[i.status].push(i);
    });
    
    for (const [status, group] of Object.entries(grouped)) {
      if (group.length === 0) continue;
      console.log(`\n${statusEmoji(status)} ${status.toUpperCase()} (${group.length})`);
      console.log('─'.repeat(60));
      
      group.forEach(i => {
        const sched = i.scheduledFor ? ` 📅 ${formatDate(i.scheduledFor)}` : '';
        console.log(`  ${i.id} ${platformEmoji(i.platform)} ${truncate(i.content, 45)}${sched}`);
      });
    }
    console.log('');
  },
  
  view: () => {
    const id = args[1];
    if (!id) {
      console.log('Usage: content view <id>');
      process.exit(1);
    }
    
    const data = loadData();
    const item = data.items.find(i => i.id.toLowerCase() === id.toLowerCase());
    
    if (!item) {
      console.log(`❌ Item ${id} not found`);
      process.exit(1);
    }
    
    console.log(`\n${statusEmoji(item.status)} ${item.id} - ${item.status.toUpperCase()}`);
    console.log('─'.repeat(60));
    console.log(`Platform:  ${platformEmoji(item.platform)} ${item.platform}`);
    console.log(`Created:   ${formatDate(item.createdAt)}`);
    console.log(`Updated:   ${formatDate(item.updatedAt)}`);
    if (item.scheduledFor) console.log(`Scheduled: ${formatDate(item.scheduledFor)}`);
    if (item.publishedAt) console.log(`Published: ${formatDate(item.publishedAt)}`);
    if (item.tags.length) console.log(`Tags:      ${item.tags.join(', ')}`);
    console.log('─'.repeat(60));
    console.log('\nContent:');
    console.log(item.content);
    if (item.notes) {
      console.log('\nNotes:');
      console.log(item.notes);
    }
    console.log('');
  },
  
  edit: () => {
    const id = args[1];
    if (!id) {
      console.log('Usage: content edit <id> [--content "..."] [--status ...] [--platform ...] [--notes "..."] [--tags "a,b,c"]');
      process.exit(1);
    }
    
    const data = loadData();
    const item = data.items.find(i => i.id.toLowerCase() === id.toLowerCase());
    
    if (!item) {
      console.log(`❌ Item ${id} not found`);
      process.exit(1);
    }
    
    const content = getFlag('--content');
    const status = getFlag('--status');
    const platform = getFlag('--platform');
    const notes = getFlag('--notes');
    const tags = getFlag('--tags');
    
    if (content) item.content = content;
    if (status) item.status = status;
    if (platform) item.platform = platform;
    if (notes) item.notes = notes;
    if (tags) item.tags = tags.split(',').map(t => t.trim());
    
    item.updatedAt = new Date().toISOString();
    saveData(data);
    
    console.log(`✅ Updated ${item.id}`);
  },
  
  schedule: () => {
    const id = args[1];
    const date = getFlag('--date');
    
    if (!id || !date) {
      console.log('Usage: content schedule <id> --date "2026-02-05"');
      process.exit(1);
    }
    
    const data = loadData();
    const item = data.items.find(i => i.id.toLowerCase() === id.toLowerCase());
    
    if (!item) {
      console.log(`❌ Item ${id} not found`);
      process.exit(1);
    }
    
    item.status = 'scheduled';
    item.scheduledFor = new Date(date).toISOString();
    item.updatedAt = new Date().toISOString();
    saveData(data);
    
    console.log(`📅 Scheduled ${item.id} for ${formatDate(item.scheduledFor)}`);
  },
  
  publish: () => {
    const id = args[1];
    if (!id) {
      console.log('Usage: content publish <id>');
      process.exit(1);
    }
    
    const data = loadData();
    const item = data.items.find(i => i.id.toLowerCase() === id.toLowerCase());
    
    if (!item) {
      console.log(`❌ Item ${id} not found`);
      process.exit(1);
    }
    
    item.status = 'published';
    item.publishedAt = new Date().toISOString();
    item.updatedAt = new Date().toISOString();
    saveData(data);
    
    console.log(`✅ Marked ${item.id} as published`);
  },
  
  delete: () => {
    const id = args[1];
    if (!id) {
      console.log('Usage: content delete <id>');
      process.exit(1);
    }
    
    const data = loadData();
    const idx = data.items.findIndex(i => i.id.toLowerCase() === id.toLowerCase());
    
    if (idx === -1) {
      console.log(`❌ Item ${id} not found`);
      process.exit(1);
    }
    
    const removed = data.items.splice(idx, 1)[0];
    saveData(data);
    
    console.log(`🗑️ Deleted ${removed.id}: "${truncate(removed.content, 40)}"`);
  },
  
  stats: () => {
    const data = loadData();
    const items = data.items;
    
    const byStatus = { idea: 0, draft: 0, scheduled: 0, published: 0 };
    const byPlatform = { linkedin: 0, x: 0, both: 0 };
    
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
      .filter(i => i.status === 'scheduled' && i.scheduledFor)
      .sort((a, b) => new Date(a.scheduledFor) - new Date(b.scheduledFor))
      .slice(0, 5);
    
    if (scheduled.length > 0) {
      console.log('');
      console.log('📅 Upcoming:');
      scheduled.forEach(i => {
        console.log(`  ${formatDate(i.scheduledFor)} - ${truncate(i.content, 35)}`);
      });
    }
    console.log('');
  },
  
  help: () => {
    console.log(`
📝 Content Calendar CLI

Commands:
  add <content> [--platform linkedin|x|both]  Add new idea
  list [--status ...] [--platform ...]        List items
  view <id>                                   View item details
  edit <id> [--content] [--status] [--platform] [--notes] [--tags]
  schedule <id> --date "YYYY-MM-DD"           Schedule for publishing
  publish <id>                                Mark as published
  delete <id>                                 Delete item
  stats                                       Show statistics
  help                                        Show this help

Statuses: idea → draft → scheduled → published
Platforms: linkedin, x, both

Examples:
  node content.js add "AI tools are changing how we work" --platform linkedin
  node content.js list --status idea
  node content.js edit C001 --status draft --notes "Add statistics"
  node content.js schedule C001 --date "2026-02-05"
`);
  }
};

// Run command
if (!command || command === 'help' || command === '-h' || command === '--help') {
  commands.help();
} else if (commands[command]) {
  commands[command]();
} else {
  console.log(`Unknown command: ${command}`);
  console.log('Run "node content.js help" for usage');
  process.exit(1);
}
