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
  let sql = `
    SELECT t.*, p.name as project_name 
    FROM tasks t 
    LEFT JOIN projects p ON t.project_id = p.id 
    WHERE 1=1
  `;
  const params = [];
  
  if (options.status) {
    sql += ` AND t.status = ?`;
    params.push(options.status);
  } else {
    sql += ` AND t.status != 'done'`;
  }
  
  if (options.project) {
    if (isNaN(options.project)) {
      sql += ` AND p.name LIKE ?`;
      params.push(`%${options.project}%`);
    } else {
      sql += ` AND t.project_id = ?`;
      params.push(parseInt(options.project));
    }
  }
  
  sql += ` ORDER BY t.priority, t.created_at`;
  
  const tasks = db.db.prepare(sql).all(...params);
  
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
    
    let line = `  ${status} [${task.id}] ${priority} ${task.title}`;
    if (task.project_name) line += ` [${task.project_name}]`;
    console.log(line);
    
    if (task.due_date) console.log(`       Due: ${task.due_date}`);
    if (task.blocked_reason) console.log(`       Blocked: ${task.blocked_reason}`);
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
// PROJECT FUNCTIONS
// ============================================================

function projectsList() {
  const projects = db.db.prepare(`
    SELECT p.*, 
      (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND status != 'done') as active_tasks,
      (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND status = 'done') as done_tasks
    FROM projects p
    WHERE status != 'archived'
    ORDER BY name
  `).all();
  
  if (projects.length === 0) {
    console.log('No projects found. Use "db.js todos project-add <name>" to create one.');
    return;
  }
  
  console.log('\n📁 Projects\n');
  for (const p of projects) {
    const status = { active: '🟢', paused: '⏸️', completed: '✅', archived: '📦' }[p.status] || '';
    console.log(`  ${status} [${p.id}] ${p.name} (${p.active_tasks} active, ${p.done_tasks} done)`);
    if (p.description) console.log(`       ${p.description}`);
  }
  console.log('');
}

function projectAdd(name) {
  const id = db.db.prepare('INSERT INTO projects (name) VALUES (?)').run(name).lastInsertRowid;
  console.log(`✅ Created project #${id}: ${name}`);
}

