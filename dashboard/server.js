#!/usr/bin/env node
/**
 * Mission Control Dashboard
 * 
 * Simple Express server showing health, costs, and tasks.
 * Run: node dashboard/server.js
 * View: http://localhost:3001
 */

const express = require('express');
const path = require('path');
const db = require('../lib/db');

const app = express();
const PORT = process.env.DASHBOARD_PORT || 3001;

// API Endpoints
app.get('/api/health', (req, res) => {
  try {
    const health = db.getLatestHealth();
    res.json(health);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/costs', (req, res) => {
  try {
    const today = db.getCostsToday();
    const byModel = db.getCostsByModel(7);
    res.json({ today, byModel });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tasks', (req, res) => {
  try {
    const inProgress = db.getTasks({ status: 'in_progress', limit: 1 });
    const done = db.db.prepare(`
      SELECT * FROM tasks WHERE status = 'done' 
      ORDER BY updated_at DESC LIMIT 5
    `).all();
    res.json({ current: inProgress[0] || null, recent: done });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Dashboard HTML
const dashboardHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mission Control</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a2e; 
      color: #eee; 
      padding: 20px;
      min-height: 100vh;
    }
    h1 { margin-bottom: 20px; color: #fff; }
    h2 { margin: 20px 0 10px; color: #aaa; font-size: 14px; text-transform: uppercase; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
    .card { 
      background: #16213e; 
      border-radius: 8px; 
      padding: 20px;
      border: 1px solid #0f3460;
    }
    .health-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
    .health-item { 
      padding: 10px; 
      border-radius: 4px; 
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .health-item.ok { background: #0a3d0a; }
    .health-item.degraded { background: #3d3d0a; }
    .health-item.error { background: #3d0a0a; }
    .dot { width: 10px; height: 10px; border-radius: 50%; }
    .dot.ok { background: #4ade80; }
    .dot.degraded { background: #facc15; }
    .dot.error { background: #f87171; }
    .cost-big { font-size: 32px; font-weight: bold; color: #4ade80; }
    .cost-table { width: 100%; margin-top: 10px; }
    .cost-table td { padding: 4px 0; }
    .cost-table td:last-child { text-align: right; color: #aaa; }
    .task { padding: 8px 0; border-bottom: 1px solid #0f3460; }
    .task:last-child { border-bottom: none; }
    .task-status { display: inline-block; width: 20px; }
    .task-current { background: #1e3a5f; padding: 10px; border-radius: 4px; }
    .no-task { color: #666; font-style: italic; }
    .refresh { color: #666; font-size: 12px; margin-top: 20px; }
  </style>
</head>
<body>
  <h1>🎛️ Mission Control</h1>
  
  <div class="grid">
    <div class="card">
      <h2>System Health</h2>
      <div id="health" class="health-grid">Loading...</div>
    </div>
    
    <div class="card">
      <h2>Costs (Today)</h2>
      <div id="cost-total" class="cost-big">$0.00</div>
      <table id="cost-breakdown" class="cost-table"></table>
    </div>
  </div>
  
  <h2>Current Task</h2>
  <div class="card">
    <div id="current-task" class="task-current">Loading...</div>
  </div>
  
  <h2>Recently Completed</h2>
  <div class="card">
    <div id="recent-tasks">Loading...</div>
  </div>
  
  <div class="refresh">Auto-refreshes every 60 seconds. Last update: <span id="last-update">-</span></div>

  <script>
    async function fetchData() {
      try {
        // Health
        const healthRes = await fetch('/api/health');
        const health = await healthRes.json();
        document.getElementById('health').innerHTML = health.map(h => 
          \`<div class="health-item \${h.status}">
            <span class="dot \${h.status}"></span>
            <span>\${h.integration}</span>
          </div>\`
        ).join('');
        
        // Costs
        const costsRes = await fetch('/api/costs');
        const costs = await costsRes.json();
        document.getElementById('cost-total').textContent = '$' + (costs.today?.total_cost || 0).toFixed(2);
        document.getElementById('cost-breakdown').innerHTML = (costs.byModel || []).slice(0, 5).map(m =>
          \`<tr><td>\${m.model || 'unknown'}</td><td>$\${(m.total_cost || 0).toFixed(4)}</td></tr>\`
        ).join('');
        
        // Tasks
        const tasksRes = await fetch('/api/tasks');
        const tasks = await tasksRes.json();
        
        if (tasks.current) {
          document.getElementById('current-task').innerHTML = 
            \`🔄 <strong>\${tasks.current.title}</strong>\`;
        } else {
          document.getElementById('current-task').innerHTML = 
            \`<span class="no-task">No task in progress</span>\`;
        }
        
        document.getElementById('recent-tasks').innerHTML = tasks.recent.length 
          ? tasks.recent.map(t => 
              \`<div class="task"><span class="task-status">✅</span> \${t.title}</div>\`
            ).join('')
          : '<span class="no-task">No completed tasks</span>';
        
        // Update timestamp
        document.getElementById('last-update').textContent = new Date().toLocaleTimeString();
      } catch (err) {
        console.error('Fetch error:', err);
      }
    }
    
    // Initial fetch
    fetchData();
    
    // Auto-refresh every 60 seconds
    setInterval(fetchData, 60000);
  </script>
</body>
</html>`;

app.get('/', (req, res) => {
  res.send(dashboardHTML);
});

// Start server
app.listen(PORT, () => {
  console.log(`🎛️  Mission Control running at http://localhost:${PORT}`);
});
