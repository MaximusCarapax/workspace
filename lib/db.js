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

// ============================================================
// PIPELINE V3: Type-based stage validation
// ============================================================
const PIPELINE_STAGES = {
  feature: ['idea', 'spec', 'spec-review', 'building', 'final-review', 'live'],
  story: ['backlog', 'in-progress', 'qa', 'done', 'blocked'],
  risk: ['identified', 'mitigating', 'resolved', 'accepted'],
  issue: ['identified', 'investigating', 'resolved'],
  assumption: ['identified', 'validated', 'invalidated'],
  dependency: ['identified', 'waiting', 'resolved', 'blocked']
};

function validatePipelineStage(type, stage) {
  const validStages = PIPELINE_STAGES[type || 'feature'];
  if (!validStages) return false;
  return validStages.includes(stage);
}

function getDefaultStage(type) {
  const defaults = {
    feature: 'idea',
    story: 'todo',
    risk: 'identified',
    issue: 'identified',
    assumption: 'identified',
    dependency: 'identified'
  };
  return defaults[type] || 'idea';
}

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

    CREATE TABLE IF NOT EXISTS content_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL CHECK(platform IN ('linkedin', 'x', 'youtube', 'blog', 'newsletter', 'other')),
        title TEXT,
        content TEXT,
        status TEXT DEFAULT 'idea' CHECK(status IN ('idea', 'hooks', 'draft', 'review', 'scheduled', 'published', 'archived')),
        -- Original columns
        scheduled_for TEXT,
        published_at TEXT,
        published_url TEXT,
        metrics TEXT,
        tags TEXT,
        notes TEXT,
        -- Content Pipeline v2 columns
        hooks TEXT,
        selected_hook TEXT,
        draft TEXT,
        review_score INTEGER,
        review_notes TEXT,
        scheduled_time TEXT,
        posted_time TEXT,
        post_url TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  db.exec(`

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
        embedding BLOB,
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
        parent_id INTEGER REFERENCES pipeline(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        description TEXT,
        stage TEXT DEFAULT 'idea' CHECK(stage IN ('idea', 'spec', 'spec-review', 'building', 'qa', 'final-review', 'done', 'live', 'ready', 'build', 'review', 'blocked')),
        
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
        
        -- Health check config (JSON)
        health_check TEXT,
        
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
    -- KNOWLEDGE CACHE TABLES
    -- ============================================================

    CREATE TABLE IF NOT EXISTS knowledge_cache (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_url TEXT,
        source_session TEXT,
        topic_tags TEXT,
        entities TEXT,
        confidence REAL DEFAULT 1.0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME,
        verified BOOLEAN DEFAULT FALSE,
        superseded_by INTEGER,
        embedding BLOB
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
        title, summary, topic_tags,
        content='knowledge_cache',
        content_rowid='id'
    );

    -- ============================================================
    -- KNOWLEDGE CACHE TRIGGERS
    -- ============================================================

    CREATE TRIGGER IF NOT EXISTS knowledge_cache_ai AFTER INSERT ON knowledge_cache
    BEGIN
        INSERT INTO knowledge_fts(rowid, title, summary, topic_tags)
        VALUES (new.id, new.title, new.summary, new.topic_tags);
    END;

    CREATE TRIGGER IF NOT EXISTS knowledge_cache_ad AFTER DELETE ON knowledge_cache
    BEGIN
        DELETE FROM knowledge_fts WHERE rowid = old.id;
    END;

    CREATE TRIGGER IF NOT EXISTS knowledge_cache_au AFTER UPDATE ON knowledge_cache
    BEGIN
        DELETE FROM knowledge_fts WHERE rowid = old.id;
        INSERT INTO knowledge_fts(rowid, title, summary, topic_tags)
        VALUES (new.id, new.title, new.summary, new.topic_tags);
    END;

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
    -- INDEXES (Knowledge cache indexes created in migration)
    -- ============================================================
    
    CREATE INDEX IF NOT EXISTS idx_knowledge_source ON knowledge_cache(source_type);
    CREATE INDEX IF NOT EXISTS idx_knowledge_created ON knowledge_cache(created_at);
    CREATE INDEX IF NOT EXISTS idx_knowledge_verified ON knowledge_cache(verified);
    CREATE INDEX IF NOT EXISTS idx_knowledge_expires ON knowledge_cache(expires_at);
    CREATE INDEX IF NOT EXISTS idx_knowledge_superseded ON knowledge_cache(superseded_by);
    
    CREATE INDEX IF NOT EXISTS idx_social_platform ON social_posts(platform);
    CREATE INDEX IF NOT EXISTS idx_social_hash ON social_posts(content_hash);
    CREATE INDEX IF NOT EXISTS idx_social_created ON social_posts(created_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);
    CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts(name);
    CREATE INDEX IF NOT EXISTS idx_content_platform ON content_items(platform);
    CREATE INDEX IF NOT EXISTS idx_content_status ON content_items(status);
    CREATE INDEX IF NOT EXISTS idx_token_date ON token_usage(created_at);
    CREATE INDEX IF NOT EXISTS idx_token_model ON token_usage(model);
    CREATE INDEX IF NOT EXISTS idx_errors_level ON error_logs(level);
    CREATE INDEX IF NOT EXISTS idx_errors_source ON error_logs(source);
    CREATE INDEX IF NOT EXISTS idx_memory_category ON memory(category);
    CREATE INDEX IF NOT EXISTS idx_memory_embeddings_memory ON memory_embeddings(memory_id);
    CREATE INDEX IF NOT EXISTS idx_memory_embeddings_model ON memory_embeddings(model);
    CREATE INDEX IF NOT EXISTS idx_pipeline_stage ON pipeline(stage);
    CREATE INDEX IF NOT EXISTS idx_pipeline_project ON pipeline(project_id);
    -- idx_pipeline_parent created by migration after parent_id column added
    CREATE INDEX IF NOT EXISTS idx_pipeline_tasks_pipeline ON pipeline_tasks(pipeline_id);
    CREATE INDEX IF NOT EXISTS idx_pipeline_notes_pipeline ON pipeline_notes(pipeline_id);
  `);
}

