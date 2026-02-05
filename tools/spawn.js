#!/usr/bin/env node

/**
 * Sub-Agent Spawn Tool
 * 
 * Spawns role-based sub-agents with lean, focused context.
 * 
 * Usage:
 *   node tools/spawn.js <role> "task description" [options]
 * 
 * Roles: dev, qa, researcher, writer, spec
 * 
 * Examples:
 *   node tools/spawn.js dev "Build the feature from specs/widget.md"
 *   node tools/spawn.js qa "Review the auth module against spec"
 *   node tools/spawn.js researcher "Find AI agent frameworks comparison"
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Import context builder
const contextBuilder = require('../subagents/context-builder');

// Try to import db for semantic search
let db;
try {
  db = require('../lib/db');
} catch (e) {
  db = null;
}

const ROLES = contextBuilder.ROLES;

// Default models by role
const ROLE_MODELS = {
  developer: 'claude-sonnet-4-20250514',
  qa: 'claude-haiku-4-5-20251001',
  researcher: 'claude-sonnet-4-20250514',
  writer: 'claude-sonnet-4-20250514',
  spec: 'claude-sonnet-4-20250514'
};

/**
 * Search for relevant memories using semantic search
 */
async function searchMemories(query, limit = 3) {
  if (!db || !db.searchMemoryByEmbedding) {
    return [];
  }
  
  try {
    // Try semantic search first
    const embedding = await db.generateEmbedding(query);
    const results = db.searchMemoryByEmbedding({
      embedding,
      limit,
      threshold: 0.4
    });
    return results.map(r => r.content);
  } catch (e) {
    // Fall back to keyword search
    try {
      const results = db.searchMemory(query, limit);
      return results.map(r => r.content);
    } catch (e2) {
      return [];
    }
  }
}

/**
 * Load spec file if task references one
 */
function loadSpecIfReferenced(task) {
  // Look for patterns like "from specs/X.md" or "spec: X"
  const specPatterns = [
    /specs?\/([^\s]+\.md)/i,
    /spec(?:ification)?:\s*([^\s]+\.md)/i,
    /read\s+([^\s]+\.md)/i
  ];
  
  for (const pattern of specPatterns) {
    const match = task.match(pattern);
    if (match) {
      const specPath = match[1].startsWith('specs/') ? match[1] : `specs/${match[1]}`;
      const fullPath = path.join(process.cwd(), specPath);
      if (fs.existsSync(fullPath)) {
        return fs.readFileSync(fullPath, 'utf-8');
      }
    }
  }
  
  return null;
}

/**
 * Display help
 */
function showHelp() {
  console.log(`
🚀 Sub-Agent Spawn Tool

Usage: node tools/spawn.js <role> "task description" [options]

Roles:
  dev, developer    Ship code (uses aider + DeepSeek)
  qa, review        Test and verify (skeptical, thorough)
  researcher        Find and synthesize info
  writer            Create content (hook-focused)
  spec              Write specifications

Options:
  --model <model>   Override default model
  --label <label>   Custom session label
  --timeout <sec>   Task timeout in seconds
  --dry-run         Show context without spawning
  --memories        Include semantic memory search

Examples:
  node tools/spawn.js dev "Build the widget from specs/widget.md"
  node tools/spawn.js qa "Test the auth flow against acceptance criteria"
  node tools/spawn.js researcher "Compare AI agent frameworks" --timeout 300
  node tools/spawn.js dev "Add user validation" --dry-run

Default models:
  developer:  Sonnet (orchestrates DeepSeek via aider)
  qa:         Haiku (fast, checklist-focused)
  researcher: Sonnet (synthesis)
  writer:     Sonnet (creative)
  spec:       Sonnet (structured thinking)
`);
}

/**
 * Parse CLI arguments
 */
function parseArgs(args) {
  const result = {
    role: null,
    task: null,
    model: null,
    label: null,
    timeout: 1800, // 30 min default
    dryRun: false,
    includeMemories: true
  };
  
  let i = 0;
  
  // First non-flag arg is role
  while (i < args.length && args[i].startsWith('--')) i++;
  if (i < args.length) {
    result.role = args[i];
    i++;
  }
  
  // Second non-flag arg is task
  while (i < args.length && args[i].startsWith('--')) i++;
  if (i < args.length) {
    result.task = args[i];
    i++;
  }
  
  // Parse flags
  for (let j = 0; j < args.length; j++) {
    if (args[j] === '--model' && args[j + 1]) {
      result.model = args[j + 1];
    } else if (args[j] === '--label' && args[j + 1]) {
      result.label = args[j + 1];
    } else if (args[j] === '--timeout' && args[j + 1]) {
      result.timeout = parseInt(args[j + 1], 10);
    } else if (args[j] === '--dry-run') {
      result.dryRun = true;
    } else if (args[j] === '--no-memories') {
      result.includeMemories = false;
    } else if (args[j] === '--help' || args[j] === '-h') {
      result.help = true;
    }
  }
  
  return result;
}

/**
 * Main
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  
  if (args.help || !args.role || !args.task) {
    showHelp();
    process.exit(args.help ? 0 : 1);
  }
  
  // Validate role
  const normalizedRole = contextBuilder.ROLE_ALIASES[args.role] || args.role;
  if (!ROLES.includes(normalizedRole) && !ROLES.includes(args.role)) {
    console.error(`❌ Unknown role: ${args.role}`);
    console.error(`   Valid roles: ${ROLES.join(', ')}`);
    process.exit(1);
  }
  
  console.log(`\n🔧 Building context for ${normalizedRole} agent...`);
  
  // Build options
  const options = {};
  
  // Search for relevant memories
  if (args.includeMemories) {
    console.log(`   Searching memories...`);
    options.memories = await searchMemories(args.task);
    if (options.memories.length > 0) {
      console.log(`   Found ${options.memories.length} relevant memories`);
    }
  }
  
  // Load spec if referenced
  const specContent = loadSpecIfReferenced(args.task);
  if (specContent) {
    console.log(`   Loaded referenced spec file`);
    options.specContent = specContent;
  }
  
  // Build context
  const result = contextBuilder.build(normalizedRole, args.task, options);
  
  console.log(`   Context size: ~${result.tokens} tokens`);
  
  if (args.dryRun) {
    console.log(`\n--- DRY RUN: Full Context ---\n`);
    console.log(result.context);
    console.log(`\n--- End Context (${result.tokens} tokens) ---\n`);
    return;
  }
  
  // Determine model
  const model = args.model || ROLE_MODELS[normalizedRole];
  const label = args.label || `${normalizedRole}-${Date.now()}`;
  
  console.log(`\n🚀 Spawning ${normalizedRole} agent...`);
  console.log(`   Model: ${model}`);
  console.log(`   Label: ${label}`);
  console.log(`   Timeout: ${args.timeout}s`);
  
  // Output the spawn command for the main agent to execute
  // Since this runs in Node, we can't directly call sessions_spawn
  // Instead, output JSON that can be used by the calling agent
  const spawnConfig = {
    task: result.context,
    model,
    label,
    runTimeoutSeconds: args.timeout,
    cleanup: 'keep'
  };
  
  console.log(`\n📋 Spawn Configuration:`);
  console.log(JSON.stringify(spawnConfig, null, 2));
  
  console.log(`\n✅ Context built. Use sessions_spawn with the above config.`);
  console.log(`   Or copy the task field for manual spawning.`);
}

main().catch(err => {
  console.error(`❌ Error: ${err.message}`);
  process.exit(1);
});
