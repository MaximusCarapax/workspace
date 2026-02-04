#!/usr/bin/env node
/**
 * Database CLI Tool
 * Manage tasks, costs, errors, memory from command line
 */

const db = require('../lib/db');

const args = process.argv.slice(2);
const command = args[0];
const subcommand = args[1];

function formatDate(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString();
}

function formatCost(usd) {
  if (usd === null || usd === undefined) return '$0.00';
  return `$${usd.toFixed(4)}`;
}

// ============================================================
// TASKS
// ============================================================

function tasksList(options = {}) {
  const tasks = db.getTasks(options);
  if (tasks.length === 0) {
    console.log('No tasks found.');
    return;
  }
  
  console.log('\n📋 Tasks\n');
  for (const task of tasks) {
    const priority = ['', '🔴', '🟠', '🟡', '⚪'][task.priority] || '';
    const status = {
      'todo': '⬜',
      'in_progress': '🔄',
      'blocked': '🚫',
      'done': '✅',
      'cancelled': '❌'
    }[task.status] || '?';
    
    console.log(`  ${status} [${task.id}] ${priority} ${task.title}`);
    if (task.due_date) {
      console.log(`       Due: ${task.due_date}`);
    }
    if (task.blocked_reason) {
      console.log(`       Blocked: ${task.blocked_reason}`);
    }
  }
  console.log('');
}

function tasksAdd(title, options = {}) {
  const id = db.addTask({ title, ...options });
  console.log(`✅ Added task #${id}: ${title}`);
}

function tasksDone(id) {
  db.completeTask(id);
  console.log(`✅ Completed task #${id}`);
}

function tasksUpdate(id, updates) {
  db.updateTask(id, updates);
  console.log(`✅ Updated task #${id}`);
}

// ============================================================
// COSTS
// ============================================================

function costsToday() {
  const stats = db.getCostsToday();
  console.log('\n💰 Today\'s Costs\n');
  console.log(`  Total:      ${formatCost(stats.total)}`);
  console.log(`  Tokens In:  ${stats.tokens_in.toLocaleString()}`);
  console.log(`  Tokens Out: ${stats.tokens_out.toLocaleString()}`);
  console.log(`  Requests:   ${stats.requests}`);
  console.log('');
}

function costsLast24h() {
  const stats = db.db.prepare(`
    SELECT 
      COALESCE(SUM(cost_usd), 0) as total,
      COALESCE(SUM(tokens_in), 0) as tokens_in,
      COALESCE(SUM(tokens_out), 0) as tokens_out,
      COUNT(*) as requests
    FROM token_usage 
    WHERE created_at > datetime('now', '-24 hours')
  `).get();
  
  console.log('\n💰 Last 24 Hours\n');
  console.log(`  Total:      ${formatCost(stats.total)}`);
  console.log(`  Tokens In:  ${stats.tokens_in.toLocaleString()}`);
  console.log(`  Tokens Out: ${stats.tokens_out.toLocaleString()}`);
  console.log(`  Requests:   ${stats.requests}`);
  console.log('');
}

function costsByDay(days = 7) {
  const stats = db.db.prepare(`
    SELECT 
      date(created_at) as day,
      COALESCE(SUM(cost_usd), 0) as total,
      COUNT(*) as requests
    FROM token_usage 
    WHERE created_at > datetime('now', '-' || ? || ' days')
    GROUP BY day
    ORDER BY day DESC
  `).all(days);
  
  if (stats.length === 0) {
    console.log('No usage data found.');
    return;
  }
  
  console.log(`\n💰 Daily Costs (last ${days} days)\n`);
  let grandTotal = 0;
  for (const row of stats) {
    console.log(`  ${row.day}: ${formatCost(row.total)} (${row.requests} requests)`);
    grandTotal += row.total;
  }
  console.log(`  ─────────────────────`);
  console.log(`  Total: ${formatCost(grandTotal)}`);
  console.log('');
}