function taskAssignProject(taskId, projectRef) {
  // projectRef can be id (number) or name (string)
  let projectId;
  if (isNaN(projectRef)) {
    const project = db.db.prepare('SELECT id FROM projects WHERE name LIKE ?').get(`%${projectRef}%`);
    if (!project) {
      console.log(`❌ Project "${projectRef}" not found`);
      return;
    }
    projectId = project.id;
  } else {
    projectId = parseInt(projectRef);
  }
  
  db.updateTask(taskId, { projectId: projectId });
  const project = db.db.prepare('SELECT name FROM projects WHERE id = ?').get(projectId);
  console.log(`✅ Task #${taskId} assigned to project: ${project.name}`);
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

function costsBySource(days = 7) {
  const stats = db.getCostsBySource(days);
  if (stats.length === 0) {
    console.log('No usage data found.');
    return;
  }
  
  console.log(`\n💰 Costs by Source (last ${days} days)\n`);
  let grandTotal = 0;
  for (const row of stats) {
    console.log(`  ${row.source}: ${formatCost(row.total_cost)} (${row.session_count} sessions, ${row.message_count} messages)`);
    grandTotal += row.total_cost;
  }
  console.log(`  ─────────────────────`);
  console.log(`  Total: ${formatCost(grandTotal)}`);
  console.log('');
}

function costsDailyBySource(days = 7) {
  const stats = db.db.prepare(`
    SELECT 
      date(created_at) as day,
      COALESCE(source, 'unknown') as source,
      COALESCE(SUM(cost_usd), 0) as total_cost,
      COUNT(DISTINCT session_id) as session_count,
      COUNT(*) as message_count
    FROM token_usage
    WHERE created_at > datetime('now', '-' || ? || ' days')
    GROUP BY day, source
    ORDER BY day DESC, total_cost DESC
  `).all(days);
  
  if (stats.length === 0) {
    console.log('No usage data found.');
    return;
  }
  
  console.log(`\n💰 Daily Costs by Source (last ${days} days)\n`);
  
  let currentDay = null;
  let dayTotal = 0;
  let grandTotal = 0;
  
  for (const row of stats) {
    if (row.day !== currentDay) {
      if (currentDay !== null) {
        console.log(`    Day Total: ${formatCost(dayTotal)}`);
        console.log('');
      }
      currentDay = row.day;
      dayTotal = 0;
      console.log(`  📅 ${row.day}`);
    }
    console.log(`    ${row.source}: ${formatCost(row.total_cost)} (${row.session_count} sessions, ${row.message_count} messages)`);
    dayTotal += row.total_cost;
    grandTotal += row.total_cost;
  }
  
  // Print the last day's total
  if (currentDay !== null) {
    console.log(`    Day Total: ${formatCost(dayTotal)}`);
    console.log('');
  }
  
  console.log(`  ─────────────────────`);
  console.log(`  Grand Total: ${formatCost(grandTotal)}`);
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
    search,
    source,
    related
  } = options;
  
  let activities;
  
  // Build filters for getRecentActivity
  const filters = {};
  if (source) filters.source = source;
  if (related) filters.relatedId = related;
  
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
  } else if (source || related) {
    // Use source/related filters via db directly
    activities = db.getRecentActivity(limit, filters);
  } else {
    // Default to recent activities
    activities = activity.getRecent(limit);
  }
  
  // Apply additional filters if we used a different query path
  if ((source || related) && !(since || until || action || category)) {
    // Already filtered
  } else if (source || related) {
    // Need to filter the results manually
    if (source) {
      activities = activities.filter(act => act.source === source);
    }
    if (related) {
      activities = activities.filter(act => act.related_id === related);
    }
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
  if (source) console.log(`  Source: ${source}`);
  if (related) console.log(`  Related: ${related}`);
  console.log('');
  
  for (const act of activities) {
    const categoryStr = act.category ? ` [${act.category}]` : '';
    const sourceStr = act.source ? ` (${act.source})` : '';
    const relatedStr = act.related_id ? ` → ${act.related_id}` : '';
    console.log(`  ${formatDate(act.created_at)}${categoryStr}${sourceStr}${relatedStr}`);
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
// HEARTBEAT COSTS
// ============================================================

function heartbeatCosts(options = {}) {
  const sinceDays = options.since || 7;
  
  // Query activity logs where action starts with 'heartbeat_' or category is 'heartbeat'
  const activities = db.db.prepare(`
    SELECT 
      id,
      action,
      category,
      description,
      metadata,
      created_at
    FROM activity 
    WHERE (action LIKE 'heartbeat_%' OR category = 'heartbeat')
      AND created_at > datetime('now', '-' || ? || ' days')
    ORDER BY created_at DESC
  `).all(sinceDays);
  
  if (activities.length === 0) {
    console.log(`\n📊 No heartbeat activity found in the last ${sinceDays} days.\n`);
    return;
  }
  
  // Haiku 4.5 pricing: $0.80 per million input tokens, $4.00 per million output tokens
  const PRICING_INPUT = 0.80 / 1_000_000;  // per token
  const PRICING_OUTPUT = 4.00 / 1_000_000; // per token
  
  let totalHeartbeats = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCalculatedCost = 0;
  let totalLoggedCost = 0;
  
  // Group by day for daily averages
  const dailyStats = {};
  
  for (const act of activities) {
    totalHeartbeats++;
    
    let inputTokens = 0;
    let outputTokens = 0;
    let loggedCost = 0;
    
    // Parse metadata
    if (act.metadata) {
      try {
        const metadata = JSON.parse(act.metadata);
        inputTokens = parseInt(metadata.input_tokens) || 0;
        outputTokens = parseInt(metadata.output_tokens) || 0;
        loggedCost = parseFloat(metadata.cost_usd) || 0;
      } catch (e) {
        // Ignore parse errors
      }
    }
    
    totalInputTokens += inputTokens;
    totalOutputTokens += outputTokens;
    totalLoggedCost += loggedCost;
    
    // Calculate cost using Haiku pricing
    const calculatedCost = (inputTokens * PRICING_INPUT) + (outputTokens * PRICING_OUTPUT);
    totalCalculatedCost += calculatedCost;
    
    // Group by date for daily stats
    const date = act.created_at.split('T')[0];
    if (!dailyStats[date]) {
      dailyStats[date] = {
        count: 0,
        inputTokens: 0,
        outputTokens: 0,
        cost: 0
      };
    }
    dailyStats[date].count++;
    dailyStats[date].inputTokens += inputTokens;
    dailyStats[date].outputTokens += outputTokens;
    dailyStats[date].cost += calculatedCost;
  }
  
  // Calculate averages
  const avgCostPerHeartbeat = totalHeartbeats > 0 ? totalCalculatedCost / totalHeartbeats : 0;
  const avgDailyHeartbeats = Object.keys(dailyStats).length > 0 ? 
    totalHeartbeats / Object.keys(dailyStats).length : 0;
  const avgDailyCost = Object.keys(dailyStats).length > 0 ? 
    totalCalculatedCost / Object.keys(dailyStats).length : 0;
  
  console.log(`\n📊 Heartbeat Costs (Last ${sinceDays} days)\n`);
  console.log(`  Total heartbeats: ${totalHeartbeats.toLocaleString()}`);
  console.log(`  Total input tokens: ${totalInputTokens.toLocaleString()}`);
  console.log(`  Total output tokens: ${totalOutputTokens.toLocaleString()}`);
  console.log(`  Calculated cost (Haiku 4.5): $${totalCalculatedCost.toFixed(6)}`);
  console.log(`  Logged cost (from metadata): $${totalLoggedCost.toFixed(6)}`);
  console.log(`  Average cost per heartbeat: $${avgCostPerHeartbeat.toFixed(6)}`);
  console.log(`  Daily average heartbeats: ${avgDailyHeartbeats.toFixed(1)}`);
  console.log(`  Daily average cost: $${avgDailyCost.toFixed(6)}`);
  console.log(`  Pricing used: $0.80/M input, $4.00/M output`);
  
  // Show daily breakdown if there are multiple days
  const sortedDates = Object.keys(dailyStats).sort().reverse();
  if (sortedDates.length > 1) {
    console.log(`\n  Daily Breakdown:`);
    for (const date of sortedDates.slice(0, 14)) { // Show up to last 14 days
      const stats = dailyStats[date];
      console.log(`    ${date}: ${stats.count} heartbeats, $${stats.cost.toFixed(6)}`);
    }
  }
  
  // Show recent heartbeats
  console.log(`\n  Recent Heartbeats (last 5):`);
  const recent = activities.slice(0, 5);
  for (const act of recent) {
    const date = new Date(act.created_at).toLocaleString();
    let inputTokens = 0;
    let outputTokens = 0;
    let loggedCost = 0;
    
    if (act.metadata) {
      try {
        const metadata = JSON.parse(act.metadata);
        inputTokens = parseInt(metadata.input_tokens) || 0;
        outputTokens = parseInt(metadata.output_tokens) || 0;
        loggedCost = parseFloat(metadata.cost_usd) || 0;
      } catch (e) {
        // Ignore parse errors
      }
    }
    
    const calculatedCost = (inputTokens * PRICING_INPUT) + (outputTokens * PRICING_OUTPUT);
    console.log(`    ${date}: ${inputTokens.toLocaleString()}+${outputTokens.toLocaleString()} tokens, $${calculatedCost.toFixed(6)}`);
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

async function memorySemanticSearch(query, options = {}) {
  const limit = options.limit || 10;
  const threshold = options.threshold || 0.4;
  const model = 'text-embedding-3-small';
  
  try {
    console.log(`\n🧠 Semantic Search: "${query}"\n`);
    console.log('Generating query embedding...');
    
    const queryEmbedding = await db.generateEmbedding(query);
    
    console.log('Searching memories...');
    const results = db.searchMemoryByEmbedding({
      model,
      embedding: queryEmbedding,
      limit,
      threshold
    });
    
    if (results.length === 0) {
      console.log('No semantically similar memories found.');
      // Fallback to keyword search
      console.log('\nFalling back to keyword search...');
      memorySearch(query);
      return;
    }
    
    console.log(`Found ${results.length} similar memories:\n`);
    for (const m of results) {
      const similarity = (m.similarity * 100).toFixed(1);
      console.log(`  [${m.id}] (${m.category}) ${similarity}% similarity`);
      console.log(`    ${m.subject || '(no subject)'}`);
      console.log(`    ${m.content.substring(0, 120)}${m.content.length > 120 ? '...' : ''}`);
      console.log('');
    }
  } catch (error) {
    console.error('Error in semantic search:', error.message);
    console.log('\nFalling back to keyword search...');
    memorySearch(query);
  }
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

async function memoryBackfillEmbeddings() {
  const model = 'text-embedding-3-small';
  
  console.log('\n🧠 Backfilling Memory Embeddings\n');
  
  // Get memories that don't have embeddings yet
  const memoriesWithoutEmbeddings = db.db.prepare(`
    SELECT m.* FROM memory m
    LEFT JOIN memory_embeddings me ON m.id = me.memory_id AND me.model = ?
    WHERE me.memory_id IS NULL
    ORDER BY m.importance DESC, m.created_at DESC
  `).all(model);
  
  if (memoriesWithoutEmbeddings.length === 0) {
    console.log('✅ All memories already have embeddings!');
    return;
  }
  
  console.log(`Found ${memoriesWithoutEmbeddings.length} memories without embeddings...`);
  
  let successCount = 0;
  let errorCount = 0;
  
  for (const memory of memoriesWithoutEmbeddings) {
    try {
      console.log(`Processing [${memory.id}]: ${memory.content.substring(0, 50)}...`);
      
      const embedding = await db.generateEmbedding(memory.content);
      db.addMemoryEmbedding({
        memoryId: memory.id,
        model,
        embedding
      });
      
      successCount++;
      console.log(`  ✅ Generated embedding`);
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      errorCount++;
      console.log(`  ❌ Error: ${error.message}`);
    }
  }
  
  console.log(`\n🎯 Backfill Complete:`);
  console.log(`  ✅ Success: ${successCount}`);
  console.log(`  ❌ Errors: ${errorCount}`);
  console.log('');
}

// ============================================================
// PIPELINE
// ============================================================

function pipelineBoard(options = {}) {
  const showType = options.type || null; // null = show all, 'feature', 'story', or 'raid'
  
  const featureStages = ['idea', 'spec', 'spec-review', 'building', 'final-review', 'live'];
  const storyStages = ['backlog', 'in-progress', 'qa', 'done', 'blocked'];
  const raidTypes = ['risk', 'issue', 'assumption', 'dependency'];
  
  const stageEmojis = {
    'idea': '💡',
    'spec': '📋',
    'spec-review': '🔍',
    'building': '🔨',
    'final-review': '🎯',
    'live': '🟢',
    'todo': '📋',
    'in-progress': '🔄',
    'qa': '🧪',
    'done': '✅',
    'blocked': '🚫',
    // RAID stages
    'identified': '🆕',
    'mitigating': '🛠️',
    'investigating': '🔍',
    'waiting': '⏳',
    'resolved': '✅',
    'accepted': '👍',
    'validated': '✅',
    'invalidated': '❌'
  };
  
  const raidEmojis = {
    'risk': '🔴',
    'issue': '🟡',
    'assumption': '🟣',
    'dependency': '🔵'
  };
  
  console.log('\n📋 Pipeline Board\n');
  
  // Show Features section
  if (!showType || showType === 'feature') {
    console.log('  ══════════════════════════════════════');
    console.log('  📦 FEATURES');
    console.log('  ══════════════════════════════════════\n');
    
    for (const stage of featureStages) {
      const items = db.db.prepare(`
        SELECT p.* FROM pipeline p
        WHERE (p.type = 'feature' OR p.type IS NULL) 
          AND p.stage = ?
        ORDER BY p.priority ASC, p.created_at DESC
      `).all(stage);
      
      const emoji = stageEmojis[stage] || '📌';
      console.log(`  ${emoji} ${stage.toUpperCase()} (${items.length})`);
      
      if (items.length === 0) {
        console.log(`    (empty)`);
      } else {
        for (const item of items) {
          const stats = db.getStoryStats(item.id);
          const storyInfo = stats.total > 0 ? ` (${stats.done}/${stats.total} stories)` : '';
          const assigned = item.assigned_to ? ` [${item.assigned_to}]` : '';
          console.log(`    #${item.id}${assigned}: ${item.title}${storyInfo}`);
        }
      }
      console.log('');
    }
  }
  
  // Show Stories section
  if (!showType || showType === 'story') {
    console.log('  ══════════════════════════════════════');
    console.log('  📋 STORIES');
    console.log('  ══════════════════════════════════════\n');
    
    for (const stage of storyStages) {
      const items = db.db.prepare(`
        SELECT p.*, parent.title as parent_title FROM pipeline p
        LEFT JOIN pipeline parent ON p.parent_id = parent.id
        WHERE p.type = 'story' AND p.stage = ?
        ORDER BY p.priority ASC, p.created_at DESC
      `).all(stage);
      
      const emoji = stageEmojis[stage] || '📌';
      console.log(`  ${emoji} ${stage.toUpperCase()} (${items.length})`);
      
      if (items.length === 0) {
        console.log(`    (empty)`);
      } else {
        for (const item of items) {
          const parentInfo = item.parent_id ? ` → #${item.parent_id}` : '';
          console.log(`    #${item.id}: ${item.title}${parentInfo}`);
        }
      }
      console.log('');
    }
  }
  
  // Show RAID section
  if (!showType || showType === 'raid') {
    // Get all RAID items that aren't resolved/accepted/validated
    const openRaidItems = db.db.prepare(`
      SELECT p.*, parent.title as parent_title FROM pipeline p
      LEFT JOIN pipeline parent ON p.parent_id = parent.id
      WHERE p.type IN ('risk', 'issue', 'assumption', 'dependency')
        AND p.stage NOT IN ('resolved', 'accepted', 'validated', 'invalidated')
      ORDER BY p.priority ASC, p.type, p.created_at DESC
    `).all();
    
    const closedRaidItems = db.db.prepare(`
      SELECT p.*, parent.title as parent_title FROM pipeline p
      LEFT JOIN pipeline parent ON p.parent_id = parent.id
      WHERE p.type IN ('risk', 'issue', 'assumption', 'dependency')
        AND p.stage IN ('resolved', 'accepted', 'validated', 'invalidated')
      ORDER BY p.updated_at DESC
      LIMIT 5
    `).all();
    
    if (openRaidItems.length > 0 || showType === 'raid') {
      console.log('  ══════════════════════════════════════');
      console.log('  ⚠️ RAID');
      console.log('  ══════════════════════════════════════\n');
      
      if (openRaidItems.length === 0) {
        console.log('  (no open items)\n');
      } else {
        for (const item of openRaidItems) {
          const typeEmoji = raidEmojis[item.type] || '⚠️';
          const stageEmoji = stageEmojis[item.stage] || '📌';
          const parentInfo = item.parent_id ? ` → #${item.parent_id}` : '';
          console.log(`    ${typeEmoji} ${item.type}: ${item.title} (${item.stage})${parentInfo}`);
        }
        console.log('');
      }
      
      if (closedRaidItems.length > 0) {
        console.log('  Recently Closed:');
        for (const item of closedRaidItems) {
          const typeEmoji = raidEmojis[item.type] || '⚠️';
          console.log(`    ${typeEmoji} ${item.title} [${item.stage}]`);
        }
        console.log('');
      }
    }
  }
}

function pipelineList(options = {}) {
  const stage = options.stage || null;
  const parentId = options.parent !== undefined ? (options.parent === 'none' ? null : parseInt(options.parent)) : undefined;
  const itemType = options.type || null;
  let sql = `SELECT * FROM pipeline WHERE 1=1`;
  const params = [];
  
  if (itemType) {
    if (itemType === 'feature') {
      sql += ` AND (type = 'feature' OR type IS NULL)`;
    } else {
      sql += ` AND type = ?`;
      params.push(itemType);
    }
  }
  
  if (stage) {
    sql += ` AND stage = ?`;
    params.push(stage);
  } else {
    // Don't filter by completion stage - show all active items for the type
    if (itemType === 'story') {
      sql += ` AND stage NOT IN ('done')`;
    } else if (itemType === 'feature') {
      sql += ` AND stage NOT IN ('live')`;
    } else {
      sql += ` AND stage NOT IN ('done', 'live')`;
    }
  }
  
  if (parentId !== undefined) {
    if (parentId === null) {
      sql += ` AND parent_id IS NULL`;
    } else {
      sql += ` AND parent_id = ?`;
      params.push(parentId);
    }
  }
  
  sql += ` ORDER BY stage, priority ASC, created_at DESC`;
  
  const items = db.db.prepare(sql).all(...params);
  
  if (items.length === 0) {
    console.log('No pipeline items found.');
    return;
  }
  
  let filterDesc = '';
  if (itemType) filterDesc += ` (type: ${itemType})`;
  if (stage) filterDesc += ` (stage: ${stage})`;
  if (parentId !== undefined) filterDesc += parentId === null ? ' (top-level only)' : ` (parent: #${parentId})`;
  
  console.log(`\n📋 Pipeline Items${filterDesc}\n`);
  for (const item of items) {
    const assigned = item.assigned_to ? ` [${item.assigned_to}]` : '';
    const parentInfo = item.parent_id ? ` ← #${item.parent_id}` : '';
    const typeInfo = item.type === 'story' ? ' [story]' : '';
    const stageEmoji = {
      'idea': '💡',
      'spec': '📋',
      'spec-review': '🔍',
      'building': '🔨',
      'qa': '🧪',
      'final-review': '🎯',
      'review': '👀',
      'blocked': '🚫',
      'done': '✅',
      'live': '🟢',
      'todo': '📋',
      'in-progress': '🔄'
    }[item.stage] || '📌';
    console.log(`  ${stageEmoji} #${item.id}${assigned}${typeInfo}${parentInfo}: ${item.title}`);
    console.log(`      Stage: ${item.stage} | Priority: ${item.priority} | Created: ${formatDate(item.created_at)}`);
  }
  console.log('');
}

function pipelineShow(id, options = {}) {
  const item = db.db.prepare(`SELECT * FROM pipeline WHERE id = ?`).get(id);
  if (!item) {
    console.log(`Pipeline item #${id} not found.`);
    return;
  }
  
  const itemType = item.type || 'feature';
  
  const notes = db.db.prepare(`
    SELECT * FROM pipeline_notes 
    WHERE pipeline_id = ? 
    ORDER BY created_at ASC
  `).all(id);
  
  const tasks = db.db.prepare(`
    SELECT * FROM pipeline_tasks 
    WHERE pipeline_id = ? 
    ORDER BY created_at ASC
  `).all(id);
  
  // Get parent info if exists (including spec for stories)
  let parentInfo = null;
  if (item.parent_id) {
    parentInfo = db.db.prepare(`SELECT id, title, stage, spec_doc FROM pipeline WHERE id = ?`).get(item.parent_id);
  }
  
  // Get children/stories if this is a feature
  const children = db.db.prepare(`
    SELECT * FROM pipeline 
    WHERE parent_id = ? 
    ORDER BY priority ASC, created_at DESC
  `).all(id);
  
  const typeEmoji = itemType === 'story' ? '📋' : '📦';
  console.log(`\n${typeEmoji} ${itemType.charAt(0).toUpperCase() + itemType.slice(1)} #${id}\n`);
  console.log(`  Title: ${item.title}`);
  console.log(`  Type: ${itemType}`);
  console.log(`  Stage: ${item.stage}`);
  console.log(`  Priority: ${item.priority}`);
  if (item.assigned_to) console.log(`  Assigned to: ${item.assigned_to}`);
  if (parentInfo) {
    console.log(`  Parent: #${parentInfo.id} - ${parentInfo.title} (${parentInfo.stage})`);
    if (parentInfo.spec_doc) console.log(`  Parent Spec: ${parentInfo.spec_doc}`);
  }
  if (item.description) console.log(`  Description: ${item.description}`);
  if (item.spec_doc) console.log(`  Spec: ${item.spec_doc}`);
  if (item.acceptance_criteria) console.log(`  Acceptance: ${item.acceptance_criteria}`);
  if (item.health_check) console.log(`  Health Check: ${item.health_check}`);
  console.log(`  Created: ${formatDate(item.created_at)}`);
  console.log(`  Updated: ${formatDate(item.updated_at)}`);
  
  // For features, show story rollup
  if (itemType === 'feature') {
    const stories = children.filter(c => c.type === 'story');
    if (stories.length > 0 || options.children) {
      const stats = db.getStoryStats(id);
      const pct = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;
      
      console.log(`\n  📊 Story Progress: ${stats.done}/${stats.total} done (${pct}%)`);
      console.log(`\n  📋 Stories:`);
      
      if (stories.length === 0) {
        console.log(`    No stories yet.`);
      } else {
        for (const story of stories) {
          const stageEmoji = {
            'todo': '📋',
            'in-progress': '🔄',
            'qa': '🧪',
            'done': '✅',
            'blocked': '🚫'
          }[story.stage] || '📌';
          const assigned = story.assigned_to ? ` [${story.assigned_to}]` : '';
          console.log(`    ${stageEmoji} #${story.id}${assigned}: ${story.title} [${story.stage}]`);
        }
      }
    }
    
    // Show non-story children separately if any
    const otherChildren = children.filter(c => c.type !== 'story');
    if (otherChildren.length > 0) {
      console.log(`\n  👶 Other Child Items (${otherChildren.length}):`);
      for (const child of otherChildren) {
        const stageEmoji = {
          'idea': '💡',
          'spec': '📋',
          'spec-review': '🔍',
          'building': '🔨',
          'qa': '🧪',
          'done': '✅',
          'live': '🟢',
          'blocked': '🚫'
        }[child.stage] || '📌';
        console.log(`    ${stageEmoji} #${child.id}: ${child.title} (${child.stage})`);
      }
    }
  } else {
    // For stories or other types, show children normally if any
    if (options.children || children.length > 0) {
      console.log(`\n  👶 Child Items (${children.length}):`);
      if (children.length === 0) {
        console.log(`    No child items.`);
      } else {
        for (const child of children) {
          const stageEmoji = {
            'idea': '💡',
            'spec': '📋',
            'spec-review': '🔍',
            'building': '🔨',
            'qa': '🧪',
            'done': '✅',
            'live': '🟢',
            'blocked': '🚫',
            'todo': '📋',
            'in-progress': '🔄'
          }[child.stage] || '📌';
          console.log(`    ${stageEmoji} #${child.id}: ${child.title} (${child.stage})`);
        }
      }
    }
  }
  
  console.log(`\n  📝 Notes:`);
  if (!item.notes) {
    console.log(`    No notes yet.`);
  } else {
    // Notes are stored as lines: "2026-02-05 08:21 [source] content"
    const noteLines = item.notes.split('\n').filter(l => l.trim());
    for (const line of noteLines) {
      console.log(`    ${line}`);
    }
  }
  
  console.log(`\n  ✅ Tasks (${tasks.length}):`);
  if (tasks.length === 0) {
    console.log(`    No tasks yet.`);
  } else {
    for (const task of tasks) {
      const statusEmoji = {
        'todo': '⬜',
        'doing': '🔄',
        'done': '✅',
        'blocked': '🚫'
      }[task.status] || '❓';
      console.log(`    ${statusEmoji} ${task.title}`);
      if (task.description) console.log(`        ${task.description}`);
      if (task.assigned_to) console.log(`        Assigned: ${task.assigned_to}`);
      if (task.completed_at) console.log(`        Completed: ${formatDate(task.completed_at)}`);
    }
  }
  console.log('');
}

function pipelineMove(id, stage, options = {}) {
  const item = db.db.prepare(`SELECT * FROM pipeline WHERE id = ?`).get(id);
  if (!item) {
    console.log(`Pipeline item #${id} not found.`);
    return;
  }
  
  const itemType = item.type || 'feature';
  const validStages = db.PIPELINE_STAGES[itemType];
  
  if (!validStages || !validStages.includes(stage)) {
    console.log(`❌ Invalid stage '${stage}' for ${itemType}.`);
    console.log(`   Valid stages for ${itemType}: ${validStages ? validStages.join(', ') : 'unknown'}`);
    return;
  }
  
  const updates = { stage };
  // Set started_at for building (features) or in-progress (stories)
  if ((stage === 'building' || stage === 'in-progress') && !item.started_at) {
    updates.started_at = new Date().toISOString();
  }
  // Set completed_at for done/live
  if ((stage === 'done' || stage === 'live') && !item.completed_at) {
    updates.completed_at = new Date().toISOString();
  }
  
  try {
    db.updatePipeline(id, updates, options.source || 'main');
    console.log(`✅ Moved ${itemType} #${id} to stage: ${stage}`);
  } catch (err) {
    console.log(`❌ Failed to move: ${err.message}`);
    return;
  }
  
  // Add note if provided
  if (options.note) {
    pipelineNote(id, options.note, { source: options.source || 'main' });
  }
}

function pipelineNote(id, content, options = {}) {
  const item = db.db.prepare(`SELECT * FROM pipeline WHERE id = ?`).get(id);
  if (!item) {
    console.log(`Pipeline item #${id} not found.`);
    return;
  }
  
  const source = options.source || 'main';
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 16);
  const newNote = `${timestamp} [${source}] ${content}`;
  
  // Prepend to existing notes (latest first)
  const existingNotes = item.notes || '';
  const updatedNotes = existingNotes ? `${newNote}\n${existingNotes}` : newNote;
  
  // Update the notes column
  db.db.prepare(`UPDATE pipeline SET notes = ?, updated_at = datetime('now') WHERE id = ?`).run(updatedNotes, id);
  
  // Log to activity
  activity.log('pipeline_note', content, 'pipeline', { source, relatedId: `pipeline:${id}` });
  
  console.log(`✅ Added note to pipeline #${id}: ${content}`);
}

function pipelineAssign(id, agent) {
  const item = db.db.prepare(`SELECT * FROM pipeline WHERE id = ?`).get(id);
  if (!item) {
    console.log(`Pipeline item #${id} not found.`);
    return;
  }
  
  db.updatePipeline(id, { assigned_to: agent }, 'main');
  console.log(`✅ Assigned pipeline #${id} to ${agent}`);
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

TODOS
  todos projects                       List all projects
  todos project-add "Name"             Create a project
  todos assign <task_id> <project_id>  Assign task to project
  todos list [--status todo|done|all] [--project <id|name>]  List tasks
  todos prioritize                     Smart prioritized view
  todos add "Title" [--priority 1-4]   Add task
  todos done <id>                      Complete task
  todos update <id> --status <status>  Update task

COSTS
  costs today                            Today's spending
  costs 24h                              Last 24 hours
  costs daily [--days 7]                 Daily breakdown
  costs week                             By model (7 days)
  costs month                            By model (30 days)
  costs all                              All-time total
  costs alert-status                     Cost alert status and history
  costs by-source [--days 7]             Costs grouped by source
  costs daily-by-source [--days 7]       Daily costs broken down by source

ERRORS
  errors                                 Show unresolved errors
  errors resolve <id>                    Mark resolved

ACTIVITY
  activity [--limit 20] [--category <cat>] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--action <act>] [--search <text>] [--source <main|subagent|cron|heartbeat>] [--related <type:id>]
                                         Filtered activity log
  activity add <cat> "desc" [--source <type>] [--related <type:id>]
                                         Add activity with source tracking
  activity summary                       Daily summary with statistics
  activity stats [--period day|week|month] Activity statistics

HEARTBEAT COSTS
  heartbeat-costs [--since 7]           Show heartbeat token usage and costs

HEALTH
  health                                 Integration status

PIPELINE
  pipeline board [--type feature|story]  Kanban view (features + stories)
  pipeline list [--type feature|story] [--stage <stage>] [--parent <id>]
                                         List pipeline items with filters
  pipeline show <id>                     Show full item with notes and story rollup
  pipeline create "Title" [--type feature|story] [--parent <id>] [--priority 1-4]
                                         Create new item (stories link to features)
  pipeline move <id> <stage> [--note "reason"] [--source main|subagent]
                                         Move item to new stage, optionally add note
  pipeline note <id> "content" [--type progress|blocker|decision]
                                         Add note to pipeline item
  pipeline assign <id> <agent-session-key>
                                         Assign item to an agent

  Item Types:
    feature — Product features (default)
      Stages: idea → spec → spec-review → building → live
    story — Implementation tasks linked to features
      Stages: backlog → in-progress → qa → done (+ blocked)

MEMORY
  memory add "content" --category fact   Add memory
  memory search "query"                  Search memory (keyword-based)
  memory semantic-search "query"         Search by meaning using embeddings
  memory backfill-embeddings             Generate embeddings for existing memories
  memory list <category>                 List by category

OBSERVATIONS (Self-Observation System)
  observations list [--week YYYY-MM-DD] [--category <cat>] [--pending] [--limit 20]
                                         List observations with filters
  observations add "text" --category <cat> [--week YYYY-MM-DD] [--confidence 0.8] [--evidence '["p1","p2"]']
                                         Add a new observation
  observations feedback <id> <useful|not_useful> [--note "reason"]
                                         Provide feedback on observation
  observations stats                     Show feedback statistics

  Categories: task_preference, communication, decision, error, other

FRICTION
  friction add "description" [--category <cat>]  Log friction (auto-increments if similar exists)
  friction list [--all] [--category <cat>]       List unresolved friction
  friction resolve <id> [--by <feature-id>]      Mark resolved, optionally link to fix
  friction patterns                              Show patterns and repeat offenders

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

// ============================================================
// FRICTION
// ============================================================

// ============================================================
// OBSERVATIONS
// ============================================================

function observationsList(options = {}) {
  const observations = db.getObservations({
    weekStart: options.week,
    category: options.category,
    feedback: options.pending ? null : undefined,
    limit: options.limit || 20
  });
  
  if (observations.length === 0) {
    console.log('\n🔭 No observations found.\n');
    return;
  }
  
  console.log('\n🔭 Self-Observations\n');
  
  for (const obs of observations) {
    const feedbackEmoji = obs.feedback === 'useful' ? '👍' : 
                          obs.feedback === 'not_useful' ? '👎' : '⏳';
    const confidence = (obs.confidence * 100).toFixed(0);
    
    console.log(`  ${feedbackEmoji} [${obs.id}] ${obs.category} (${confidence}% confidence)`);
    console.log(`      ${obs.observation}`);
    console.log(`      Week: ${obs.week_start} | Created: ${formatDate(obs.created_at)}`);
    if (obs.feedback_note) {
      console.log(`      Note: ${obs.feedback_note}`);
    }
    if (obs.evidence && obs.evidence.length > 0) {
      console.log(`      Evidence: ${obs.evidence.length} data points`);
    }
    console.log('');
  }
}

function observationsAdd(observation, options = {}) {
  if (!observation) {
    console.log('Usage: observations add "observation text" --category <cat> [--week YYYY-MM-DD] [--confidence 0.8] [--evidence \'["point1","point2"]\']');
    console.log('Categories: task_preference, communication, decision, error, other');
    return;
  }
  
  const category = options.category || 'other';
  const validCategories = ['task_preference', 'communication', 'decision', 'error', 'other'];
  if (!validCategories.includes(category)) {
    console.log(`Invalid category. Must be one of: ${validCategories.join(', ')}`);
    return;
  }
  
  // Default to current week's Monday
  let weekStart = options.week;
  if (!weekStart) {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Sunday
    const monday = new Date(now.setDate(diff));
    weekStart = monday.toISOString().split('T')[0];
  }
  
  let evidence = null;
  if (options.evidence) {
    try {
      evidence = JSON.parse(options.evidence);
    } catch (e) {
      console.log('Invalid JSON for --evidence. Use: \'["point1", "point2"]\'');
      return;
    }
  }
  
  const confidence = options.confidence ? parseFloat(options.confidence) : 0.5;
  
  const id = db.addObservation({
    weekStart,
    category,
    observation,
    evidence,
    confidence
  });
  
  console.log(`\n🔭 Added observation #${id}`);
  console.log(`   Category: ${category}`);
  console.log(`   Week: ${weekStart}`);
  console.log(`   Confidence: ${(confidence * 100).toFixed(0)}%\n`);
}

function observationsFeedback(id, feedback, note = null) {
  if (!id || !feedback) {
    console.log('Usage: observations feedback <id> <useful|not_useful> [--note "reason"]');
    return;
  }
  
  const validFeedback = ['useful', 'not_useful'];
  if (!validFeedback.includes(feedback)) {
    console.log(`Invalid feedback. Must be one of: ${validFeedback.join(', ')}`);
    return;
  }
  
  const obs = db.getObservation(parseInt(id));
  if (!obs) {
    console.log(`Observation #${id} not found.`);
    return;
  }
  
  db.updateObservationFeedback(parseInt(id), feedback, note);
  
  const emoji = feedback === 'useful' ? '👍' : '👎';
  console.log(`\n${emoji} Marked observation #${id} as ${feedback}`);
  if (note) {
    console.log(`   Note: ${note}`);
  }
  console.log('');
}

function observationsStats() {
  const stats = db.getObservationStats();
  
  console.log('\n📊 Observation Statistics\n');
  console.log(`  Total observations: ${stats.total}`);
  console.log(`  👍 Useful: ${stats.useful}`);
  console.log(`  👎 Not useful: ${stats.notUseful}`);
  console.log(`  ⏳ Pending feedback: ${stats.pending}`);
  
  if (stats.total > 0) {
    const usefulRate = ((stats.useful / (stats.useful + stats.notUseful)) * 100).toFixed(0);
    if (stats.useful + stats.notUseful > 0) {
      console.log(`  Usefulness rate: ${usefulRate}%`);
    }
  }
  
  if (stats.byCategory.length > 0) {
    console.log('\n  By Category:');
    for (const cat of stats.byCategory) {
      const catUseful = cat.useful || 0;
      const catNotUseful = cat.not_useful || 0;
      const catTotal = cat.count;
      console.log(`    ${cat.category}: ${catTotal} total (${catUseful} useful, ${catNotUseful} not useful)`);
    }
  }
  console.log('');
}

function frictionAdd(description, options = {}) {
  if (!description) {
    console.log('Usage: friction add "description" [--category <cat>]');
    return;
  }
  
  const category = options.category || 'general';
  
  // Check if similar friction exists (fuzzy match)
  const existing = db.db.prepare(`
    SELECT * FROM friction 
    WHERE resolved = 0 AND description LIKE ?
    ORDER BY created_at DESC LIMIT 1
  `).get('%' + description.substring(0, 30) + '%');
  
  if (existing) {
    // Increment occurrences
    db.db.prepare(`
      UPDATE friction 
      SET occurrences = occurrences + 1, last_occurred = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(existing.id);
    console.log(`🔄 Friction #${existing.id} occurred again (x${existing.occurrences + 1}): ${existing.description.substring(0, 50)}...`);
  } else {
    const result = db.db.prepare(`
      INSERT INTO friction (description, category, source)
      VALUES (?, ?, 'manual')
    `).run(description, category);
    console.log(`✅ Logged friction #${result.lastInsertRowid}: ${description.substring(0, 50)}...`);
  }
}

function frictionList(options = {}) {
  const showResolved = options.all || false;
  const category = options.category;
  
  let query = 'SELECT * FROM friction';
  const conditions = [];
  const params = [];
  
  if (!showResolved) {
    conditions.push('resolved = 0');
  }
  if (category) {
    conditions.push('category = ?');
    params.push(category);
  }
  
  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' ORDER BY occurrences DESC, last_occurred DESC';
  
  const items = db.db.prepare(query).all(...params);
  
  if (items.length === 0) {
    console.log('No friction logged.' + (showResolved ? '' : ' Use --all to see resolved.'));
    return;
  }
  
  console.log('\n🔥 Friction Log\n');
  for (const item of items) {
    const status = item.resolved ? '✅' : '⬜';
    const count = item.occurrences > 1 ? ` (x${item.occurrences})` : '';
    const resolved = item.resolved_by ? ` → fixed by #${item.resolved_by}` : '';
    console.log(`  ${status} [${item.id}] ${item.description.substring(0, 60)}${count}${resolved}`);
    console.log(`      Category: ${item.category} | Last: ${formatDate(item.last_occurred)}`);
  }
  console.log('');
}

function frictionResolve(id, resolvedBy) {
  if (!id) {
    console.log('Usage: friction resolve <id> [--by <feature/story id>]');
    return;
  }
  
  db.db.prepare(`
    UPDATE friction 
    SET resolved = 1, resolved_at = CURRENT_TIMESTAMP, resolved_by = ?
    WHERE id = ?
  `).run(resolvedBy || null, id);
  
  console.log(`✅ Friction #${id} resolved` + (resolvedBy ? ` by #${resolvedBy}` : ''));
}

function frictionPatterns() {
  const patterns = db.db.prepare(`
    SELECT category, COUNT(*) as count, SUM(occurrences) as total_occurrences
    FROM friction
    WHERE resolved = 0
    GROUP BY category
    ORDER BY total_occurrences DESC
  `).all();
  
  const repeat = db.db.prepare(`
    SELECT * FROM friction
    WHERE resolved = 0 AND occurrences > 1
    ORDER BY occurrences DESC
    LIMIT 10
  `).all();
  
  console.log('\n📊 Friction Patterns\n');
  
  if (patterns.length > 0) {
    console.log('  By Category:');
    for (const p of patterns) {
      console.log(`    ${p.category}: ${p.count} items, ${p.total_occurrences} total occurrences`);
    }
  }
  
  if (repeat.length > 0) {
    console.log('\n  🔄 Repeat Offenders:');
    for (const r of repeat) {
      console.log(`    [${r.id}] x${r.occurrences}: ${r.description.substring(0, 50)}...`);
    }
  }
  
  if (patterns.length === 0 && repeat.length === 0) {
    console.log('  No patterns detected yet.');
  }
  console.log('');
}

try {
  const flags = parseFlags(args);
  
  switch (command) {
    case 'todos':
      switch (subcommand) {
        case 'projects':
          projectsList();
          break;
        case 'project-add':
          projectAdd(args[2]);
          break;
        case 'assign':
          taskAssignProject(parseInt(args[2]), args[3]);
          break;
        case 'list':
          tasksList({ 
            status: flags.status === 'all' ? null : flags.status,
            project: flags.project 
          });
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
        case 'by-source':
          costsBySource(flags.days ? parseInt(flags.days) : 7);
          break;
        case 'daily-by-source':
          costsDailyBySource(flags.days ? parseInt(flags.days) : 7);
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
      if (subcommand === 'add') {
        // activity add <category> "description" [options]
        const category = args[2];
        const description = args[3];
        if (!category || !description) {
          console.log('\n📝 Activity Add\n');
          console.log('  Usage: db.js activity add <category> "description" [options]');
          console.log('\n  Categories: build, spawn, research, session, work, infrastructure, testing, heartbeat, api');
          console.log('\n  Options:');
          console.log('    --action <name>      Custom action name (default: <category>_logged)');
          console.log('    --source <type>      Source: main, subagent, cron, heartbeat');
          console.log('    --related <type:id>  Related entity (e.g., pipeline:8, task:15, content:3)');
          console.log('    --meta \'{"k":"v"}\'   Arbitrary JSON metadata');
          console.log('    --input "text"       Input/prompt summary');
          console.log('    --output "text"      Output/response summary');
          console.log('    --tokens "in/out"    Token counts (e.g., "5000/1200")');
          console.log('    --cost "$0.05"       Cost of the operation');
          console.log('    --model "name"       Model used');
          console.log('\n  Examples:');
          console.log('    db.js activity add spawn "Spawned vision-extractor builder"');
          console.log('    db.js activity add build "Test" --source subagent --related pipeline:8');
          console.log('    db.js activity add api "Vision extraction" --input "specs.pdf" --output "22 items" --tokens "50000/2000" --cost "$0.08" --model "gemini-2.5-pro"');
          break;
        }
        const action = flags.action || `${category}_logged`;
        
        // Build metadata from flags
        let metadata = {};
        if (flags.meta) {
          try {
            metadata = JSON.parse(flags.meta);
          } catch (e) {
            console.error('Invalid JSON in --meta flag');
            break;
          }
        }
        if (flags.input) metadata.input = flags.input;
        if (flags.output) metadata.output = flags.output;
        if (flags.tokens) {
          const [tokensIn, tokensOut] = flags.tokens.split('/');
          metadata.tokens = { in: parseInt(tokensIn) || 0, out: parseInt(tokensOut) || 0 };
        }
        if (flags.cost) metadata.cost = flags.cost;
        if (flags.model) metadata.model = flags.model;
        
        // Only include metadata if there's something in it
        const finalMeta = Object.keys(metadata).length > 0 ? metadata : null;
        
        // Extract source and related from flags
        const source = flags.source || null;
        const relatedId = flags.related || null;
        
        activity.logFull({ action, category, description, metadata: finalMeta, source, relatedId });
        console.log(`\n📝 Logged [${category}] ${description}`);
        const infoParts = [];
        if (source) infoParts.push(`source: ${source}`);
        if (relatedId) infoParts.push(`related: ${relatedId}`);
        if (finalMeta) {
          if (finalMeta.model) infoParts.push(`model: ${finalMeta.model}`);
          if (finalMeta.tokens) infoParts.push(`tokens: ${finalMeta.tokens.in}→${finalMeta.tokens.out}`);
          if (finalMeta.cost) infoParts.push(`cost: ${finalMeta.cost}`);
          if (finalMeta.input) infoParts.push(`in: "${finalMeta.input.substring(0, 50)}${finalMeta.input.length > 50 ? '...' : ''}"`);
          if (finalMeta.output) infoParts.push(`out: "${finalMeta.output.substring(0, 50)}${finalMeta.output.length > 50 ? '...' : ''}"`);
        }
        if (infoParts.length) console.log(`   ${infoParts.join(' | ')}`);
      } else if (subcommand === 'summary') {
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
          search: flags.search || null,
          source: flags.source || null,
          related: flags.related || null
        };
        activityShow(options);
      }
      break;
      
    case 'heartbeat-costs':
      heartbeatCosts({ since: flags.since ? parseInt(flags.since) : 7 });
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
        case 'semantic-search':
          (async () => {
            await memorySemanticSearch(args[2], {
              limit: flags.limit ? parseInt(flags.limit) : 10,
              threshold: flags.threshold ? parseFloat(flags.threshold) : 0.4
            });
          })().catch(console.error);
          break;
        case 'backfill-embeddings':
          (async () => {
            await memoryBackfillEmbeddings();
          })().catch(console.error);
          break;
        case 'list':
          memoryList(args[2]);
          break;
        default:
          showHelp();
      }
      break;
    
    case 'pipeline':
      switch (subcommand) {
        case 'board':
          pipelineBoard({ type: flags.type || null });
          break;
        case 'list':
          pipelineList({ 
            stage: flags.stage || null,
            parent: flags.parent,
            type: flags.type || null
          });
          break;
        case 'show':
          pipelineShow(parseInt(args[2]), {
            children: flags.children === true
          });
          break;
        case 'create':
          {
            const title = args[2];
            if (!title) {
              console.log('Usage: pipeline create "Title" [--type feature|story|risk|issue|assumption|dependency] [--parent <id>] [--priority 1-4] [--ac \'["criteria1","criteria2"]\']');
              break;
            }
            const itemType = flags.type || 'feature';
            const validTypes = ['feature', 'story', 'risk', 'issue', 'assumption', 'dependency'];
            if (!validTypes.includes(itemType)) {
              console.log('Invalid type. Must be one of: ' + validTypes.join(', '));
              break;
            }
            
            // Parse acceptance criteria if provided
            let acceptanceCriteria = null;
            if (flags.ac) {
              try {
                acceptanceCriteria = JSON.parse(flags.ac);
                if (!Array.isArray(acceptanceCriteria)) {
                  console.log('--ac must be a JSON array: \'["criteria1", "criteria2"]\'');
                  break;
                }
              } catch (e) {
                console.log('Invalid JSON for --ac. Use: \'["criteria1", "criteria2"]\'');
                break;
              }
            }
            
            const newId = db.createPipeline({
              title,
              type: itemType,
              parentId: flags.parent ? parseInt(flags.parent) : null,
              priority: flags.priority ? parseInt(flags.priority) : 2,
              acceptanceCriteria
            });
            const defaultStage = db.getDefaultStage(itemType);
            console.log(`✅ Created ${itemType} #${newId}: ${title}`);
            console.log(`   Stage: ${defaultStage}`);
            if (flags.parent) {
              console.log(`   Linked to parent #${flags.parent}`);
            }
            if (acceptanceCriteria) {
              console.log(`   Acceptance criteria: ${acceptanceCriteria.length} items`);
            }
          }
          break;
        case 'move':
          pipelineMove(parseInt(args[2]), args[3], { 
            note: flags.note || null,
            source: flags.source || 'main'
          });
          break;
        case 'note':
          pipelineNote(parseInt(args[2]), args[3], { 
            type: flags.type || 'info',
            source: flags.source || 'main'
          });
          break;
        case 'assign':
          pipelineAssign(parseInt(args[2]), args[3]);
          break;
        case 'update':
          {
            const id = parseInt(args[2]);
            if (!id) {
              console.log('Usage: pipeline update <id> [--spec <path>] [--desc "description"] [--priority 1-4]');
              break;
            }
            const updates = {};
            if (flags.spec) updates.spec_doc = flags.spec;
            if (flags.desc) updates.description = flags.desc;
            if (flags.priority) updates.priority = parseInt(flags.priority);
            
            if (Object.keys(updates).length === 0) {
              console.log('No updates provided. Use --spec, --desc, or --priority');
              break;
            }
            
            db.updatePipeline(id, updates);
            console.log(`✅ Updated pipeline #${id}`);
            if (flags.spec) console.log(`   Spec: ${flags.spec}`);
            if (flags.desc) console.log(`   Description updated`);
            if (flags.priority) console.log(`   Priority: ${flags.priority}`);
          }
          break;
        default:
          pipelineBoard();
      }
      break;
    
    case 'observations':
      switch (subcommand) {
        case 'list':
          observationsList({
            week: flags.week,
            category: flags.category,
            pending: flags.pending === true,
            limit: flags.limit ? parseInt(flags.limit) : 20
          });
          break;
        case 'add':
          observationsAdd(args[2], {
            category: flags.category,
            week: flags.week,
            confidence: flags.confidence,
            evidence: flags.evidence
          });
          break;
        case 'feedback':
          observationsFeedback(args[2], args[3], flags.note);
          break;
        case 'stats':
          observationsStats();
          break;
        default:
          observationsList();
      }
      break;
      
    case 'friction':
      switch (subcommand) {
        case 'add':
          frictionAdd(args[2], { category: flags.category });
          break;
        case 'list':
          frictionList({ all: flags.all, category: flags.category });
          break;
        case 'resolve':
          frictionResolve(parseInt(args[2]), flags.by);
          break;
        case 'patterns':
          frictionPatterns();
          break;
        default:
          frictionList();
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

