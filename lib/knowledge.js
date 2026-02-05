/**
 * Knowledge Cache Library
 * 
 * Stores and retrieves reusable knowledge (research findings, web summaries, facts)
 */

const { db } = require('./db');

/**
 * Add a new knowledge entry
 */
function add({ title, summary, sourceType = 'manual', sourceUrl = null, sourceSession = null, tags = [], entities = [], confidence = 1.0, importance = 0.5, expiresAt = null }) {
  const stmt = db.prepare(`
    INSERT INTO knowledge_cache (
      title, summary, source_type, source_url, source_session,
      topic_tags, entities, confidence, importance, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const result = stmt.run(
    title,
    summary,
    sourceType,
    sourceUrl,
    sourceSession,
    JSON.stringify(tags),
    JSON.stringify(entities),
    confidence,
    importance,
    expiresAt
  );
  
  return result.lastInsertRowid;
}

/**
 * Get a knowledge entry by ID
 */
function get(id) {
  const entry = db.prepare(`
    SELECT * FROM knowledge_cache WHERE id = ?
  `).get(id);
  
  if (entry) {
    entry.topic_tags = JSON.parse(entry.topic_tags || '[]');
    entry.entities = JSON.parse(entry.entities || '[]');
  }
  
  return entry;
}

/**
 * List knowledge entries with optional filters
 */
function list({ limit = 20, sourceType = null, verified = null, includeExpired = false } = {}) {
  let sql = 'SELECT * FROM knowledge_cache WHERE 1=1';
  const params = [];
  
  if (!includeExpired) {
    sql += " AND (expires_at IS NULL OR expires_at > datetime('now'))";
  }
  
  if (sourceType) {
    sql += ' AND source_type = ?';
    params.push(sourceType);
  }
  
  if (verified !== null) {
    sql += ' AND verified = ?';
    params.push(verified ? 1 : 0);
  }
  
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);
  
  const entries = db.prepare(sql).all(...params);
  
  return entries.map(entry => ({
    ...entry,
    topic_tags: JSON.parse(entry.topic_tags || '[]'),
    entities: JSON.parse(entry.entities || '[]')
  }));
}

/**
 * Search knowledge using FTS5 (keyword search)
 */
function search(query, { limit = 10, includeExpired = false, weightByImportance = true } = {}) {
  try {
    // Escape query for FTS5
    const ftsQuery = query.split(/\s+/)
      .filter(term => term.length > 0)
      .map(term => `"${term}"*`)
      .join(' ');
    
    if (!ftsQuery) return [];
    
    // FTS5 rank is negative (more negative = better match)
    // We combine with importance: adjusted_score = rank * (1 + importance)
    let sql = `
      SELECT kc.*, fts.rank as relevance,
             (fts.rank * (1 + COALESCE(kc.importance, 0.5))) as weighted_score
      FROM knowledge_fts fts
      JOIN knowledge_cache kc ON fts.rowid = kc.id
      WHERE fts.knowledge_fts MATCH ?
    `;
    const params = [ftsQuery];
    
    if (!includeExpired) {
      sql += " AND (kc.expires_at IS NULL OR kc.expires_at > datetime('now'))";
    }
    
    // Order by weighted score if enabled, otherwise just relevance
    sql += weightByImportance ? ' ORDER BY weighted_score LIMIT ?' : ' ORDER BY fts.rank LIMIT ?';
    params.push(limit);
    
    const results = db.prepare(sql).all(...params);
    
    return results.map(entry => ({
      ...entry,
      topic_tags: JSON.parse(entry.topic_tags || '[]'),
      entities: JSON.parse(entry.entities || '[]')
    }));
  } catch (e) {
    console.warn('FTS search failed:', e.message);
    return [];
  }
}

/**
 * Update a knowledge entry
 */
function update(id, { summary, tags, confidence, importance, expiresAt, verified }) {
  const existing = get(id);
  if (!existing) {
    throw new Error(`Knowledge entry ${id} not found`);
  }
  
  const updates = [];
  const params = [];
  
  if (summary !== undefined) {
    updates.push('summary = ?');
    params.push(summary);
  }
  
  if (tags !== undefined) {
    updates.push('topic_tags = ?');
    params.push(JSON.stringify(tags));
  }
  
  if (confidence !== undefined) {
    updates.push('confidence = ?');
    params.push(confidence);
  }
  
  if (importance !== undefined) {
    updates.push('importance = ?');
    params.push(importance);
  }
  
  if (expiresAt !== undefined) {
    updates.push('expires_at = ?');
    params.push(expiresAt);
  }
  
  if (verified !== undefined) {
    updates.push('verified = ?');
    params.push(verified ? 1 : 0);
  }
  
  if (updates.length === 0) {
    return existing;
  }
  
  updates.push("updated_at = datetime('now')");
  params.push(id);
  
  db.prepare(`
    UPDATE knowledge_cache SET ${updates.join(', ')} WHERE id = ?
  `).run(...params);
  
  return get(id);
}

/**
 * Mark an entry as verified
 */
function verify(id) {
  return update(id, { verified: true });
}

/**
 * Supersede an entry with a new one
 */
function supersede(oldId, newEntry) {
  const newId = add(newEntry);
  
  db.prepare(`
    UPDATE knowledge_cache SET superseded_by = ? WHERE id = ?
  `).run(newId, oldId);
  
  return newId;
}

/**
 * Delete a knowledge entry
 */
function remove(id) {
  const result = db.prepare('DELETE FROM knowledge_cache WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * Get stats about the knowledge cache
 */
function stats() {
  const total = db.prepare('SELECT COUNT(*) as count FROM knowledge_cache').get().count;
  const verified = db.prepare('SELECT COUNT(*) as count FROM knowledge_cache WHERE verified = 1').get().count;
  const expired = db.prepare("SELECT COUNT(*) as count FROM knowledge_cache WHERE expires_at < datetime('now')").get().count;
  const bySource = db.prepare(`
    SELECT source_type, COUNT(*) as count 
    FROM knowledge_cache 
    GROUP BY source_type
  `).all();
  
  return { total, verified, expired, bySource };
}

module.exports = {
  add,
  get,
  list,
  search,
  update,
  verify,
  supersede,
  remove,
  stats
};