function costsByModel(days = 7) {
  const stats = db.getCostsByModel(days);
  if (stats.length === 0) {
    console.log('No usage data found.');
    return;
  }
  
  console.log(`\n💰 Costs by Model (last ${days} days)\n`);
  for (const row of stats) {
    console.log(`  ${row.model}`);
    console.log(`    Cost: ${formatCost(row.total)} | Requests: ${row.requests}`);
  }
  console.log('');
}

function costsAll() {
  const total = db.db.prepare(`
    SELECT COALESCE(SUM(cost_usd), 0) as total, COUNT(*) as requests
    FROM token_usage
  `).get();
  
  const byModel = db.getCostsByModel(365);
  
  console.log('\n💰 All-Time Costs\n');
  console.log(`  Total: ${formatCost(total.total)} (${total.requests} requests)\n`);
  console.log('  By Model:');
  for (const row of byModel) {
    const pct = total.total > 0 ? (row.total / total.total * 100).toFixed(1) : 0;
    console.log(`    ${row.model}: ${formatCost(row.total)} (${pct}%)`);
  }
  console.log('');
}

// ============================================================
// ERRORS
// ============================================================

function errorsShow() {
  const errors = db.getUnresolvedErrors();
  if (errors.length === 0) {
    console.log('✅ No unresolved errors.');
    return;
  }
  
  console.log(`\n⚠️ Unresolved Errors (${errors.length})\n`);
  for (const err of errors) {
    const level = { 'error': '🔴', 'warn': '🟡', 'info': '🔵' }[err.level] || '⚪';
    console.log(`  ${level} [${err.id}] ${err.source}: ${err.message}`);
    console.log(`       ${formatDate(err.created_at)}`);
  }
  console.log('');
}

function errorsResolve(id) {
  db.resolveError(id);
  console.log(`✅ Resolved error #${id}`);
}

// ============================================================
// ACTIVITY
// ============================================================

function activityShow(limit = 20) {
  const activity = db.getRecentActivity(limit);
  if (activity.length === 0) {
    console.log('No activity recorded.');
    return;
  }
  
  console.log('\n📜 Recent Activity\n');
  for (const act of activity) {
    console.log(`  ${formatDate(act.created_at)}`);
    console.log(`    ${act.action}: ${act.description || ''}`);
  }
  console.log('');
}

// ============================================================
// HEALTH
// ============================================================

function healthShow() {
  const health = db.getLatestHealth();
  if (health.length === 0) {
    console.log('No health checks recorded yet.');
    return;
  }
  
  console.log('\n🏥 Integration Health (latest)\n');
  for (const h of health) {
    const status = { 'ok': '🟢', 'degraded': '🟡', 'error': '🔴' }[h.status] || '⚪';
    console.log(`  ${status} ${h.integration}: ${h.status}`);
    if (h.message) console.log(`     ${h.message}`);
  }
  console.log('');
}

function healthHistory(integration, limit = 10) {
  const history = db.db.prepare(`
    SELECT * FROM health_checks 
    WHERE integration = ?
    ORDER BY checked_at DESC
    LIMIT ?
  `).all(integration, limit);
  
  if (history.length === 0) {
    console.log(`No health history for: ${integration}`);
    return;
  }
  
  console.log(`\n🏥 Health History: ${integration}\n`);
  for (const h of history) {
    const status = { 'ok': '🟢', 'degraded': '🟡', 'error': '🔴' }[h.status] || '⚪';
    console.log(`  ${status} ${h.checked_at.slice(0,16)} — ${h.status} (${h.latency_ms}ms)`);
    if (h.message) console.log(`     ${h.message}`);
  }
  console.log('');
}

// ============================================================
// MEMORY
// ============================================================

function memoryAdd(content, options = {}) {
  db.addMemory({ content, ...options });
  console.log(`✅ Added to memory: ${content.substring(0, 50)}...`);
}

