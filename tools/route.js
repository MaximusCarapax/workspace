#!/usr/bin/env node
/**
 * Model Router CLI
 * 
 * Routes tasks to the cheapest capable model.
 * 
 * Usage:
 *   node tools/route.js "Summarize this article" --content article.txt
 *   node tools/route.js --type code "Write a function to validate emails"
 *   node tools/route.js --provider deepseek "Force this to DeepSeek"
 *   node tools/route.js --dry-run "What model would handle this?"
 *   node tools/route.js stats
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { route, dryRun, getStats, detectTaskType, providers, DEFAULT_CONFIG } = require('../lib/router');

async function main() {
  const args = process.argv.slice(2);
  
  // Help
  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    console.log(`🔀 Model Router

Usage:
  node tools/route.js <prompt>                    Route task (auto-detect type)
  node tools/route.js --type code <prompt>        Explicit task type
  node tools/route.js --provider deepseek <prompt> Force provider
  node tools/route.js --content file.txt <prompt> Include file content
  node tools/route.js --dry-run <prompt>          Show routing without executing
  node tools/route.js stats [--days N]            Show routing stats
  node tools/route.js config                      Show routing config

Options:
  --type <type>       Explicit task type (summarize, code, debug, etc.)
  --provider <name>   Force specific provider (gemini, deepseek)
  --content <file>    Read content from file
  --dry-run           Show what would happen without executing
  --days <N>          Days of history for stats (default: 7)

Task Types:
  summarize, research, extract, translate  → Gemini (FREE)
  code, debug, refactor, test              → DeepSeek ($0.14/M)
  default                                  → Gemini (FREE)

Examples:
  route.js "Summarize this" --content article.txt
  route.js --type code "Write a sort function"
  route.js --dry-run "Debug this error: ..."
`);
    return;
  }
  
  // Stats command
  if (args[0] === 'stats') {
    const daysIdx = args.indexOf('--days');
    const days = daysIdx > -1 ? parseInt(args[daysIdx + 1]) || 7 : 7;
    
    const stats = await getStats(days);
    if (!stats || stats.length === 0) {
      console.log('📊 No routing stats yet.');
      return;
    }
    
    console.log(`📊 Routing Stats (${days} days)\n`);
    console.log('Task Type      | Provider   | Calls | Cost');
    console.log('---------------|------------|-------|--------');
    
    let totalCost = 0;
    let totalCalls = 0;
    
    for (const row of stats) {
      const taskType = (row.task_type || 'unknown').padEnd(14);
      const provider = (row.model?.split('/')[0] || 'unknown').padEnd(10);
      const calls = String(row.calls).padStart(5);
      const cost = `$${(row.total_cost || 0).toFixed(4)}`;
      totalCost += row.total_cost || 0;
      totalCalls += row.calls;
      
      console.log(`${taskType} | ${provider} | ${calls} | ${cost}`);
    }
    
    console.log('---------------|------------|-------|--------');
    console.log(`${'TOTAL'.padEnd(14)} | ${''.padEnd(10)} | ${String(totalCalls).padStart(5)} | $${totalCost.toFixed(4)}`);
    return;
  }
  
  // Config command
  if (args[0] === 'config') {
    console.log('📋 Routing Configuration\n');
    console.log('Routes:');
    for (const [type, provider] of Object.entries(DEFAULT_CONFIG.routes)) {
      const p = providers[provider];
      const cost = p ? (p.cost.in === 0 && p.cost.out === 0 ? 'FREE' : `$${p.cost.out}/M out`) : '?';
      console.log(`  ${type.padEnd(12)} → ${provider.padEnd(10)} (${cost})`);
    }
    console.log('\nFallbacks:');
    for (const [provider, fallbacks] of Object.entries(DEFAULT_CONFIG.fallbacks)) {
      console.log(`  ${provider} → ${fallbacks.join(' → ')}`);
    }
    return;
  }
  
  // Parse arguments
  let type = null;
  let provider = null;
  let contentFile = null;
  let isDryRun = false;
  let prompt = null;
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--type' || arg === '-t') {
      type = args[++i];
    } else if (arg === '--provider' || arg === '-p') {
      provider = args[++i];
    } else if (arg === '--content' || arg === '-c') {
      contentFile = args[++i];
    } else if (arg === '--dry-run' || arg === '-d') {
      isDryRun = true;
    } else if (!arg.startsWith('-')) {
      prompt = arg;
    }
  }
  
  if (!prompt) {
    console.error('Error: No prompt provided');
    process.exit(1);
  }
  
  // Read content file if specified
  let content = null;
  if (contentFile) {
    const filePath = path.resolve(contentFile);
    if (!fs.existsSync(filePath)) {
      console.error(`Error: File not found: ${contentFile}`);
      process.exit(1);
    }
    content = fs.readFileSync(filePath, 'utf8');
  }
  
  // Dry run
  if (isDryRun) {
    const result = dryRun({ type, prompt, content, provider });
    console.log(`🔍 Dry Run\n`);
    console.log(`Detected type: ${result.taskType}`);
    console.log(`Would route to: ${result.provider}/${result.model}`);
    if (result.fallbacks.length) {
      console.log(`Fallbacks: ${result.fallbacks.join(' → ')}`);
    }
    return;
  }
  
  // Execute route
  try {
    console.error(`🔀 Routing...`);
    const result = await route({ type, prompt, content, provider });
    
    console.error(`\n✅ Routed to: ${result.provider}/${result.model}`);
    console.error(`   Task type: ${result.taskType}`);
    console.error(`   Tokens: ${result.tokens.in} in, ${result.tokens.out} out`);
    console.error(`   Cost: $${result.cost.toFixed(6)}`);
    console.error(`   Latency: ${result.latency}ms\n`);
    console.error('---');
    
    // Output result to stdout
    console.log(result.result);
  } catch (err) {
    console.error(`\n❌ Error: ${err.message}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
