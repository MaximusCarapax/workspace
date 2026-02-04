#!/usr/bin/env node
/**
 * Database CLI Tool
 * Manage backlog, costs, errors, memory from command line
 */

const db = require('../lib/db');
const activity = require('../lib/activity');

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

function tasksBacklog() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekEnd = new Date(today);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const tasks = db.db.prepare(`SELECT * FROM tasks WHERE status IN ('todo', 'in_progress')`).all();
  
  if (tasks.length === 0) {
    console.log('No active tasks.');
    return;
  }

  const scoredTasks = tasks.map(task => {
    let score = 0;
    const priorityPoints = {1: 40, 2: 30, 3: 20, 4: 10};
    score += priorityPoints[task.priority] || 0;

    if (task.due_date) {
      const due = new Date(task.due_date);
      const dueDate = new Date(due.getFullYear(), due.getMonth(), due.getDate());
      if (dueDate < today) score += 50;
      else if (dueDate.getTime() === today.getTime()) score += 40;
      else if (dueDate <= weekEnd) score += 20;
    }

    const created = new Date(task.created_at);
    const ageDays = (now - created) / (1000 * 60 * 60 * 24);
    if (ageDays > 14) score += 20;
    else if (ageDays > 7) score += 10;

    return { ...task, score };
  });

  scoredTasks.sort((a, b) => b.score - a.score);
  const priorityEmojis = {1: '🔴', 2: '🟠', 3: '🟡', 4: '⚪'};

  console.log('\n🎯 Prioritized Backlog\n');
  scoredTasks.slice(0, 10).forEach((task, index) => {
    const dueStr = task.due_date ? new Date(task.due_date).toLocaleDateString() : '-';
    console.log(`  ${index + 1}. [${task.score}pts] ${priorityEmojis[task.priority] || '⚪'} ${task.title}`);
    if (task.due_date) console.log(`      Due: ${dueStr}`);
  });
  console.log('');
  return scoredTasks;
}

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

