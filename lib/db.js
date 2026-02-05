/**
 * SQLite Database Layer
 * Unified data store for tasks, contacts, costs, logs, memory
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.OPENCLAW_DB || path.join(process.env.HOME, '.openclaw/data/agent.db');

// Ensure directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Initialize schema
function initSchema() {
  db.exec(`
    -- ============================================================
    -- PRODUCTIVITY TABLES
    -- ============================================================

    CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'active' CHECK(status IN ('active', 'paused', 'completed', 'archived')),
        color TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'todo' CHECK(status IN ('todo', 'in_progress', 'blocked', 'done', 'cancelled')),
        priority INTEGER DEFAULT 2 CHECK(priority BETWEEN 1 AND 4),
        project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        due_date TEXT,
        completed_at TEXT,
        blocked_reason TEXT,
        tags TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        company TEXT,
        role TEXT,
        notes TEXT,
        tags TEXT,
        last_contact TEXT,
        follow_up_date TEXT,
        source TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS content (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL CHECK(platform IN ('linkedin', 'x', 'youtube', 'blog', 'newsletter', 'other')),
        title TEXT,
        content TEXT,
        status TEXT DEFAULT 'idea' CHECK(status IN ('idea', 'draft', 'review', 'scheduled', 'published', 'archived')),
        scheduled_for TEXT,
        published_at TEXT,
        published_url TEXT,
        metrics TEXT,
        tags TEXT,
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    );

    -- ============================================================
    -- MONITORING TABLES
    -- ============================================================

    CREATE TABLE IF NOT EXISTS token_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        source TEXT,
        model TEXT NOT NULL,
        provider TEXT,
        tokens_in INTEGER NOT NULL DEFAULT 0,
        tokens_out INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL,
        task_type TEXT,
        task_detail TEXT,
        latency_ms INTEGER,
        created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS session_costs (
        session_id TEXT PRIMARY KEY,
        source TEXT,
        total_cost REAL,
        input_tokens INTEGER,
        output_tokens INTEGER,
        message_count INTEGER,
        first_timestamp TEXT,
        last_timestamp TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS error_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        level TEXT NOT NULL CHECK(level IN ('error', 'warn', 'info', 'debug')),
        source TEXT NOT NULL,
        message TEXT NOT NULL,
        details TEXT,
        stack TEXT,
        resolved INTEGER DEFAULT 0,
        resolved_at TEXT,
        created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS activity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        category TEXT,
        description TEXT,
        metadata TEXT,
        session_id TEXT,
        created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS health_checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        integration TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('ok', 'degraded', 'error')),
        message TEXT,
        latency_ms INTEGER,
        checked_at TEXT DEFAULT (datetime('now'))
    );

    -- ============================================================
    -- MEMORY TABLE
    -- ============================================================

    CREATE TABLE IF NOT EXISTS memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL CHECK(category IN ('fact', 'preference', 'lesson', 'todo', 'person', 'project', 'other')),
        subject TEXT,
        content TEXT NOT NULL,
        importance INTEGER DEFAULT 5 CHECK(importance BETWEEN 1 AND 10),
        source TEXT,
        expires_at TEXT,
        last_accessed TEXT,
        access_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    );

    -- ============================================================
    -- EMBEDDINGS TABLE
    -- ============================================================

    CREATE TABLE IF NOT EXISTS memory_embeddings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id INTEGER NOT NULL REFERENCES memory(id) ON DELETE CASCADE,
        model TEXT NOT NULL,
        embedding BLOB NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(memory_id, model)
    );

    -- ============================================================
    -- DEV PIPELINE TABLES
    -- ============================================================

    -- Pipeline: Features going through dev stages
    CREATE TABLE IF NOT EXISTS pipeline (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        description TEXT,
        stage TEXT DEFAULT 'idea' CHECK(stage IN ('idea', 'spec', 'ready', 'build', 'review', 'done')),
        
        -- Spec phase
        spec_doc TEXT,
        acceptance_criteria TEXT,
        
        -- Approval gate
        approved_by TEXT,
        approved_at TEXT,
        
        -- Build phase
        branch_name TEXT,
        
        -- Review phase
        review_notes TEXT,
        review_passed INTEGER,
        
        -- Metadata
        priority INTEGER DEFAULT 2 CHECK(priority BETWEEN 1 AND 4),
        assigned_agent TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Pipeline tasks: Atomic work items within a pipeline item
    CREATE TABLE IF NOT EXISTS pipeline_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pipeline_id INTEGER REFERENCES pipeline(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'todo' CHECK(status IN ('todo', 'doing', 'done', 'blocked')),
        assigned_to TEXT,
        output TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        completed_at TEXT
    );

    -- Pipeline notes: Agent handover notes
    CREATE TABLE IF NOT EXISTS pipeline_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pipeline_id INTEGER REFERENCES pipeline(id) ON DELETE CASCADE,
        agent_role TEXT NOT NULL,
        note_type TEXT CHECK(note_type IN ('handover', 'blocker', 'question', 'decision', 'info')),
        content TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
    );

    -- ============================================================
    -- SOCIAL MEDIA POSTS
    -- ============================================================

    CREATE TABLE IF NOT EXISTS social_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL CHECK(platform IN ('x', 'linkedin', 'other')),
        post_id TEXT,
        post_type TEXT DEFAULT 'post' CHECK(post_type IN ('post', 'reply', 'quote', 'thread', 'repost')),
        content TEXT NOT NULL,
        content_hash TEXT,
        url TEXT,
        in_reply_to TEXT,
        metrics TEXT,
        created_at TEXT DEFAULT (datetime('now'))
    );

    -- ============================================================
    -- INDEXES
    -- ============================================================

    CREATE INDEX IF NOT EXISTS idx_social_platform ON social_posts(platform);
    CREATE INDEX IF NOT EXISTS idx_social_hash ON social_posts(content_hash);
    CREATE INDEX IF NOT EXISTS idx_social_created ON social_posts(created_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);
    CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts(name);
    CREATE INDEX IF NOT EXISTS idx_content_platform ON content(platform);
    CREATE INDEX IF NOT EXISTS idx_content_status ON content(status);
    CREATE INDEX IF NOT EXISTS idx_token_date ON token_usage(created_at);
    CREATE INDEX IF NOT EXISTS idx_token_model ON token_usage(model);
    CREATE INDEX IF NOT EXISTS idx_errors_level ON error_logs(level);
    CREATE INDEX IF NOT EXISTS idx_errors_source ON error_logs(source);
    CREATE INDEX IF NOT EXISTS idx_memory_category ON memory(category);
    CREATE INDEX IF NOT EXISTS idx_memory_embeddings_memory ON memory_embeddings(memory_id);
    CREATE INDEX IF NOT EXISTS idx_memory_embeddings_model ON memory_embeddings(model);
    CREATE INDEX IF NOT EXISTS idx_pipeline_stage ON pipeline(stage);
    CREATE INDEX IF NOT EXISTS idx_pipeline_project ON pipeline(project_id);
    CREATE INDEX IF NOT EXISTS idx_pipeline_tasks_pipeline ON pipeline_tasks(pipeline_id);
    CREATE INDEX IF NOT EXISTS idx_pipeline_notes_pipeline ON pipeline_notes(pipeline_id);
  `);
}

// Initialize on load
initSchema();

// ============================================================
// TASK FUNCTIONS
// ============================================================

function addTask({ title, description, status, priority, projectId, dueDate, tags }) {
  const stmt = db.prepare(`
    INSERT INTO tasks (title, description, status, priority, project_id, due_date, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    title,
    description || null,
    status || 'todo',
    priority || 2,
    projectId || null,
    dueDate || null,
    tags ? JSON.stringify(tags) : null
  );
  return result.lastInsertRowid;
}

function getTasks({ status, projectId, limit } = {}) {
  let sql = `SELECT * FROM tasks WHERE 1=1`;
  const params = [];
  
  if (status) {
    sql += ` AND status = ?`;
    params.push(status);
  } else {
    sql += ` AND status NOT IN ('done', 'cancelled')`;
  }
  
  if (projectId) {
    sql += ` AND project_id = ?`;
    params.push(projectId);
  }
  
  sql += ` ORDER BY priority ASC, due_date ASC`;
  
  if (limit) {
    sql += ` LIMIT ?`;
    params.push(limit);
  }
  
  return db.prepare(sql).all(...params);
}

function updateTask(id, updates) {
  const fields = [];
  const params = [];
  
  for (const [key, value] of Object.entries(updates)) {
    const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase(); // camelCase to snake_case
    fields.push(`${dbKey} = ?`);
    params.push(value);
  }
  
  fields.push(`updated_at = datetime('now')`);
  params.push(id);
  
  const sql = `UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`;
  return db.prepare(sql).run(...params);
}

function completeTask(id) {
  return db.prepare(`
    UPDATE tasks SET status = 'done', completed_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).run(id);
}

// ============================================================
// TOKEN USAGE FUNCTIONS
// ============================================================

function logUsage({ sessionId, source, model, provider, tokensIn, tokensOut, costUsd, taskType, taskDetail, latencyMs }) {
  const stmt = db.prepare(`
    INSERT INTO token_usage (session_id, source, model, provider, tokens_in, tokens_out, cost_usd, task_type, task_detail, latency_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(sessionId, source || null, model, provider, tokensIn, tokensOut, costUsd, taskType, taskDetail, latencyMs);
}

function getCostsToday() {
  return db.prepare(`
    SELECT 
      COALESCE(SUM(cost_usd), 0) as total,
      COALESCE(SUM(tokens_in), 0) as tokens_in,
      COALESCE(SUM(tokens_out), 0) as tokens_out,
      COUNT(*) as requests
    FROM token_usage
    WHERE date(created_at) = date('now')
  `).get();
}

function getCostsByModel(days = 7) {
  return db.prepare(`
    SELECT 
      model,
      COALESCE(SUM(cost_usd), 0) as total,
      COALESCE(SUM(tokens_in), 0) as tokens_in,
      COALESCE(SUM(tokens_out), 0) as tokens_out,
      COUNT(*) as requests
    FROM token_usage
    WHERE created_at > datetime('now', '-' || ? || ' days')
    GROUP BY model
    ORDER BY total DESC
  `).all(days);
}

// ============================================================
// ERROR LOG FUNCTIONS
// ============================================================

function logError({ level, source, message, details, stack }) {
  const stmt = db.prepare(`
    INSERT INTO error_logs (level, source, message, details, stack)
    VALUES (?, ?, ?, ?, ?)
  `);
  return stmt.run(level || 'error', source, message, details, stack);
}

function getUnresolvedErrors(limit = 20) {
  return db.prepare(`
    SELECT * FROM error_logs
    WHERE resolved = 0
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
}

function resolveError(id) {
  return db.prepare(`
    UPDATE error_logs SET resolved = 1, resolved_at = datetime('now')
    WHERE id = ?
  `).run(id);
}

// ============================================================
// ACTIVITY FUNCTIONS
// ============================================================

function logActivity({ action, category, description, metadata, sessionId }) {
  const stmt = db.prepare(`
    INSERT INTO activity (action, category, description, metadata, session_id)
    VALUES (?, ?, ?, ?, ?)
  `);
  return stmt.run(action, category, description, metadata ? JSON.stringify(metadata) : null, sessionId);
}

function getRecentActivity(limit = 20) {
  return db.prepare(`
    SELECT * FROM activity
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
}

// ============================================================
// HEALTH CHECK FUNCTIONS
// ============================================================

function logHealthCheck({ integration, status, message, latencyMs }) {
  const stmt = db.prepare(`
    INSERT INTO health_checks (integration, status, message, latency_ms)
    VALUES (?, ?, ?, ?)
  `);
  return stmt.run(integration, status, message, latencyMs);
}

function getLatestHealth() {
  return db.prepare(`
    SELECT h1.* FROM health_checks h1
    INNER JOIN (
      SELECT integration, MAX(checked_at) as latest
      FROM health_checks
      GROUP BY integration
    ) h2 ON h1.integration = h2.integration AND h1.checked_at = h2.latest
  `).all();
}

// ============================================================
// MEMORY FUNCTIONS
// ============================================================

function addMemory({ category, subject, content, importance, source }) {
  const stmt = db.prepare(`
    INSERT INTO memory (category, subject, content, importance, source)
    VALUES (?, ?, ?, ?, ?)
  `);
  const result = stmt.run(category, subject, content, importance || 5, source);
  return result.lastInsertRowid;
}

function searchMemory(query, limit = 10) {
  return db.prepare(`
    SELECT * FROM memory
    WHERE content LIKE ? OR subject LIKE ?
    ORDER BY importance DESC, created_at DESC
    LIMIT ?
  `).all(`%${query}%`, `%${query}%`, limit);
}

function getMemoryByCategory(category, limit = 20) {
  return db.prepare(`
    SELECT * FROM memory
    WHERE category = ?
    ORDER BY importance DESC, created_at DESC
    LIMIT ?
  `).all(category, limit);
}

// ============================================================
// EMBEDDING FUNCTIONS
// ============================================================

function addMemoryEmbedding({ memoryId, model, embedding }) {
  // embedding should be a Float32Array or array of numbers
  // Convert to BLOB for storage
  const buffer = embedding instanceof Float32Array ? embedding.buffer : 
                 Array.isArray(embedding) ? new Float32Array(embedding).buffer : 
                 embedding;
  
  const stmt = db.prepare(`
    INSERT INTO memory_embeddings (memory_id, model, embedding)
    VALUES (?, ?, ?)
    ON CONFLICT(memory_id, model) DO UPDATE SET
      embedding = excluded.embedding,
      updated_at = datetime('now')
  `);
  return stmt.run(memoryId, model, Buffer.from(buffer));
}

function getMemoryEmbedding(memoryId, model) {
  const row = db.prepare(`
    SELECT embedding FROM memory_embeddings 
    WHERE memory_id = ? AND model = ?
  `).get(memoryId, model);
  
  if (!row) return null;
  return new Float32Array(row.embedding.buffer);
}

function searchMemoryByEmbedding({ model, embedding, limit = 10, threshold = 0.7 }) {
  // Get all embeddings for the specified model
  const allEmbeddings = db.prepare(`
    SELECT me.memory_id, me.embedding, m.* 
    FROM memory_embeddings me
    JOIN memory m ON me.memory_id = m.id
    WHERE me.model = ?
  `).all(model);
  
  if (allEmbeddings.length === 0) return [];
  
  // Convert query embedding to Float32Array if needed
  const queryEmbedding = embedding instanceof Float32Array ? embedding :
                        Array.isArray(embedding) ? new Float32Array(embedding) :
                        embedding;
  
  // Calculate cosine similarity for each embedding
  const results = allEmbeddings.map(row => {
    const storedEmbedding = new Float32Array(row.embedding.buffer);
    const similarity = cosineSimilarity(queryEmbedding, storedEmbedding);
    return {
      ...row,
      similarity,
      embedding: undefined // Remove the blob from the result
    };
  });
  
  // Filter by threshold and sort by similarity
  return results
    .filter(r => r.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

function cosineSimilarity(a, b) {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length');
  }
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);
  
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (normA * normB);
}

function getMemoriesWithEmbeddings(model, limit = 100) {
  return db.prepare(`
    SELECT m.*, me.model as embedding_model, me.created_at as embedding_created
    FROM memory m
    LEFT JOIN memory_embeddings me ON m.id = me.memory_id AND me.model = ?
    ORDER BY m.importance DESC, m.created_at DESC
    LIMIT ?
  `).all(model, limit);
}

function updateMemoryWithEmbedding(memoryId, updates, embeddingData = null) {
  // First, update the memory record
  const allowedFields = ['category', 'subject', 'content', 'importance', 'source', 'expires_at'];
  const setClauses = [];
  const values = [];
  
  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      setClauses.push(`${key} = ?`);
      values.push(value);
    }
  }
  
  if (setClauses.length > 0) {
    setClauses.push(`updated_at = datetime('now')`);
    values.push(memoryId);
    
    const stmt = db.prepare(`UPDATE memory SET ${setClauses.join(', ')} WHERE id = ?`);
    stmt.run(...values);
  }
  
  // If embedding data is provided, update the embedding
  if (embeddingData) {
    const { model, embedding } = embeddingData;
    addMemoryEmbedding({ memoryId, model, embedding });
  }
  
  return true;
}

// ============================================================
// PIPELINE FUNCTIONS
// ============================================================

function createPipeline({ projectId, title, description, priority }) {
  const stmt = db.prepare(`
    INSERT INTO pipeline (project_id, title, description, priority)
    VALUES (?, ?, ?, ?)
  `);
  return stmt.run(projectId || null, title, description || null, priority || 2).lastInsertRowid;
}

function getPipeline(id) {
  return db.prepare(`SELECT * FROM pipeline WHERE id = ?`).get(id);
}

function listPipeline({ projectId, stage, limit } = {}) {
  let sql = `SELECT * FROM pipeline WHERE 1=1`;
  const params = [];
  
  if (projectId) {
    sql += ` AND project_id = ?`;
    params.push(projectId);
  }
  
  if (stage) {
    sql += ` AND stage = ?`;
    params.push(stage);
  } else {
    sql += ` AND stage != 'done'`;
  }
  
  sql += ` ORDER BY priority ASC, created_at DESC`;
  
  if (limit) {
    sql += ` LIMIT ?`;
    params.push(limit);
  }
  
  return db.prepare(sql).all(...params);
}

function updatePipeline(id, updates) {
  const allowedFields = ['title', 'description', 'stage', 'spec_doc', 'acceptance_criteria', 
    'approved_by', 'approved_at', 'branch_name', 'review_notes', 'review_passed', 
    'priority', 'assigned_agent'];
  
  const setClauses = [];
  const values = [];
  
  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      setClauses.push(`${key} = ?`);
      values.push(value);
    }
  }
  
  if (setClauses.length === 0) return null;
  
  setClauses.push(`updated_at = datetime('now')`);
  values.push(id);
  
  const stmt = db.prepare(`UPDATE pipeline SET ${setClauses.join(', ')} WHERE id = ?`);
  return stmt.run(...values);
}

function approvePipeline(id, approvedBy = 'jason') {
  return updatePipeline(id, {
    stage: 'ready',
    approved_by: approvedBy,
    approved_at: new Date().toISOString()
  });
}

function addPipelineTask({ pipelineId, title, description, assignedTo }) {
  const stmt = db.prepare(`
    INSERT INTO pipeline_tasks (pipeline_id, title, description, assigned_to)
    VALUES (?, ?, ?, ?)
  `);
  return stmt.run(pipelineId, title, description || null, assignedTo || null).lastInsertRowid;
}

function getPipelineTasks(pipelineId) {
  return db.prepare(`
    SELECT * FROM pipeline_tasks 
    WHERE pipeline_id = ? 
    ORDER BY created_at ASC
  `).all(pipelineId);
}

function updatePipelineTask(id, updates) {
  const allowedFields = ['title', 'description', 'status', 'assigned_to', 'output', 'completed_at'];
  const setClauses = [];
  const values = [];
  
  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      setClauses.push(`${key} = ?`);
      values.push(value);
    }
  }
  
  if (setClauses.length === 0) return null;
  values.push(id);
  
  const stmt = db.prepare(`UPDATE pipeline_tasks SET ${setClauses.join(', ')} WHERE id = ?`);
  return stmt.run(...values);
}

function addPipelineNote({ pipelineId, agentRole, noteType, content }) {
  const stmt = db.prepare(`
    INSERT INTO pipeline_notes (pipeline_id, agent_role, note_type, content)
    VALUES (?, ?, ?, ?)
  `);
  return stmt.run(pipelineId, agentRole, noteType || 'info', content).lastInsertRowid;
}

function getPipelineNotes(pipelineId) {
  return db.prepare(`
    SELECT * FROM pipeline_notes 
    WHERE pipeline_id = ? 
    ORDER BY created_at ASC
  `).all(pipelineId);
}

// ============================================================
// SESSION COSTS FUNCTIONS
// ============================================================

function updateSessionCost({ sessionId, source, totalCost, inputTokens, outputTokens, messageCount, firstTimestamp, lastTimestamp }) {
  const stmt = db.prepare(`
    INSERT INTO session_costs (session_id, source, total_cost, input_tokens, output_tokens, message_count, first_timestamp, last_timestamp, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(session_id) DO UPDATE SET
      source = excluded.source,
      total_cost = excluded.total_cost,
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      message_count = excluded.message_count,
      first_timestamp = excluded.first_timestamp,
      last_timestamp = excluded.last_timestamp,
      updated_at = datetime('now')
  `);
  return stmt.run(sessionId, source, totalCost, inputTokens, outputTokens, messageCount, firstTimestamp, lastTimestamp);
}

function getCostsBySource(days = 7) {
  return db.prepare(`
    SELECT 
      COALESCE(source, 'unknown') as source,
      COUNT(DISTINCT session_id) as session_count,
      COALESCE(SUM(cost_usd), 0) as total_cost,
      COALESCE(SUM(tokens_in), 0) as input_tokens,
      COALESCE(SUM(tokens_out), 0) as output_tokens,
      COUNT(*) as message_count
    FROM token_usage
    WHERE created_at > datetime('now', '-' || ? || ' days')
    GROUP BY source
    ORDER BY total_cost DESC
  `).all(days);
}

// ============================================================
// SOCIAL POSTS FUNCTIONS
// ============================================================

// Generate simple hash for content comparison
function hashContent(text) {
  const normalized = text.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Simple hash using string length and char codes
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) - hash) + normalized.charCodeAt(i);
    hash = hash & hash;
  }
  return hash.toString(16);
}

function trackSocialPost({ platform, postId, postType, content, url, inReplyTo }) {
  const contentHash = hashContent(content);
  const stmt = db.prepare(`
    INSERT INTO social_posts (platform, post_id, post_type, content, content_hash, url, in_reply_to)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(platform, postId, postType || 'post', content, contentHash, url, inReplyTo).lastInsertRowid;
}

function getRecentSocialPosts(platform, limit = 20) {
  return db.prepare(`
    SELECT * FROM social_posts 
    WHERE platform = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(platform, limit);
}

function checkSocialDuplicate(platform, content, threshold = 0.6) {
  const recentPosts = getRecentSocialPosts(platform, 30);
  
  // Normalize for comparison
  const normalize = (t) => t.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  
  const normalizedNew = normalize(content);
  const newWords = new Set(normalizedNew.split(' ').filter(w => w.length > 3));
  
  for (const post of recentPosts) {
    const normalizedOld = normalize(post.content);
    const oldWords = new Set(normalizedOld.split(' ').filter(w => w.length > 3));
    
    // Jaccard similarity
    const intersection = [...newWords].filter(w => oldWords.has(w)).length;
    const union = new Set([...newWords, ...oldWords]).size;
    const similarity = union > 0 ? intersection / union : 0;
    
    if (similarity >= threshold) {
      return {
        isDuplicate: true,
        similarity: (similarity * 100).toFixed(0) + '%',
        matchedPost: post
      };
    }
  }
  
  return { isDuplicate: false };
}

function getSocialStats(platform) {
  const total = db.prepare(`SELECT COUNT(*) as count FROM social_posts WHERE platform = ?`).get(platform);
  const thisMonth = db.prepare(`
    SELECT COUNT(*) as count FROM social_posts 
    WHERE platform = ? AND created_at >= date('now', 'start of month')
  `).get(platform);
  const lastPost = db.prepare(`
    SELECT * FROM social_posts WHERE platform = ? ORDER BY created_at DESC LIMIT 1
  `).get(platform);
  
  return {
    totalPosts: total.count,
    postsThisMonth: thisMonth.count,
    lastPost
  };
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  db,
  // Tasks
  addTask,
  getTasks,
  updateTask,
  completeTask,
  // Token usage
  logUsage,
  getCostsToday,
  getCostsByModel,
  getCostsBySource,
  // Session costs
  updateSessionCost,
  // Errors
  logError,
  getUnresolvedErrors,
  resolveError,
  // Activity
  logActivity,
  getRecentActivity,
  // Health
  logHealthCheck,
  getLatestHealth,
  // Memory
  addMemory,
  searchMemory,
  getMemoryByCategory,
  // Embeddings
  addMemoryEmbedding,
  getMemoryEmbedding,
  searchMemoryByEmbedding,
  getMemoriesWithEmbeddings,
  updateMemoryWithEmbedding,
  cosineSimilarity,
  // Pipeline
  createPipeline,
  getPipeline,
  listPipeline,
  updatePipeline,
  approvePipeline,
  addPipelineTask,
  getPipelineTasks,
  updatePipelineTask,
  addPipelineNote,
  getPipelineNotes,
  // Social Posts
  trackSocialPost,
  getRecentSocialPosts,
  checkSocialDuplicate,
  getSocialStats,
};
