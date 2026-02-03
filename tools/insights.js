#!/usr/bin/env node
/**
 * Insight Capture System
 * 
 * Captures insights from daily work and feeds them into the content pipeline.
 * 
 * Usage:
 *   node insights.js capture "insight" [--platform x|linkedin|both] [--tags tag1,tag2]
 *   node insights.js extract <memory-file>     # Extract insights from a daily log
 *   node insights.js list [--unused]           # List captured insights
 *   node insights.js develop <id>              # Generate hooks from insight
 *   node insights.js promote <id>              # Move insight to content calendar
 *   node insights.js stats                     # Show insight statistics
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../dashboard/data');
const INSIGHTS_FILE = path.join(DATA_DIR, 'insights.json');
const CONTENT_FILE = path.join(DATA_DIR, 'content-calendar.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadInsights() {
  if (!fs.existsSync(INSIGHTS_FILE)) {
    return { insights: [], lastId: 0 };
  }
  return JSON.parse(fs.readFileSync(INSIGHTS_FILE, 'utf8'));
}

function saveInsights(data) {
  fs.writeFileSync(INSIGHTS_FILE, JSON.stringify(data, null, 2));
}

function loadContent() {
  if (!fs.existsSync(CONTENT_FILE)) {
    return { items: [], lastId: 0 };
  }
  return JSON.parse(fs.readFileSync(CONTENT_FILE, 'utf8'));
}

function saveContent(data) {
  fs.writeFileSync(CONTENT_FILE, JSON.stringify(data, null, 2));
}

// Capture a new insight
function captureInsight(text, options = {}) {
  const data = loadInsights();
  data.lastId++;
  
  const insight = {
    id: `I${String(data.lastId).padStart(3, '0')}`,
    text: text,
    platform: options.platform || 'both',
    tags: options.tags || [],
    source: options.source || 'manual',
    createdAt: new Date().toISOString(),
    status: 'raw', // raw → developed → promoted → used
    hooks: [],
    contentId: null
  };
  
  data.insights.push(insight);
  saveInsights(data);
  
  console.log(`✅ Captured insight ${insight.id}`);
  console.log(`   "${text.substring(0, 60)}${text.length > 60 ? '...' : ''}"`);
  console.log(`   Platform: ${insight.platform} | Tags: ${insight.tags.join(', ') || 'none'}`);
  
  return insight;
}

// Extract insights from a memory/daily log file using AI
async function extractFromLog(filePath) {
  const fullPath = filePath.startsWith('/') ? filePath : path.join(__dirname, '..', filePath);
  
  if (!fs.existsSync(fullPath)) {
    console.error(`❌ File not found: ${fullPath}`);
    process.exit(1);
  }
  
  const content = fs.readFileSync(fullPath, 'utf8');
  console.log(`📖 Reading ${filePath}...`);
  
  // Use Gemini (free) to extract insights
  const prompt = `You are an insight extractor for a content creator. Read this daily work log and extract 2-5 insights that would make good social media content.

For each insight, identify:
1. The core insight (1-2 sentences)
2. Best platform (x for short/punchy, linkedin for professional/deep, both if versatile)
3. Tags (2-3 relevant topics)

Format as JSON array:
[
  {"text": "insight here", "platform": "x|linkedin|both", "tags": ["tag1", "tag2"]}
]

Look for:
- Lessons learned
- Interesting problems solved
- Counterintuitive discoveries
- Behind-the-scenes moments
- Things that would resonate with other builders/professionals

DAILY LOG:
${content}

Return ONLY the JSON array, no other text.`;

  try {
    const { execSync } = require('child_process');
    const result = execSync(`node tools/gemini.js "${prompt.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`, {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024
    });
    
    // Parse the JSON from the response
    const jsonMatch = result.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.log('⚠️ Could not parse AI response. Raw output:');
      console.log(result);
      return;
    }
    
    const insights = JSON.parse(jsonMatch[0]);
    console.log(`\n🎯 Extracted ${insights.length} insights:\n`);
    
    insights.forEach((insight, i) => {
      const captured = captureInsight(insight.text, {
        platform: insight.platform,
        tags: insight.tags,
        source: filePath
      });
      console.log('');
    });
    
  } catch (err) {
    console.error('❌ Error extracting insights:', err.message);
    
    // Fallback: manual extraction prompts
    console.log('\n📝 Manual extraction mode:');
    console.log('Review the file and run:');
    console.log('  node insights.js capture "your insight" --platform x --tags ai,building');
  }
}

// Generate hooks from an insight using AI
async function developInsight(insightId) {
  const data = loadInsights();
  const insight = data.insights.find(i => i.id === insightId);
  
  if (!insight) {
    console.error(`❌ Insight not found: ${insightId}`);
    process.exit(1);
  }
  
  console.log(`🎣 Generating hooks for ${insightId}...`);
  console.log(`   "${insight.text}"\n`);
  
  const prompt = `Generate 5 different hooks/opening lines for this insight. Each hook should grab attention differently.

INSIGHT: ${insight.text}
PLATFORM: ${insight.platform}

Hook styles to use:
1. Contrarian/Hot take ("Most people think X. They're wrong.")
2. Story opener ("Yesterday I discovered...")
3. Question ("What if the future of X isn't Y?")
4. Data/Stat lead ("90% of... but...")
5. Direct value ("The one thing that changed how I...")

Return as JSON array of strings:
["hook1", "hook2", "hook3", "hook4", "hook5"]

Return ONLY the JSON array.`;

  try {
    const { execSync } = require('child_process');
    const result = execSync(`node tools/gemini.js "${prompt.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`, {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024
    });
    
    const jsonMatch = result.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.log('⚠️ Could not parse hooks. Raw output:');
      console.log(result);
      return;
    }
    
    const hooks = JSON.parse(jsonMatch[0]);
    insight.hooks = hooks;
    insight.status = 'developed';
    saveInsights(data);
    
    console.log('🎣 Generated hooks:\n');
    hooks.forEach((hook, i) => {
      console.log(`  ${i + 1}. ${hook}\n`);
    });
    
    console.log(`\n✅ Hooks saved to ${insightId}`);
    console.log(`   Next: node insights.js promote ${insightId}`);
    
  } catch (err) {
    console.error('❌ Error generating hooks:', err.message);
  }
}

// Promote insight to content calendar
function promoteInsight(insightId, hookIndex = 0) {
  const insightData = loadInsights();
  const insight = insightData.insights.find(i => i.id === insightId);
  
  if (!insight) {
    console.error(`❌ Insight not found: ${insightId}`);
    process.exit(1);
  }
  
  if (insight.hooks.length === 0) {
    console.error(`❌ No hooks generated. Run: node insights.js develop ${insightId}`);
    process.exit(1);
  }
  
  const hook = insight.hooks[hookIndex] || insight.hooks[0];
  
  // Add to content calendar
  const contentData = loadContent();
  contentData.lastId++;
  
  const contentItem = {
    id: `C${String(contentData.lastId).padStart(3, '0')}`,
    content: hook,
    fullInsight: insight.text,
    platform: insight.platform,
    status: 'draft',
    tags: insight.tags,
    insightId: insight.id,
    createdAt: new Date().toISOString(),
    scheduledFor: null,
    publishedAt: null,
    notes: `From insight: ${insight.text.substring(0, 50)}...`
  };
  
  contentData.items.push(contentItem);
  saveContent(contentData);
  
  // Update insight status
  insight.status = 'promoted';
  insight.contentId = contentItem.id;
  saveInsights(insightData);
  
  console.log(`✅ Promoted to content calendar as ${contentItem.id}`);
  console.log(`   Hook: "${hook.substring(0, 60)}..."`);
  console.log(`   Platform: ${contentItem.platform}`);
  console.log(`   Status: draft`);
  console.log(`\n   Next: node tools/content.js edit ${contentItem.id} --status scheduled --date "YYYY-MM-DD"`);
}

// List insights
function listInsights(options = {}) {
  const data = loadInsights();
  let insights = data.insights;
  
  if (options.unused) {
    insights = insights.filter(i => i.status === 'raw' || i.status === 'developed');
  }
  
  if (options.status) {
    insights = insights.filter(i => i.status === options.status);
  }
  
  if (insights.length === 0) {
    console.log('No insights found.');
    return;
  }
  
  const statusEmoji = {
    raw: '💡',
    developed: '🎣',
    promoted: '📝',
    used: '✅'
  };
  
  const platformEmoji = {
    x: '𝕏',
    linkedin: '🔗',
    both: '🔗𝕏'
  };
  
  console.log(`\n📊 Insights (${insights.length})\n`);
  
  insights.forEach(i => {
    const status = statusEmoji[i.status] || '?';
    const platform = platformEmoji[i.platform] || '?';
    console.log(`  ${i.id} ${status} ${platform} ${i.text.substring(0, 50)}${i.text.length > 50 ? '...' : ''}`);
    if (i.hooks.length > 0) {
      console.log(`      └─ ${i.hooks.length} hooks generated`);
    }
  });
  
  console.log('\nStatuses: 💡 raw → 🎣 developed → 📝 promoted → ✅ used');
}

// Show stats
function showStats() {
  const data = loadInsights();
  
  const byStatus = {};
  const byPlatform = {};
  const byTag = {};
  
  data.insights.forEach(i => {
    byStatus[i.status] = (byStatus[i.status] || 0) + 1;
    byPlatform[i.platform] = (byPlatform[i.platform] || 0) + 1;
    i.tags.forEach(t => {
      byTag[t] = (byTag[t] || 0) + 1;
    });
  });
  
  console.log(`\n📊 Insight Statistics`);
  console.log(`────────────────────────────────────────`);
  console.log(`Total insights: ${data.insights.length}\n`);
  
  console.log('By Status:');
  Object.entries(byStatus).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
  
  console.log('\nBy Platform:');
  Object.entries(byPlatform).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
  
  if (Object.keys(byTag).length > 0) {
    console.log('\nTop Tags:');
    Object.entries(byTag)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .forEach(([k, v]) => console.log(`  ${k}: ${v}`));
  }
}

function showHelp() {
  console.log(`
📝 Insight Capture System

Capture insights from daily work → Develop into content → Post

Commands:
  capture "insight" [--platform x|linkedin|both] [--tags t1,t2]
      Manually capture an insight
  
  extract <memory-file>
      AI-extract insights from a daily log (e.g., memory/2026-02-03.md)
  
  list [--unused] [--status raw|developed|promoted]
      List captured insights
  
  develop <id>
      Generate 5 hook variations for an insight
  
  promote <id> [hook-index]
      Move insight to content calendar with chosen hook
  
  stats
      Show insight statistics

Workflow:
  1. Work happens → Log to memory/YYYY-MM-DD.md
  2. Extract insights: node insights.js extract memory/2026-02-03.md
  3. Develop hooks: node insights.js develop I001
  4. Promote best: node insights.js promote I001 2
  5. Schedule: node tools/content.js schedule C001 --date "2026-02-05"
  6. Post (via cron or manual)

Example:
  node insights.js capture "Needed a CAPTCHA solver but the signup had a CAPTCHA. The irony of agent independence." --platform both --tags ai,irony,building
`);
}

// CLI
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  // Parse flags
  const flags = {};
  let positional = [];
  
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
      flags[key] = value;
    } else {
      positional.push(args[i]);
    }
  }
  
  switch (command) {
    case 'capture':
      if (!positional[0]) {
        console.error('Usage: node insights.js capture "your insight"');
        process.exit(1);
      }
      captureInsight(positional[0], {
        platform: flags.platform,
        tags: flags.tags ? flags.tags.split(',') : []
      });
      break;
      
    case 'extract':
      if (!positional[0]) {
        console.error('Usage: node insights.js extract <memory-file>');
        process.exit(1);
      }
      await extractFromLog(positional[0]);
      break;
      
    case 'list':
      listInsights({ unused: flags.unused, status: flags.status });
      break;
      
    case 'develop':
      if (!positional[0]) {
        console.error('Usage: node insights.js develop <insight-id>');
        process.exit(1);
      }
      await developInsight(positional[0]);
      break;
      
    case 'promote':
      if (!positional[0]) {
        console.error('Usage: node insights.js promote <insight-id> [hook-index]');
        process.exit(1);
      }
      promoteInsight(positional[0], parseInt(positional[1]) || 0);
      break;
      
    case 'stats':
      showStats();
      break;
      
    case 'help':
    case '--help':
    case '-h':
    default:
      showHelp();
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