function costsAlertStatus() {
  const fs = require('fs');
  const path = require('path');
  
  const configFile = path.join(process.env.HOME, '.openclaw', 'config', 'cost-alert.json');
  const stateFile = path.join(process.env.HOME, '.openclaw', 'data', 'cost-alert-state.json');
  
  // Load config
  let config = { threshold_usd: 150, enabled: true };
  try {
    if (fs.existsSync(configFile)) {
      config = { ...config, ...JSON.parse(fs.readFileSync(configFile, 'utf8')) };
    }
  } catch (error) {
    console.error('Error loading config:', error.message);
  }
  
  // Load state
  let state = {};
  try {
    if (fs.existsSync(stateFile)) {
      state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    }
  } catch (error) {
    console.error('Error loading state:', error.message);
  }
  
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const todayState = state[today];
  
  // Get today's spending
  const todayCosts = db.getCostsToday();
  
  console.log('\n🚨 Cost Alert Status\n');
  console.log(`  Current spend today: ${formatCost(todayCosts.total)}`);
  console.log(`  Alert threshold: ${formatCost(config.threshold_usd)}`);
  console.log(`  Alerting enabled: ${config.enabled ? 'Yes' : 'No'}\n`);
  
  if (todayState && todayState.alerted_at) {
    console.log(`  Last alert: ${formatDate(todayState.alerted_at)}`);
    console.log(`  Spend at alert: ${formatCost(todayState.spend_at_alert)}`);
    console.log(`  Alert threshold: ${formatCost(todayState.threshold_usd)}`);
  } else {
    console.log('  No alerts sent today');
  }
  
  // Show recent alerts
  const recentDays = Object.keys(state).sort().slice(-7);
  if (recentDays.length > 0) {
    console.log('\n  Recent alerts:');
    recentDays.forEach(date => {
      const dayState = state[date];
      if (dayState.alerted_at) {
        console.log(`    ${date}: ${formatCost(dayState.spend_at_alert)} (threshold: ${formatCost(dayState.threshold_usd)})`);
      }
    });
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

function activityShow(options = {}) {
  const {
    limit = 20,
    category,
    since,
    until,
    action,
    search
  } = options;
  
  let activities;
  
  // Handle different filtering scenarios
  if (since || until) {
    // Use date range filtering
    const startDate = since || '1970-01-01';
    const endDate = until || new Date().toISOString().split('T')[0];
    activities = activity.getActivitiesByDate(startDate, endDate, limit);
  } else if (action) {
    // Filter by action
    activities = activity.getActivitiesByAction(action, limit);
  } else if (category) {
    // Filter by category
    activities = activity.getActivitiesByCategory(category, limit);
  } else {
    // Default to recent activities
    activities = activity.getRecent(limit);
  }
  
  // Apply search filter if provided
  if (search && activities.length > 0) {
    const searchLower = search.toLowerCase();
    activities = activities.filter(act => 
      (act.description && act.description.toLowerCase().includes(searchLower)) ||
      (act.action && act.action.toLowerCase().includes(searchLower)) ||
      (act.category && act.category.toLowerCase().includes(searchLower))
    );
  }
  
  if (activities.length === 0) {
    console.log('No activity recorded matching the criteria.');
    return;
  }
  
  console.log('\n📜 Activity Log\n');
  console.log(`  Found ${activities.length} activities`);
  if (category) console.log(`  Category: ${category}`);
  if (action) console.log(`  Action: ${action}`);
  if (since) console.log(`  Since: ${since}`);
  if (until) console.log(`  Until: ${until}`);
  if (search) console.log(`  Search: "${search}"`);
  console.log('');
  
  for (const act of activities) {
    const categoryStr = act.category ? ` [${act.category}]` : '';
    console.log(`  ${formatDate(act.created_at)}${categoryStr}`);
    console.log(`    ${act.action}: ${act.description || ''}`);
    if (act.metadata) {
      try {
        const meta = JSON.parse(act.metadata);
        if (Object.keys(meta).length > 0) {
          console.log(`    Metadata: ${JSON.stringify(meta)}`);
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
  }
  console.log('');
}

function activitySummary(description = null) {
  // If a description is provided, log it as a session summary
  if (description) {
    // Log the session summary as an activity
    activity.log('session_summary', description, 'session');
    console.log(`\n📝 Logged session summary: "${description}"\n`);
    
    // Note: Auto-detection for significant sessions could be added here
    // For example, check if recent token usage > 5000 or duration > 30 minutes
    // This would require querying the database for recent usage data
    // For now, we just log the manual description
    return;
  }
  
  // Otherwise, show the statistics summary (original behavior)
  const digest = activity.getDigest({ period: 'day', limit: 10 });
  
  console.log('\n📊 Activity Summary (Last 24 Hours)\n');
  console.log(`  Total activities: ${digest.stats.total}`);
  console.log(`  Unique actions: ${digest.stats.unique_actions}`);
  console.log(`  Unique categories: ${digest.stats.unique_categories}`);
  console.log(`  Most common action: ${digest.stats.most_common_action || 'N/A'}`);
  console.log(`  Most common category: ${digest.stats.most_common_category || 'N/A'}`);
  console.log('');
  
  if (digest.recent_activities.length > 0) {
    console.log('  Recent activities:');
    for (const act of digest.recent_activities.slice(0, 5)) {
      console.log(`    ${formatDate(act.created_at)} ${act.action}: ${act.description?.substring(0, 50)}${act.description?.length > 50 ? '...' : ''}`);
    }
  }
  console.log('');
}

function activityStats(period = 'day') {
  const stats = activity.getStats(period);
  
  console.log(`\n📈 Activity Statistics (Last ${period})\n`);
  console.log(`  Total activities: ${stats.total}`);
  console.log(`  Unique actions: ${stats.unique_actions}`);
  console.log(`  Unique categories: ${stats.unique_categories}`);
  console.log(`  Most common action: ${stats.most_common_action || 'N/A'}`);
  console.log(`  Most common category: ${stats.most_common_category || 'N/A'}`);
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
// CONTACTS
// ============================================================

function contactsList() {
  const rows = db.db.prepare(`
    SELECT id, name, company, last_contact, follow_up_date 
    FROM contacts 
    ORDER BY name COLLATE NOCASE
  `).all();
  
  if (rows.length === 0) {
    console.log('No contacts yet. Add one with: contacts add "Name"');
    return rows;
  }
  
  console.log('\n📇 Contacts\n');
  for (const c of rows) {
    const last = c.last_contact ? new Date(c.last_contact).toLocaleDateString() : 'Never';
    const follow = c.follow_up_date ? new Date(c.follow_up_date).toLocaleDateString() : '-';
    console.log(`  [${c.id}] ${c.name} | ${c.company || '-'} | Last: ${last} | Follow-up: ${follow}`);
  }
  console.log('');
  return rows;
}

function contactsAdd(name, opts = {}) {
  const sql = `INSERT INTO contacts (name, email, phone, company, role, tags, source) VALUES (?, ?, ?, ?, ?, ?, ?)`;
  const info = db.db.prepare(sql).run(
    name,
    opts.email || null,
    opts.phone || null,
    opts.company || null,
    opts.role || null,
    opts.tags || null,
    opts.source || null
  );
  console.log(`✅ Added contact: ${name} (ID: ${info.lastInsertRowid})`);
  return { id: info.lastInsertRowid, name };
}

function contactsUpdate(id, opts = {}) {
  const allowedFields = ['name', 'email', 'phone', 'company', 'role', 'notes', 'tags', 'last_contact', 'follow_up_date', 'source'];
  const updates = [];
  const values = [];
  
  for (const [key, val] of Object.entries(opts)) {
    if (allowedFields.includes(key) && val !== undefined) {
      updates.push(`${key} = ?`);
      values.push(val);
    }
  }
  
  if (updates.length === 0) {
    console.log('⚠️ No valid fields to update');
    return null;
  }
  
  updates.push("updated_at = datetime('now')");
  values.push(id);
  
  const sql = `UPDATE contacts SET ${updates.join(', ')} WHERE id = ?`;
  const result = db.db.prepare(sql).run(...values);
  
  if (result.changes > 0) {
    console.log(`✅ Updated contact ID: ${id}`);
    return { id, updated: true };
  } else {
    console.log(`❌ Contact ID ${id} not found`);
    return { id, updated: false };
  }
}

function contactsSearch(query) {
  const sql = `SELECT id, name, company, email, tags FROM contacts WHERE name LIKE ? OR company LIKE ? OR tags LIKE ? ORDER BY name COLLATE NOCASE`;
  const searchTerm = `%${query}%`;
  const rows = db.db.prepare(sql).all(searchTerm, searchTerm, searchTerm);
  
  if (rows.length === 0) {
    console.log(`No contacts matching "${query}"`);
    return rows;
  }
  
  console.log(`\n🔍 Search: "${query}"\n`);
  for (const c of rows) {
    console.log(`  [${c.id}] ${c.name} | ${c.company || '-'} | ${c.email || '-'} | ${c.tags || '-'}`);
  }
  console.log('');
  return rows;
}

function contactsFollowup() {
  const sql = `SELECT id, name, company, follow_up_date, last_contact FROM contacts WHERE follow_up_date IS NOT NULL AND date(follow_up_date) <= date('now') ORDER BY date(follow_up_date) ASC`;
  const rows = db.db.prepare(sql).all();
  
  if (rows.length === 0) {
    console.log('No follow-ups due.');
    return rows;
  }
  
  console.log('\n🔔 Follow-ups Due\n');
  for (const c of rows) {
    const follow = new Date(c.follow_up_date).toLocaleDateString();
    const last = c.last_contact ? new Date(c.last_contact).toLocaleDateString() : 'Never';
    console.log(`  [${c.id}] ${c.name} | ${c.company || '-'} | Due: ${follow} | Last: ${last}`);
  }
  console.log('');
  return rows;
}

// ============================================================
// HELP
// ============================================================

function showHelp() {
  console.log(`
📊 Database CLI

Usage: node tools/db.js <command> [subcommand] [args]

BACKLOG
  backlog list [--status todo|done|all]  List all tasks
  backlog prioritize                     Smart prioritized view
  backlog add "Title" [--priority 1-4]   Add task
  backlog done <id>                      Complete task
  backlog update <id> --status <status>  Update task

COSTS
  costs today                            Today's spending
  costs 24h                              Last 24 hours
  costs daily [--days 7]                 Daily breakdown
  costs week                             By model (7 days)
  costs month                            By model (30 days)
  costs all                              All-time total
  costs alert-status                     Cost alert status and history

ERRORS
  errors                                 Show unresolved errors
  errors resolve <id>                    Mark resolved

ACTIVITY
  activity [--limit 20] [--category <cat>] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--action <act>] [--search <text>]
                                         Filtered activity log
  activity summary                       Daily summary with statistics
  activity stats [--period day|week|month] Activity statistics

HEALTH
  health                                 Integration status

MEMORY
  memory add "content" --category fact   Add memory
  memory search "query"                  Search memory
  memory list <category>                 List by category

CONTACTS
  contacts list                          List all contacts
  contacts add "Name" [--email --phone --company --role --tags --source]
  contacts update <id> [--field value]   Update contact fields
  contacts search "query"                Search by name/company/tags
  contacts followup                      Show due follow-ups

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
    case 'backlog':
      switch (subcommand) {
        case 'list':
          tasksList({ status: flags.status === 'all' ? null : flags.status });
          break;
        case 'prioritize':
          tasksBacklog();
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
        case 'alert-status':
          costsAlertStatus();
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
      if (subcommand === 'summary') {
        // Check if there's a description argument
        const description = args[2];
        activitySummary(description);
      } else if (subcommand === 'stats') {
        activityStats(flags.period || 'day');
      } else {
        // Handle filtering flags
        const options = {
          limit: flags.limit ? parseInt(flags.limit) : 20,
          category: flags.category || null,
          since: flags.since || null,
          until: flags.until || null,
          action: flags.action || null,
          search: flags.search || null
        };
        activityShow(options);
      }
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
    
    case 'contacts':
      switch (subcommand) {
        case 'list':
          contactsList();
          break;
        case 'add':
          contactsAdd(args[2], flags);
          break;
        case 'update':
          contactsUpdate(parseInt(args[2]), flags);
          break;
        case 'search':
          contactsSearch(args[2]);
          break;
        case 'followup':
          contactsFollowup();
          break;
        default:
          contactsList();
      }
      break;
      
    default:
      showHelp();
  }
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}