function memorySearch(query) {
  const results = db.searchMemory(query);
  if (results.length === 0) {
    console.log('No matches found.');
    return;
  }
  
  console.log(`\n🧠 Memory Search: "${query}"\n`);
  for (const m of results) {
    console.log(`  [${m.id}] (${m.category}) ${m.subject || ''}`);
    console.log(`    ${m.content.substring(0, 100)}${m.content.length > 100 ? '...' : ''}`);
  }
  console.log('');
}

function memoryList(category) {
  const results = db.getMemoryByCategory(category);
  if (results.length === 0) {
    console.log(`No memories in category: ${category}`);
    return;
  }
  
  console.log(`\n🧠 Memory: ${category}\n`);
  for (const m of results) {
    console.log(`  [${m.id}] ${m.subject || '(no subject)'}`);
    console.log(`    ${m.content.substring(0, 80)}${m.content.length > 80 ? '...' : ''}`);
  }
  console.log('');
}

// ============================================================
// HELP
// ============================================================

function showHelp() {
  console.log(`
📊 Database CLI

Usage: node tools/db.js <command> [subcommand] [args]

TASKS
  tasks list [--status todo|done|all]    List tasks
  tasks add "Title" [--priority 1-4]     Add task
  tasks done <id>                        Complete task
  tasks update <id> --status <status>    Update task

COSTS
  costs today                            Today's spending
  costs 24h                              Last 24 hours
  costs daily [--days 7]                 Daily breakdown
  costs week                             By model (7 days)
  costs month                            By model (30 days)
  costs all                              All-time total

ERRORS
  errors                                 Show unresolved errors
  errors resolve <id>                    Mark resolved

ACTIVITY
  activity [--limit 20]                  Recent activity

HEALTH
  health                                 Integration status

MEMORY
  memory add "content" --category fact   Add memory
  memory search "query"                  Search memory
  memory list <category>                 List by category

Categories: fact, preference, lesson, todo, person, project, other
`);
}

// ============================================================
// MAIN
// ============================================================

function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
      flags[key] = value;
      if (value !== true) i++;
    }
  }
  return flags;
}

try {
  const flags = parseFlags(args);
  
  switch (command) {
    case 'tasks':
      switch (subcommand) {
        case 'list':
          tasksList({ status: flags.status === 'all' ? null : flags.status });
          break;
        case 'add':
          tasksAdd(args[2], { priority: flags.priority ? parseInt(flags.priority) : undefined });
          break;
        case 'done':
          tasksDone(parseInt(args[2]));
          break;
        case 'update':
          tasksUpdate(parseInt(args[2]), flags);
          break;
        default:
          tasksList();
      }
      break;
      
    case 'costs':
      switch (subcommand) {
        case 'today':
          costsToday();
          break;
        case '24h':
        case 'last24h':
          costsLast24h();
          break;
        case 'daily':
          costsByDay(flags.days ? parseInt(flags.days) : 7);
          break;
        case 'week':
          costsByModel(7);
          break;
        case 'month':
          costsByModel(30);
          break;
        case 'all':
          costsAll();
          break;
        default:
          costsToday();
      }
      break;
      
    case 'errors':
      if (subcommand === 'resolve') {
        errorsResolve(parseInt(args[2]));
      } else {
        errorsShow();
      }
      break;
      
    case 'activity':
      activityShow(flags.limit ? parseInt(flags.limit) : 20);
      break;
      
    case 'health':
      if (subcommand && subcommand !== 'show') {
        healthHistory(subcommand, flags.limit ? parseInt(flags.limit) : 10);
      } else {
        healthShow();
      }
      break;
      
    case 'memory':
      switch (subcommand) {
        case 'add':
          memoryAdd(args[2], { category: flags.category || 'other', subject: flags.subject });
          break;
        case 'search':
          memorySearch(args[2]);
          break;
        case 'list':
          memoryList(args[2]);
          break;
        default:
          showHelp();
      }
      break;
      
    default:
      showHelp();
  }
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}