// Initialize on load
initSchema();

// Run migrations
function runMigrations() {
  // Migration: Add source and related_id columns to activity table
  try {
    const columns = db.pragma('table_info(activity)');
    const columnNames = columns.map(c => c.name);
    
    if (!columnNames.includes('source')) {
      db.exec(`ALTER TABLE activity ADD COLUMN source TEXT`);
    }
    if (!columnNames.includes('related_id')) {
      db.exec(`ALTER TABLE activity ADD COLUMN related_id TEXT`);
    }
  } catch (e) {
    // Ignore errors if columns already exist
  }

  // Migration: Add new columns to pipeline table and update stage constraint
  try {
    const pipelineColumns = db.pragma('table_info(pipeline)');
    const pipelineColumnNames = pipelineColumns.map(c => c.name);
    
    // Add new columns if they don't exist
    if (!pipelineColumnNames.includes('assigned_to')) {
      db.exec(`ALTER TABLE pipeline ADD COLUMN assigned_to TEXT`);
    }
    if (!pipelineColumnNames.includes('started_at')) {
      db.exec(`ALTER TABLE pipeline ADD COLUMN started_at TEXT`);
    }
    if (!pipelineColumnNames.includes('completed_at')) {
      db.exec(`ALTER TABLE pipeline ADD COLUMN completed_at TEXT`);
    }
    
    // Update the stage CHECK constraint to include 'building' and 'blocked'
    // Need to recreate table since SQLite doesn't support modifying CHECK constraints
  } catch (e) {
    // Ignore errors
  }
  
  // Migration: Update pipeline stage CHECK constraint to include 'building' and 'blocked'
  try {
    // Test if we can insert 'building' stage
    const testStmt = db.prepare(`INSERT INTO pipeline (title, stage) VALUES (?, ?)`);
    try {
      testStmt.run('__migration_test__', 'building');
      // If succeeded, delete test row - constraint already allows 'building'
      db.prepare(`DELETE FROM pipeline WHERE title = '__migration_test__'`).run();
    } catch (checkErr) {
      if (checkErr.message.includes('CHECK constraint failed')) {
        console.log('Migrating pipeline table to add new stages (building, blocked)...');
        
        // Create new table with expanded stage constraint
        db.exec(`
          CREATE TABLE IF NOT EXISTS pipeline_new (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
              title TEXT NOT NULL,
              description TEXT,
              stage TEXT DEFAULT 'idea' CHECK(stage IN ('idea', 'spec', 'ready', 'build', 'building', 'review', 'blocked', 'done')),
              
              spec_doc TEXT,
              acceptance_criteria TEXT,
              
              approved_by TEXT,
              approved_at TEXT,
              
              branch_name TEXT,
              
              review_notes TEXT,
              review_passed INTEGER,
              
              priority INTEGER DEFAULT 2 CHECK(priority BETWEEN 1 AND 4),
              assigned_agent TEXT,
              assigned_to TEXT,
              started_at TEXT,
              completed_at TEXT,
              created_at TEXT DEFAULT (datetime('now')),
              updated_at TEXT DEFAULT (datetime('now'))
          );
        `);
        
        // Copy existing data
        db.exec(`
          INSERT INTO pipeline_new 
          SELECT id, project_id, title, description, stage, spec_doc, acceptance_criteria,
                 approved_by, approved_at, branch_name, review_notes, review_passed,
                 priority, assigned_agent, 
                 COALESCE(assigned_to, NULL) as assigned_to,
                 COALESCE(started_at, NULL) as started_at,
                 COALESCE(completed_at, NULL) as completed_at,
                 created_at, updated_at
          FROM pipeline
        `);
        
        // Drop old table and rename new one
        db.exec(`DROP TABLE pipeline`);
        db.exec(`ALTER TABLE pipeline_new RENAME TO pipeline`);
        
        // Recreate indexes
        db.exec(`CREATE INDEX IF NOT EXISTS idx_pipeline_stage ON pipeline(stage)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_pipeline_project ON pipeline(project_id)`);
        
        console.log('Pipeline table migration complete.');
      }
    }
  } catch (e) {
    // Table doesn't exist or other error
  }

  // Migration: Update pipeline_notes note_type CHECK constraint
  // SQLite doesn't support modifying CHECK constraints, so we recreate the table
  try {
    // Check if migration needed by trying to insert a test row
    const testStmt = db.prepare(`INSERT INTO pipeline_notes (pipeline_id, agent_role, note_type, content) VALUES (?, ?, ?, ?)`);
    try {
      testStmt.run(999999, 'test', 'progress', 'test');
      // If it succeeded, delete the test row and we're good
      db.prepare(`DELETE FROM pipeline_notes WHERE pipeline_id = 999999`).run();
    } catch (checkErr) {
      if (checkErr.message.includes('CHECK constraint failed')) {
        // Need to migrate the table
        console.log('Migrating pipeline_notes table to add new note types...');
        
        // Create new table with expanded note_type constraint
        db.exec(`
          CREATE TABLE IF NOT EXISTS pipeline_notes_new (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              pipeline_id INTEGER REFERENCES pipeline(id) ON DELETE CASCADE,
              agent_role TEXT NOT NULL,
              note_type TEXT CHECK(note_type IN ('handover', 'blocker', 'question', 'decision', 'info', 'started', 'progress', 'complete')),
              content TEXT NOT NULL,
              created_at TEXT DEFAULT (datetime('now'))
          );
        `);
        
        // Copy data
        db.exec(`INSERT INTO pipeline_notes_new SELECT * FROM pipeline_notes`);
        
        // Drop old table and rename new one
        db.exec(`DROP TABLE pipeline_notes`);
        db.exec(`ALTER TABLE pipeline_notes_new RENAME TO pipeline_notes`);
        
        // Recreate index
        db.exec(`CREATE INDEX IF NOT EXISTS idx_pipeline_notes_pipeline ON pipeline_notes(pipeline_id)`);
        
        console.log('Migration complete.');
      }
    }
  } catch (e) {
    // Table doesn't exist or other error - will be created by initSchema
  }

  // Migration: Add parent_id and health_check columns to pipeline table
  // Also update stage constraint to include new stages (spec-review, qa, final-review, live)
  try {
    const pipelineColumns2 = db.pragma('table_info(pipeline)');
    const pipelineColumnNames2 = pipelineColumns2.map(c => c.name);
    
    // Add parent_id if it doesn't exist
    if (!pipelineColumnNames2.includes('parent_id')) {
      console.log('Adding parent_id column to pipeline table...');
      db.exec(`ALTER TABLE pipeline ADD COLUMN parent_id INTEGER REFERENCES pipeline(id) ON DELETE SET NULL`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_pipeline_parent ON pipeline(parent_id)`);
      console.log('parent_id column added.');
    }
    
    // Add health_check if it doesn't exist
    if (!pipelineColumnNames2.includes('health_check')) {
      console.log('Adding health_check column to pipeline table...');
      db.exec(`ALTER TABLE pipeline ADD COLUMN health_check TEXT`);
      console.log('health_check column added.');
    }
    
    // Check if we need to update the stage constraint to include 'live'
    // Test if we can insert 'live' stage
    const testStmt2 = db.prepare(`INSERT INTO pipeline (title, stage) VALUES (?, ?)`);
    try {
      testStmt2.run('__migration_test_live__', 'live');
      // If succeeded, delete test row - constraint already allows 'live'
      db.prepare(`DELETE FROM pipeline WHERE title = '__migration_test_live__'`).run();
    } catch (checkErr) {
      if (checkErr.message.includes('CHECK constraint failed')) {
        console.log('Migrating pipeline table to add new stages (spec-review, qa, final-review, live)...');
        
        // Get all current columns for the new table
        const currentCols = db.pragma('table_info(pipeline)');
        const hasParentId = currentCols.some(c => c.name === 'parent_id');
        const hasHealthCheck = currentCols.some(c => c.name === 'health_check');
        
        // Create new table with expanded stage constraint
        db.exec(`
          CREATE TABLE IF NOT EXISTS pipeline_v2 (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
              parent_id INTEGER REFERENCES pipeline(id) ON DELETE SET NULL,
              title TEXT NOT NULL,
              description TEXT,
              stage TEXT DEFAULT 'idea' CHECK(stage IN ('idea', 'spec', 'spec-review', 'building', 'qa', 'final-review', 'done', 'live', 'ready', 'build', 'review', 'blocked')),
              
              spec_doc TEXT,
              acceptance_criteria TEXT,
              
              approved_by TEXT,
              approved_at TEXT,
              
              branch_name TEXT,
              
              review_notes TEXT,
              review_passed INTEGER,
              
              health_check TEXT,
              
              priority INTEGER DEFAULT 2 CHECK(priority BETWEEN 1 AND 4),
              assigned_agent TEXT,
              assigned_to TEXT,
              started_at TEXT,
              completed_at TEXT,
              created_at TEXT DEFAULT (datetime('now')),
              updated_at TEXT DEFAULT (datetime('now'))
          );
        `);
        
        // Build column list for copy based on what exists
        const baseColumns = 'id, project_id, title, description, stage, spec_doc, acceptance_criteria, approved_by, approved_at, branch_name, review_notes, review_passed, priority, assigned_agent, created_at, updated_at';
        const optionalCols = [];
        if (hasParentId) optionalCols.push('parent_id');
        if (hasHealthCheck) optionalCols.push('health_check');
        if (currentCols.some(c => c.name === 'assigned_to')) optionalCols.push('assigned_to');
        if (currentCols.some(c => c.name === 'started_at')) optionalCols.push('started_at');
        if (currentCols.some(c => c.name === 'completed_at')) optionalCols.push('completed_at');
        
        const allCols = baseColumns + (optionalCols.length ? ', ' + optionalCols.join(', ') : '');
        
        // Copy existing data
        db.exec(`INSERT INTO pipeline_v2 (${allCols}) SELECT ${allCols} FROM pipeline`);
        
        // Drop old table and rename new one
        db.exec(`DROP TABLE pipeline`);
        db.exec(`ALTER TABLE pipeline_v2 RENAME TO pipeline`);
        
        // Recreate indexes
        db.exec(`CREATE INDEX IF NOT EXISTS idx_pipeline_stage ON pipeline(stage)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_pipeline_project ON pipeline(project_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_pipeline_parent ON pipeline(parent_id)`);
        
        console.log('Pipeline table migration complete with new stages.');
      }
    }
  } catch (e) {
    // Ignore errors
  }

  // Migration: Create knowledge cache tables if they don't exist
  try {
    const knowledgeCacheExists = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='knowledge_cache'
    `).get();
    
    if (!knowledgeCacheExists) {
      console.log('Creating knowledge cache tables...');
      
      // Create knowledge_cache table
      db.exec(`
        CREATE TABLE IF NOT EXISTS knowledge_cache (
          id INTEGER PRIMARY KEY,
          title TEXT NOT NULL,
          summary TEXT NOT NULL,
          source_type TEXT NOT NULL,
          source_url TEXT,
          source_session TEXT,
          topic_tags TEXT,
          entities TEXT,
          confidence REAL DEFAULT 1.0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          expires_at DATETIME,
          verified BOOLEAN DEFAULT FALSE,
          superseded_by INTEGER,
          embedding BLOB
        )
      `);
      
      // Try to create FTS5 table
      try {
        db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts 
          USING fts5(
            title, summary, topic_tags,
            content='knowledge_cache',
            content_rowid='id'
          )
        `);
      } catch (ftsError) {
        console.warn('FTS5 not available for knowledge cache:', ftsError.message);
      }
      
      console.log('Knowledge cache tables created.');
    }
  } catch (e) {
    console.error('Error creating knowledge cache tables:', e.message);
  }

  // Migration: Ensure knowledge cache triggers exist (only if FTS5 is available)
  try {
    // Check if knowledge_cache table exists
    const knowledgeCacheExists = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='knowledge_cache'
    `).get();
    
    // Check if FTS5 table exists
    const fts5Exists = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='knowledge_fts'
    `).get();
    
    if (knowledgeCacheExists && fts5Exists) {
      // Check if triggers exist
      const triggers = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='trigger' AND name LIKE 'knowledge_cache_%'
      `).all();
      
      const triggerNames = triggers.map(t => t.name);
      
      if (!triggerNames.includes('knowledge_cache_ai')) {
        console.log('Creating knowledge_cache_ai trigger...');
        db.exec(`
          CREATE TRIGGER knowledge_cache_ai AFTER INSERT ON knowledge_cache
          BEGIN
            INSERT INTO knowledge_fts(rowid, title, summary, topic_tags)
            VALUES (new.id, new.title, new.summary, new.topic_tags);
          END
        `);
      }
      
      if (!triggerNames.includes('knowledge_cache_ad')) {
        console.log('Creating knowledge_cache_ad trigger...');
        db.exec(`
          CREATE TRIGGER knowledge_cache_ad AFTER DELETE ON knowledge_cache
          BEGIN
            DELETE FROM knowledge_fts WHERE rowid = old.id;
          END
        `);
      }
      
      if (!triggerNames.includes('knowledge_cache_au')) {
        console.log('Creating knowledge_cache_au trigger...');
        db.exec(`
          CREATE TRIGGER knowledge_cache_au AFTER UPDATE ON knowledge_cache
          BEGIN
            DELETE FROM knowledge_fts WHERE rowid = old.id;
            INSERT INTO knowledge_fts(rowid, title, summary, topic_tags)
            VALUES (new.id, new.title, new.summary, new.topic_tags);
          END
        `);
      }
    } else {
      if (!fts5Exists) {
        console.warn('Skipping knowledge cache triggers: FTS5 table not available');
      }
    }
  } catch (e) {
    console.error('Error creating knowledge cache triggers:', e.message);
  }

  // Migration: Add 'type' column to pipeline table for V3 feature/story types
  try {
    const pipelineColumns3 = db.pragma('table_info(pipeline)');
    const pipelineColumnNames3 = pipelineColumns3.map(c => c.name);
    
    if (!pipelineColumnNames3.includes('type')) {
      console.log('Adding type column to pipeline table...');
      db.exec(`ALTER TABLE pipeline ADD COLUMN type TEXT DEFAULT 'feature'`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_pipeline_type ON pipeline(type)`);
      console.log('type column added.');
    }
  } catch (e) {
    // Ignore errors
  }

  // Migration: Create self_observations table for Self-Observation System
  try {
    const selfObsExists = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='self_observations'
    `).get();
    
    if (!selfObsExists) {
      console.log('Creating self_observations table...');
      db.exec(`
        CREATE TABLE IF NOT EXISTS self_observations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          week_start TEXT NOT NULL,
          category TEXT NOT NULL CHECK(category IN ('task_preference', 'communication', 'decision', 'error', 'other')),
          observation TEXT NOT NULL,
          evidence TEXT,
          confidence REAL DEFAULT 0.5 CHECK(confidence >= 0 AND confidence <= 1),
          feedback TEXT CHECK(feedback IS NULL OR feedback IN ('useful', 'not_useful')),
          feedback_note TEXT
        );
        
        CREATE INDEX IF NOT EXISTS idx_self_obs_week ON self_observations(week_start);
        CREATE INDEX IF NOT EXISTS idx_self_obs_category ON self_observations(category);
        CREATE INDEX IF NOT EXISTS idx_self_obs_feedback ON self_observations(feedback);
      `);
      console.log('self_observations table created.');
    }
  } catch (e) {
    console.error('Error creating self_observations table:', e.message);
  }

  // Migration: Add story stages (todo, in-progress, qa, done) to stage constraint
  // For stories, we need these additional stages
  try {
    const testStmt3 = db.prepare(`INSERT INTO pipeline (title, stage, type) VALUES (?, ?, ?)`);
    try {
      testStmt3.run('__migration_test_story__', 'todo', 'story');
      // If succeeded, delete test row
      db.prepare(`DELETE FROM pipeline WHERE title = '__migration_test_story__'`).run();
    } catch (checkErr) {
      if (checkErr.message.includes('CHECK constraint failed')) {
        console.log('Migrating pipeline table to add story stages (todo, in-progress, qa)...');
        
        // Get all current columns
        const currentCols = db.pragma('table_info(pipeline)');
        
        // Create new table with all valid stages
        db.exec(`
          CREATE TABLE IF NOT EXISTS pipeline_v3 (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
              parent_id INTEGER REFERENCES pipeline(id) ON DELETE SET NULL,
              title TEXT NOT NULL,
              description TEXT,
              type TEXT DEFAULT 'feature',
              stage TEXT DEFAULT 'idea' CHECK(stage IN (
                'idea', 'spec', 'spec-review', 'building', 'live',
                'todo', 'in-progress', 'qa', 'done', 'blocked',
                'ready', 'build', 'review', 'final-review'
              )),
              
              spec_doc TEXT,
              acceptance_criteria TEXT,
              
              approved_by TEXT,
              approved_at TEXT,
              
              branch_name TEXT,
              
              review_notes TEXT,
              review_passed INTEGER,
              
              health_check TEXT,
              notes TEXT,
              
              priority INTEGER DEFAULT 2 CHECK(priority BETWEEN 1 AND 4),
              assigned_agent TEXT,
              assigned_to TEXT,
              started_at TEXT,
              completed_at TEXT,
              created_at TEXT DEFAULT (datetime('now')),
              updated_at TEXT DEFAULT (datetime('now'))
          );
        `);
        
        // Build column list based on what exists in old table
        const colNames = currentCols.map(c => c.name);
        const safeCols = colNames.filter(c => 
          ['id', 'project_id', 'parent_id', 'title', 'description', 'type', 'stage', 
           'spec_doc', 'acceptance_criteria', 'approved_by', 'approved_at', 
           'branch_name', 'review_notes', 'review_passed', 'health_check', 'notes',
           'priority', 'assigned_agent', 'assigned_to', 'started_at', 'completed_at',
           'created_at', 'updated_at'].includes(c)
        );
        
        const colList = safeCols.join(', ');
        
        // Copy existing data
        db.exec(`INSERT INTO pipeline_v3 (${colList}) SELECT ${colList} FROM pipeline`);
        
        // Drop old table and rename new one
        db.exec(`DROP TABLE pipeline`);
        db.exec(`ALTER TABLE pipeline_v3 RENAME TO pipeline`);
        
        // Recreate indexes
        db.exec(`CREATE INDEX IF NOT EXISTS idx_pipeline_stage ON pipeline(stage)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_pipeline_project ON pipeline(project_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_pipeline_parent ON pipeline(parent_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_pipeline_type ON pipeline(type)`);
        
        console.log('Pipeline table migration complete with story stages.');
      }
    }
  } catch (e) {
    // Ignore errors
  }
}
runMigrations();

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

function logActivity({ action, category, description, metadata, sessionId, source, relatedId }) {
  const stmt = db.prepare(`
    INSERT INTO activity (action, category, description, metadata, session_id, source, related_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(action, category, description, metadata ? JSON.stringify(metadata) : null, sessionId, source || null, relatedId || null);
}

function getRecentActivity(limit = 20, filters = {}) {
  let sql = `SELECT * FROM activity WHERE 1=1`;
  const params = [];
  
  if (filters.source) {
    sql += ` AND source = ?`;
    params.push(filters.source);
  }
  
  if (filters.relatedId) {
    sql += ` AND related_id = ?`;
    params.push(filters.relatedId);
  }
  
  sql += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(limit);
  
  return db.prepare(sql).all(...params);
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

/**
 * Add a new memory with optional embedding generation
 * @param {Object} params - Memory parameters
 * @param {string} params.category - Memory category
 * @param {string} params.subject - Memory subject
 * @param {string} params.content - Memory content
 * @param {number} params.importance - Importance level (1-10)
 * @param {string} params.source - Source of the memory
 * @param {Float32Array|Array|Buffer} params.embedding - Optional embedding vector
 * @param {boolean} params.generateEmbedding - Whether to generate embedding if not provided (default: false)
 * @param {Object} params.embeddingOptions - Options for embedding generation
 * @returns {Promise<number>} - ID of the created memory
 */
async function addMemory({ 
  category, 
  subject, 
  content, 
  importance, 
  source, 
  embedding,
  generateEmbedding = false,
  embeddingOptions = {}
}) {
  // Convert embedding to Buffer if provided
  let embeddingBuffer = null;
  if (embedding) {
    if (embedding instanceof Float32Array) {
      embeddingBuffer = Buffer.from(embedding.buffer);
    } else if (Array.isArray(embedding)) {
      embeddingBuffer = Buffer.from(new Float32Array(embedding).buffer);
    } else if (Buffer.isBuffer(embedding)) {
      embeddingBuffer = embedding;
    } else {
      throw new Error('Embedding must be Float32Array, array of numbers, or Buffer');
    }
  }
  
  const stmt = db.prepare(`
    INSERT INTO memory (category, subject, content, importance, source, embedding)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(category, subject, content, importance || 5, source, embeddingBuffer);
  const memoryId = result.lastInsertRowid;
  
  // Generate embedding if requested and not provided
  if (generateEmbedding && !embedding) {
    await generateAndStoreEmbedding(memoryId, {
      model: 'text-embedding-3-small',
      sessionId: embeddingOptions.sessionId || null,
      source: embeddingOptions.source || 'memory_creation',
      ...embeddingOptions
    });
  }
  
  return memoryId;
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

// Note: generateEmbedding is provided by the embeddings module
// It returns a Float32Array embedding vector
// It supports OpenAI and OpenRouter (Gemini embeddings) as fallback

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

function getMemoryEmbeddingDirect(memoryId) {
  const row = db.prepare(`
    SELECT embedding FROM memory 
    WHERE id = ?
  `).get(memoryId);
  
  if (!row || !row.embedding) return null;
  return new Float32Array(row.embedding.buffer);
}

/**
 * Search memories by embedding vector using cosine similarity
 * @param {Object} params - Search parameters
 * @param {string} params.model - Embedding model to search for
 * @param {Float32Array|Array} params.embedding - Query embedding vector
 * @param {number} params.limit - Maximum number of results (default: 10)
 * @param {number} params.threshold - Minimum similarity threshold (default: 0.7)
 * @returns {Array} - Array of memory objects with similarity scores (0-1, where 1 is identical)
 */
function searchMemoryByEmbedding({ model = 'text-embedding-3-small', embedding, limit = 10, threshold = 0.4 }) {
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

/**
 * Perform semantic search on memories using text query
 * Generates embedding for the query text and searches for similar memories
 * @param {string} query - The text query to search for
 * @param {Object} options - Search options
 * @param {string} options.model - Embedding model to use (default: text-embedding-3-small)
 * @param {number} options.limit - Maximum number of results (default: 10)
 * @param {number} options.threshold - Minimum similarity threshold (default: 0.7)
 * @param {string} options.sessionId - Session ID for token usage tracking
 * @param {string} options.source - Source identifier for token usage tracking
 * @returns {Promise<Array>} - Array of memory objects with similarity scores (0-1, where 1 is identical)
 * Each result includes all memory fields plus a 'similarity' field with the cosine similarity score
 */
async function semanticSearchMemory(query, options = {}) {
  const {
    model = 'text-embedding-3-small',
    limit = 10,
    threshold = 0.4,
    sessionId = null,
    source = 'semantic_search'
  } = options;
  
  // Generate embedding for the query text
  // Note: generateEmbedding is imported at the bottom of this file
  const queryEmbedding = await generateEmbedding(query, {
    model,
    sessionId,
    source
  });
  
  // Search using the generated embedding
  return searchMemoryByEmbedding({
    model,
    embedding: queryEmbedding,
    limit,
    threshold
  });
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

/**
 * Generate and store embedding for a memory
 * This is a convenience wrapper around the embeddings module
 */
async function generateAndStoreEmbedding(memoryId, options = {}) {
  // Dynamic import to avoid circular dependencies
  const { addEmbeddingToMemory } = require('./embeddings');
  return await addEmbeddingToMemory(memoryId, null, options);
}

function updateMemoryWithEmbedding(memoryId, updates, embeddingData = null) {
  // First, update the memory record
  const allowedFields = ['category', 'subject', 'content', 'importance', 'source', 'expires_at', 'embedding'];
  const setClauses = [];
  const values = [];
  
  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      setClauses.push(`${key} = ?`);
      // Handle embedding conversion
      if (key === 'embedding' && value) {
        let embeddingBuffer;
        if (value instanceof Float32Array) {
          embeddingBuffer = Buffer.from(value.buffer);
        } else if (Array.isArray(value)) {
          embeddingBuffer = Buffer.from(new Float32Array(value).buffer);
        } else if (Buffer.isBuffer(value)) {
          embeddingBuffer = value;
        } else {
          throw new Error('Embedding must be Float32Array, array of numbers, or Buffer');
        }
        values.push(embeddingBuffer);
      } else {
        values.push(value);
      }
    }
  }
  
  if (setClauses.length > 0) {
    setClauses.push(`updated_at = datetime('now')`);
    values.push(memoryId);
    
    const stmt = db.prepare(`UPDATE memory SET ${setClauses.join(', ')} WHERE id = ?`);
    stmt.run(...values);
  }
  
  // If embedding data is provided, update the memory_embeddings table as well
  if (embeddingData) {
    const { model, embedding } = embeddingData;
    addMemoryEmbedding({ memoryId, model, embedding });
  }
  
  return true;
}

// ============================================================
// PIPELINE FUNCTIONS
// ============================================================

function createPipeline({ projectId, parentId, title, description, priority, type, acceptanceCriteria }) {
  const itemType = type || 'feature';
  const defaultStage = getDefaultStage(itemType);
  
  // acceptance_criteria stored as JSON string
  const acJson = acceptanceCriteria ? JSON.stringify(acceptanceCriteria) : null;
  
  const stmt = db.prepare(`
    INSERT INTO pipeline (project_id, parent_id, title, description, priority, type, stage, acceptance_criteria)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(projectId || null, parentId || null, title, description || null, priority || 2, itemType, defaultStage, acJson).lastInsertRowid;
}

function getPipeline(id) {
  return db.prepare(`SELECT * FROM pipeline WHERE id = ?`).get(id);
}

function listPipeline({ projectId, parentId, stage, limit, type } = {}) {
  let sql = `SELECT * FROM pipeline WHERE 1=1`;
  const params = [];
  
  if (projectId) {
    sql += ` AND project_id = ?`;
    params.push(projectId);
  }
  
  if (parentId !== undefined) {
    if (parentId === null) {
      sql += ` AND parent_id IS NULL`;
    } else {
      sql += ` AND parent_id = ?`;
      params.push(parentId);
    }
  }
  
  if (type) {
    sql += ` AND (type = ? OR (type IS NULL AND ? = 'feature'))`;
    params.push(type, type);
  }
  
  if (stage) {
    sql += ` AND stage = ?`;
    params.push(stage);
  } else {
    sql += ` AND stage NOT IN ('done', 'live')`;
  }
  
  sql += ` ORDER BY priority ASC, created_at DESC`;
  
  if (limit) {
    sql += ` LIMIT ?`;
    params.push(limit);
  }
  
  return db.prepare(sql).all(...params);
}

function getChildItems(pipelineId) {
  return db.prepare(`
    SELECT * FROM pipeline 
    WHERE parent_id = ? 
    ORDER BY priority ASC, created_at DESC
  `).all(pipelineId);
}

function getStoryStats(featureId) {
  const stories = db.prepare(`
    SELECT stage, COUNT(*) as count FROM pipeline 
    WHERE parent_id = ? AND (type = 'story' OR type IS NULL)
    GROUP BY stage
  `).all(featureId);
  
  let total = 0, done = 0;
  const byStage = {};
  for (const s of stories) {
    total += s.count;
    byStage[s.stage] = s.count;
    if (s.stage === 'done') done += s.count;
  }
  return { total, done, byStage };
}

function updatePipeline(id, updates, source = 'main') {
  // First, get the old pipeline record to check for stage changes
  const oldPipeline = db.prepare(`SELECT * FROM pipeline WHERE id = ?`).get(id);
  if (!oldPipeline) return null;
  
  // Validate stage if being updated
  if (updates.stage) {
    const itemType = oldPipeline.type || 'feature';
    if (!validatePipelineStage(itemType, updates.stage)) {
      const validStages = PIPELINE_STAGES[itemType];
      throw new Error(`Invalid stage '${updates.stage}' for type '${itemType}'. Valid stages: ${validStages.join(', ')}`);
    }
  }
  
  const allowedFields = ['title', 'description', 'stage', 'spec_doc', 'acceptance_criteria', 
    'approved_by', 'approved_at', 'branch_name', 'review_notes', 'review_passed', 
    'priority', 'assigned_agent', 'assigned_to', 'started_at', 'completed_at',
    'parent_id', 'health_check', 'type'];
  
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
  const result = stmt.run(...values);
  
  // Check if stage changed
  if (updates.stage && updates.stage !== oldPipeline.stage) {
    // Log the stage change activity
    logActivity({
      action: 'pipeline_stage_changed',
      category: 'pipeline',
      description: `Pipeline #${id} moved from ${oldPipeline.stage} to ${updates.stage}`,
      source: source,
      relatedId: `pipeline:${id}`,
      metadata: JSON.stringify({ 
        from: oldPipeline.stage, 
        to: updates.stage, 
        title: oldPipeline.title 
      })
    });
  }
  
  return result;
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
// CONTENT PIPELINE FUNCTIONS
// ============================================================

function addContentItem({ title, platform, status, notes }) {
  const stmt = db.prepare(`
    INSERT INTO content_items (title, platform, status, notes)
    VALUES (?, ?, ?, ?)
  `);
  return stmt.run(title, platform || 'linkedin', status || 'idea', notes || null).lastInsertRowid;
}

function getContentItems({ status, platform, limit } = {}) {
  let sql = `SELECT * FROM content_items WHERE 1=1`;
  const params = [];
  
  if (status) {
    sql += ` AND status = ?`;
    params.push(status);
  }
  
  if (platform) {
    sql += ` AND platform = ?`;
    params.push(platform);
  }
  
  sql += ` ORDER BY created_at DESC`;
  
  if (limit) {
    sql += ` LIMIT ?`;
    params.push(limit);
  }
  
  return db.prepare(sql).all(...params);
}

function getContentItem(id) {
  return db.prepare(`SELECT * FROM content_items WHERE id = ?`).get(id);
}

function updateContentItem(id, updates) {
  const allowedFields = ['title', 'platform', 'status', 'notes', 'hooks', 'selected_hook', 'draft', 'review_score', 'review_notes', 'scheduled_time', 'posted_time', 'post_url'];
  
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
  
  const stmt = db.prepare(`UPDATE content_items SET ${setClauses.join(', ')} WHERE id = ?`);
  return stmt.run(...values);
}

function deleteContentItem(id) {
  return db.prepare(`DELETE FROM content_items WHERE id = ?`).run(id);
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
// EMBEDDING GENERATION (Re-export from embeddings module)
// ============================================================

const { 
  generateEmbedding,
  generateEmbeddingsBatch,
  getEmbeddingDimensions,
  addEmbeddingToMemory,
  DEFAULT_EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS 
} = require('./embeddings');

// ============================================================
// SELF-OBSERVATION FUNCTIONS
// ============================================================

/**
 * Add a new self-observation
 * @param {Object} params - Observation parameters
 * @param {string} params.weekStart - Monday of the observation week (YYYY-MM-DD)
 * @param {string} params.category - Category: task_preference, communication, decision, error, other
 * @param {string} params.observation - The insight itself
 * @param {Array|Object} params.evidence - Supporting data points (will be JSON stringified)
 * @param {number} params.confidence - Confidence score 0-1
 * @returns {number} - ID of the created observation
 */
function addObservation({ weekStart, category, observation, evidence, confidence }) {
  const stmt = db.prepare(`
    INSERT INTO self_observations (week_start, category, observation, evidence, confidence)
    VALUES (?, ?, ?, ?, ?)
  `);
  const evidenceJson = evidence ? JSON.stringify(evidence) : null;
  const result = stmt.run(weekStart, category, observation, evidenceJson, confidence || 0.5);
  return result.lastInsertRowid;
}

/**
 * Get observations with optional filters
 * @param {Object} options - Filter options
 * @param {string} options.weekStart - Filter by week
 * @param {string} options.category - Filter by category
 * @param {string} options.feedback - Filter by feedback status (useful, not_useful, null for pending)
 * @param {number} options.limit - Max results (default 20)
 * @returns {Array} - Array of observation objects
 */
function getObservations(options = {}) {
  let sql = `SELECT * FROM self_observations WHERE 1=1`;
  const params = [];
  
  if (options.weekStart) {
    sql += ` AND week_start = ?`;
    params.push(options.weekStart);
  }
  
  if (options.category) {
    sql += ` AND category = ?`;
    params.push(options.category);
  }
  
  if (options.feedback !== undefined) {
    if (options.feedback === null || options.feedback === 'pending') {
      sql += ` AND feedback IS NULL`;
    } else {
      sql += ` AND feedback = ?`;
      params.push(options.feedback);
    }
  }
  
  sql += ` ORDER BY created_at DESC`;
  
  if (options.limit) {
    sql += ` LIMIT ?`;
    params.push(options.limit);
  } else {
    sql += ` LIMIT 20`;
  }
  
  const results = db.prepare(sql).all(...params);
  
  // Parse evidence JSON
  return results.map(r => ({
    ...r,
    evidence: r.evidence ? JSON.parse(r.evidence) : null
  }));
}

/**
 * Update feedback on an observation
 * @param {number} id - Observation ID
 * @param {string} feedback - 'useful' or 'not_useful'
 * @param {string} note - Optional feedback note
 * @returns {Object} - Run result
 */
function updateObservationFeedback(id, feedback, note = null) {
  if (!['useful', 'not_useful'].includes(feedback)) {
    throw new Error('Feedback must be "useful" or "not_useful"');
  }
  
  const stmt = db.prepare(`
    UPDATE self_observations 
    SET feedback = ?, feedback_note = ?
    WHERE id = ?
  `);
  return stmt.run(feedback, note, id);
}

/**
 * Get observation by ID
 * @param {number} id - Observation ID
 * @returns {Object|null} - Observation object or null
 */
function getObservation(id) {
  const result = db.prepare(`SELECT * FROM self_observations WHERE id = ?`).get(id);
  if (result && result.evidence) {
    result.evidence = JSON.parse(result.evidence);
  }
  return result;
}

/**
 * Get observation feedback statistics
 * @returns {Object} - Stats object with counts
 */
function getObservationStats() {
  const total = db.prepare(`SELECT COUNT(*) as count FROM self_observations`).get();
  const useful = db.prepare(`SELECT COUNT(*) as count FROM self_observations WHERE feedback = 'useful'`).get();
  const notUseful = db.prepare(`SELECT COUNT(*) as count FROM self_observations WHERE feedback = 'not_useful'`).get();
  const pending = db.prepare(`SELECT COUNT(*) as count FROM self_observations WHERE feedback IS NULL`).get();
  
  const byCategory = db.prepare(`
    SELECT category, COUNT(*) as count,
           SUM(CASE WHEN feedback = 'useful' THEN 1 ELSE 0 END) as useful,
           SUM(CASE WHEN feedback = 'not_useful' THEN 1 ELSE 0 END) as not_useful
    FROM self_observations
    GROUP BY category
  `).all();
  
  return {
    total: total.count,
    useful: useful.count,
    notUseful: notUseful.count,
    pending: pending.count,
    byCategory
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
  generateEmbedding,
  generateEmbeddingsBatch,
  getEmbeddingDimensions,
  addEmbeddingToMemory,
  generateAndStoreEmbedding,
  addMemoryEmbedding,
  getMemoryEmbedding,
  getMemoryEmbeddingDirect,
  searchMemoryByEmbedding,
  semanticSearchMemory,
  getMemoriesWithEmbeddings,
  updateMemoryWithEmbedding,
  cosineSimilarity,
  DEFAULT_EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
  // Pipeline
  createPipeline,
  getPipeline,
  listPipeline,
  updatePipeline,
  approvePipeline,
  getChildItems,
  getStoryStats,
  addPipelineTask,
  getPipelineTasks,
  updatePipelineTask,
  addPipelineNote,
  getPipelineNotes,
  // Pipeline V3 types
  PIPELINE_STAGES,
  validatePipelineStage,
  getDefaultStage,
  // Social Posts
  trackSocialPost,
  getRecentSocialPosts,
  checkSocialDuplicate,
  getSocialStats,
  // Content Pipeline
  addContentItem,
  getContentItems,
  getContentItem,
  updateContentItem,
  deleteContentItem,
  // Self-Observations
  addObservation,
  getObservations,
  getObservation,
  updateObservationFeedback,
  getObservationStats,
};
