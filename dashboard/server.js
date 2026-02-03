#!/usr/bin/env node
/**
 * Mission Control Dashboard - Express Server
 * Serves API endpoints for journals, content, insights, and stats
 */

const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// --- Middleware ---

// Enable CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// --- Helper Functions ---

async function readJsonFile(filePath) {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`File not found: ${filePath}`, { cause: 404 });
    }
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON: ${filePath}`, { cause: 500 });
    }
    throw error;
  }
}

// --- API Endpoints ---

// GET /api/journals - list memory files
app.get('/api/journals', async (req, res, next) => {
  const memoryDir = path.join(__dirname, '..', 'memory');
  try {
    const files = await fs.readdir(memoryDir);
    const journals = await Promise.all(
      files
        .filter(f => f.endsWith('.md'))
        .map(async file => {
          const filePath = path.join(memoryDir, file);
          const stats = await fs.stat(filePath);
          const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
          return {
            filename: file,
            date: dateMatch ? dateMatch[1] : null,
            modified: stats.mtime.toISOString()
          };
        })
    );
    res.json(journals.filter(j => j.date).sort((a, b) => b.date.localeCompare(a.date)));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'Memory directory not found' });
    }
    next(error);
  }
});

// GET /api/journals/:date - get journal content
app.get('/api/journals/:date', async (req, res, next) => {
  const { date } = req.params;
  const filePath = path.join(__dirname, '..', 'memory', `${date}.md`);
  try {
    const content = await fs.readFile(filePath, 'utf8');
    res.type('text/markdown').send(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: `Journal for ${date} not found` });
    }
    next(error);
  }
});

// GET /api/content - content calendar
app.get('/api/content', async (req, res, next) => {
  try {
    const data = await readJsonFile(path.join(__dirname, 'data', 'content-calendar.json'));
    res.json(data);
  } catch (error) {
    if (error.cause === 404) return res.status(404).json({ error: error.message });
    next(error);
  }
});

// GET /api/insights - insights data
app.get('/api/insights', async (req, res, next) => {
  try {
    const data = await readJsonFile(path.join(__dirname, 'data', 'insights.json'));
    res.json(data);
  } catch (error) {
    if (error.cause === 404) return res.status(404).json({ error: error.message });
    next(error);
  }
});

// GET /api/x-stats - X posting stats
app.get('/api/x-stats', async (req, res, next) => {
  try {
    const data = await readJsonFile(path.join(__dirname, 'data', 'x-post-stats.json'));
    res.json(data);
  } catch (error) {
    if (error.cause === 404) return res.status(404).json({ error: error.message });
    next(error);
  }
});

// GET /api/reddit-pulse - Reddit pulse history
app.get('/api/reddit-pulse', async (req, res, next) => {
  try {
    const data = await readJsonFile(path.join(__dirname, 'data', 'reddit-pulse-history.json'));
    res.json(data);
  } catch (error) {
    if (error.cause === 404) return res.status(404).json({ error: error.message });
    next(error);
  }
});

// GET /api/memory - MEMORY.md contents
app.get('/api/memory', async (req, res, next) => {
  try {
    const content = await fs.readFile(path.join(__dirname, '..', 'MEMORY.md'), 'utf8');
    res.type('text/markdown').send(content);
  } catch (error) {
    if (error.code === 'ENOENT') return res.status(404).json({ error: 'MEMORY.md not found' });
    next(error);
  }
});

// --- Error Handler ---

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error', details: err.message });
});

// --- Start Server ---

app.listen(PORT, () => {
  console.log(`🎛️  Mission Control running on http://localhost:${PORT}`);
});
