#!/usr/bin/env node
/**
 * Mission Control Dashboard v2 Backend
 * 
 * Express server with API endpoints for the React frontend.
 * Reuses the same database and logic from the original dashboard.
 */

const express = require('express');
const path = require('path');
const fs = require('fs');

// Import database from the workspace lib
const db = require('../lib/db');

const app = express();
const PORT = process.env.DASHBOARD_PORT || 3003;

// Serve static files from current directory
app.use(express.static('.'));

// CORS for development
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// API Endpoints - reuse from original dashboard
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

// Additional API endpoints from the original public/index.html
app.get('/api/journals', (req, res) => {
  try {
    // Get list of journal files from memory directory
    const memoryDir = path.join(__dirname, '../memory');
    if (!fs.existsSync(memoryDir)) {
      return res.json([]);
    }
    const files = fs.readdirSync(memoryDir)
      .filter(file => file.match(/^\d{4}-\d{2}-\d{2}\.md$/))
      .map(file => ({ date: file.replace('.md', '') }))
      .sort((a, b) => b.date.localeCompare(a.date));
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/journals/:date', (req, res) => {
  try {
    const { date } = req.params;
    const journalPath = path.join(__dirname, '../memory', `${date}.md`);
    if (!fs.existsSync(journalPath)) {
      return res.status(404).text('Journal not found');
    }
    const content = fs.readFileSync(journalPath, 'utf8');
    res.type('text/plain').send(content);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/activity', (req, res) => {
  try {
    const activities = db.getActivity({ limit: 50 });
    res.json(activities);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Basic content and insights endpoints (placeholders)
app.get('/api/content', (req, res) => {
  res.json({ items: [] });
});

app.get('/api/insights', (req, res) => {
  res.json({ items: [] });
});

app.get('/api/x-stats', (req, res) => {
  res.json({ currentMonth: { posts: 0 } });
});

app.get('/api/reddit-pulse', (req, res) => {
  res.json({ pulses: [] });
});

// Default route serves the React app
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`🎛️  Mission Control v2 running at http://localhost:${PORT}`);
});