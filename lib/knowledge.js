/**
 * Knowledge Cache Library
 * 
 * Stores and retrieves reusable knowledge (research findings, web summaries, facts)
 */

const { db } = require('./db');
const KnowledgeCache = require('./knowledge-cache');

/**
 * Add a new knowledge entry
 */
async function add({ 
  title, 
  summary, 
  sourceType = 'manual', 
  sourceUrl = null, 
  sourceSession = null, 
  tags = [], 
  entities = [], 
  confidence = 1.0, 
  expiresAt = null 
}) {
  const entry = await KnowledgeCache.add({
    title,
    summary,
    source_type: sourceType,
    source_url: sourceUrl,
    source_session: sourceSession,
    topic_tags: tags,
    entities,
    confidence,
    expires_at: expiresAt,
    generateEmbedding: true
  });
  
  return entry.id;
}

/**
 * Get a knowledge entry by ID
 */
function get(id) {
  const entry = KnowledgeCache.get(id);
  
  if (entry) {
    // Ensure consistent format
    entry.topic_tags = entry.topic_tags || [];
    entry.entities = entry.entities || [];
  }
  
  return entry;
}

/**
 * List knowledge entries with optional filters
 */
function list({ limit = 20, sourceType = null, verified = null, includeExpired = false } = {}) {
  const entries = KnowledgeCache.list(limit);
  
  // Apply filters
  let filtered = entries;
  
  if (sourceType) {
    filtered = filtered.filter(entry => entry.source_type === sourceType);
  }
  
  if (verified !== null) {
    filtered = filtered.filter(entry => entry.verified === (verified ? 1 : 0));
  }
  
  if (!includeExpired) {
    const now = new Date();
    filtered = filtered.filter(entry => {
      if (!entry.expires_at) return true;
      return new Date(entry.expires_at) > now;
    });
  }
  
  // Get full entries for filtered results
  return filtered.map(entry => {
    const fullEntry = KnowledgeCache.get(entry.id);
    return {
      ...fullEntry,
      topic_tags: fullEntry.topic_tags || [],
      entities: fullEntry.entities || []
    };
  });
}

/**
 * Search knowledge using FTS5 (keyword search)
 */
function search(query, { limit = 10, includeExpired = false } = {}) {
  try {
    const results = KnowledgeCache.search(query, {
      limit,
      include_expired: includeExpired
    });
    
    return results.map(entry => ({
      ...entry,
      topic_tags: entry.topic_tags || [],
      entities: entry.entities || []
    }));
  } catch (e) {
    console.warn('Search failed:', e.message);
    return [];
  }
}

/**
 * Semantic search using embeddings
 */
async function semanticSearch(query, options = {}) {
  try {
    const results = await KnowledgeCache.semanticSearch(query, {
      limit: options.limit || 10,
      include_expired: options.includeExpired || false,
      threshold: options.threshold || 0.7
    });
    
    return results.map(entry => ({
      ...entry,
      topic_tags: entry.topic_tags || [],
      entities: entry.entities || []
    }));
  } catch (e) {
    console.warn('Semantic search failed:', e.message);
    return [];
  }
}

/**
 * Update a knowledge entry (creates superseded link)
 */
async function update(id, { summary, tags, confidence, expiresAt, verified }) {
  const updates = {};
  
  if (summary !== undefined) {
    updates.summary = summary;
  }
  
  if (tags !== undefined) {
    updates.topic_tags = tags;
  }
  
  if (confidence !== undefined) {
    updates.confidence = confidence;
  }
  
  if (expiresAt !== undefined) {
    updates.expires_at = expiresAt;
  }
  
  if (verified !== undefined) {
    updates.verified = verified;
  }
  
  if (Object.keys(updates).length === 0) {
    return get(id);
  }
  
  const entry = await KnowledgeCache.update(id, updates);
  return entry;
}

/**
 * Mark an entry as verified
 */
async function verify(id) {
  return await KnowledgeCache.verify(id);
}

/**
 * Supersede an entry with a new one
 */
async function supersede(oldId, newEntry) {
  const newId = await add(newEntry);
  
  db.prepare(`
    UPDATE knowledge_cache SET superseded_by = ? WHERE id = ?
  `).run(newId, oldId);
  
  return newId;
}

/**
 * Delete a knowledge entry
 */
function remove(id) {
  const result = KnowledgeCache.delete(id);
  return result.changes > 0;
}

/**
 * Get stats about the knowledge cache
 */
function stats() {
  const total = db.prepare('SELECT COUNT(*) as count FROM knowledge_cache').get().count;
  const verified = db.prepare('SELECT COUNT(*) as count FROM knowledge_cache WHERE verified = 1').get().count;
  const expired = db.prepare("SELECT COUNT(*) as count FROM knowledge_cache WHERE expires_at IS NOT NULL AND expires_at < datetime('now')").get().count;
  const bySource = db.prepare(`
    SELECT source_type, COUNT(*) as count 
    FROM knowledge_cache 
    GROUP BY source_type
    ORDER BY count DESC
  `).all();
  
  return { total, verified, expired, bySource };
}

module.exports = {
  add,
  get,
  list,
  search,
  semanticSearch,
  update,
  verify,
  supersede,
  remove,
  stats
};
