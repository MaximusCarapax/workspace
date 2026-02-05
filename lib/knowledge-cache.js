const db = require('./db');
const { generateEmbedding } = require('./embeddings');

class KnowledgeCache {
    /**
     * Ensure tables exist
     */
    static init() {
        // Tables are created by db.js migrations
        // This method is kept for backward compatibility
    }

    /**
     * Add a knowledge entry
     */
    static async add({
        title,
        summary,
        source_type = 'manual',
        source_url = null,
        source_session = null,
        topic_tags = null,
        entities = null,
        confidence = 1.0,
        expires_at = null,
        verified = false,
        generateEmbedding: shouldGenerateEmbedding = true
    }) {
        // Generate embedding if requested
        let embedding = null;
        if (shouldGenerateEmbedding) {
            const textToEmbed = `${title} ${summary}`;
            try {
                embedding = await generateEmbedding(textToEmbed);
                // embedding is a Float32Array
            } catch (error) {
                console.warn('Failed to generate embedding:', error.message);
            }
        }

        // Convert arrays to JSON strings
        const tagsJson = topic_tags ? JSON.stringify(topic_tags) : null;
        const entitiesJson = entities ? JSON.stringify(entities) : null;

        const stmt = db.prepare(`
            INSERT INTO knowledge_cache (
                title, summary, source_type, source_url, source_session,
                topic_tags, entities, confidence, expires_at, verified, embedding
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const result = stmt.run(
            title, summary, source_type, source_url, source_session,
            tagsJson, entitiesJson, confidence, expires_at, verified,
            embedding ? Buffer.from(embedding.buffer) : null
        );

        return this.get(result.lastInsertRowid);
    }

    /**
     * Get knowledge entry by ID
     */
    static get(id) {
        const row = db.prepare(`
            SELECT * FROM knowledge_cache WHERE id = ?
        `).get(id);

        if (!row) return null;

        // Parse JSON fields
        return {
            ...row,
            topic_tags: row.topic_tags ? JSON.parse(row.topic_tags) : null,
            entities: row.entities ? JSON.parse(row.entities) : null,
            embedding: row.embedding ? new Float32Array(row.embedding.buffer) : null
        };
    }

    /**
     * Update knowledge entry
     */
    static async update(id, updates) {
        const current = this.get(id);
        if (!current) {
            throw new Error(`Knowledge entry ${id} not found`);
        }

        const allowedFields = [
            'title', 'summary', 'source_type', 'source_url', 'source_session',
            'topic_tags', 'entities', 'confidence', 'expires_at', 'verified'
        ];

        const updateFields = {};
        for (const field of allowedFields) {
            if (field in updates) {
                updateFields[field] = updates[field];
            }
        }

        // Handle JSON fields
        if (updateFields.topic_tags && Array.isArray(updateFields.topic_tags)) {
            updateFields.topic_tags = JSON.stringify(updateFields.topic_tags);
        }
        if (updateFields.entities && Array.isArray(updateFields.entities)) {
            updateFields.entities = JSON.stringify(updateFields.entities);
        }

        // Generate new embedding if title or summary changed
        let embedding = current.embedding;
        if (updates.title || updates.summary) {
            const textToEmbed = `${updates.title || current.title} ${updates.summary || current.summary}`;
            try {
                embedding = await generateEmbedding(textToEmbed);
                // embedding is a Float32Array
            } catch (error) {
                console.warn('Failed to generate embedding:', error.message);
            }
        }

        // Build SET clause
        const setClause = Object.keys(updateFields)
            .map(field => `${field} = ?`)
            .concat(embedding ? 'embedding = ?' : [])
            .concat('updated_at = CURRENT_TIMESTAMP')
            .join(', ');

        const values = Object.values(updateFields);
        if (embedding) {
            values.push(Buffer.from(embedding.buffer));
        }

        values.push(id);

        const stmt = db.prepare(`
            UPDATE knowledge_cache 
            SET ${setClause}
            WHERE id = ?
        `);

        stmt.run(...values);

        return this.get(id);
    }

    /**
     * Delete knowledge entry
     */
    static delete(id) {
        return db.prepare('DELETE FROM knowledge_cache WHERE id = ?').run(id);
    }

    /**
     * Search knowledge entries
     */
    static search(query, options = {}) {
        const {
            limit = 10,
            offset = 0,
            source_type = null,
            min_confidence = 0.0,
            include_expired = false
        } = options;

        let whereClauses = ['1=1'];
        let params = [];

        if (query) {
            // Check if FTS5 table exists
            try {
                const ftsExists = db.prepare(`
                    SELECT name FROM sqlite_master 
                    WHERE type='table' AND name='knowledge_fts'
                `).get();
                
                if (ftsExists) {
                    // Escape special FTS5 characters and prepare query
                    // FTS5 special characters: " ( ) * + - : ; < = > ? [ ] ^ { | } ~
                    const escapedQuery = query.replace(/["()*+\-:;<=>?[\]^{|}~]/g, ' ');
                    // Use FTS for text search
                    whereClauses.push(`
                        id IN (
                            SELECT rowid FROM knowledge_fts 
                            WHERE knowledge_fts MATCH ?
                            ORDER BY rank
                        )
                    `);
                    params.push(escapedQuery);
                } else {
                    // Fall back to simple LIKE search
                    whereClauses.push('(title LIKE ? OR summary LIKE ?)');
                    params.push(`%${query}%`, `%${query}%`);
                }
            } catch (error) {
                // Fall back to simple LIKE search
                whereClauses.push('(title LIKE ? OR summary LIKE ?)');
                params.push(`%${query}%`, `%${query}%`);
            }
        }

        if (source_type) {
            whereClauses.push('source_type = ?');
            params.push(source_type);
        }

        whereClauses.push('confidence >= ?');
        params.push(min_confidence);

        if (!include_expired) {
            whereClauses.push('(expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)');
        }

        const where = whereClauses.join(' AND ');

        const rows = db.prepare(`
            SELECT * FROM knowledge_cache 
            WHERE ${where}
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        `).all(...params, limit, offset);

        return rows.map(row => ({
            ...row,
            topic_tags: row.topic_tags ? JSON.parse(row.topic_tags) : null,
            entities: row.entities ? JSON.parse(row.entities) : null
        }));
    }

    /**
     * List recent knowledge entries
     */
    static list(limit = 50) {
        const rows = db.prepare(`
            SELECT id, title, source_type, created_at, verified 
            FROM knowledge_cache 
            ORDER BY created_at DESC 
            LIMIT ?
        `).all(limit);

        return rows;
    }

    /**
     * Mark entry as verified
     */
    static verify(id) {
        return this.update(id, { verified: true });
    }

    /**
     * Supersede entry with a new one
     */
    static async supersede(oldId, newEntryData) {
        const newEntry = await this.add(newEntryData);
        db.prepare(`
            UPDATE knowledge_cache 
            SET superseded_by = ? 
            WHERE id = ?
        `).run(newEntry.id, oldId);
        return newEntry;
    }

    /**
     * Calculate cosine similarity between two vectors
     */
    static cosineSimilarity(a, b) {
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

    /**
     * Semantic search using embeddings
     */
    static async semanticSearch(query, options = {}) {
        const {
            limit = 10,
            min_confidence = 0.0,
            include_expired = false,
            threshold = 0.7
        } = options;

        // Generate embedding for the query
        const queryEmbedding = await generateEmbedding(query);
        
        // Get knowledge entries with embeddings, but limit to a reasonable number
        // to avoid processing too many entries
        let whereClauses = ['embedding IS NOT NULL'];
        let params = [];

        if (!include_expired) {
            whereClauses.push('(expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)');
        }

        whereClauses.push('confidence >= ?');
        params.push(min_confidence);

        const where = whereClauses.join(' AND ');

        // Get a reasonable number of entries to process
        // We'll fetch more than the limit to ensure we have enough after filtering
        // Also, prioritize verified entries and those with higher confidence
        const fetchLimit = Math.min(limit * 10, 1000);
        
        const rows = db.prepare(`
            SELECT * FROM knowledge_cache 
            WHERE ${where}
            ORDER BY verified DESC, confidence DESC, created_at DESC
            LIMIT ?
        `).all(...params, fetchLimit);

        // If no rows with embeddings, return empty
        if (rows.length === 0) {
            return [];
        }

        // Calculate cosine similarity for each entry
        const results = rows.map(row => {
            const storedEmbedding = new Float32Array(row.embedding.buffer);
            const similarity = this.cosineSimilarity(queryEmbedding, storedEmbedding);
            
            // Calculate a combined score that considers both similarity and confidence
            // Weight: 70% similarity, 30% confidence
            const combinedScore = (similarity * 0.7) + (row.confidence * 0.3);
            
            return {
                ...row,
                similarity,
                combinedScore,
                topic_tags: row.topic_tags ? JSON.parse(row.topic_tags) : null,
                entities: row.entities ? JSON.parse(row.entities) : null
            };
        });

        // Filter by threshold and sort by combined score
        return results
            .filter(r => r.similarity >= threshold)
            .sort((a, b) => b.combinedScore - a.combinedScore)
            .slice(0, limit);
    }

    /**
     * Get statistics about the knowledge cache
     */
    static stats() {
        const total = db.prepare('SELECT COUNT(*) as count FROM knowledge_cache').get().count;
        const withEmbeddings = db.prepare('SELECT COUNT(*) as count FROM knowledge_cache WHERE embedding IS NOT NULL').get().count;
        const verified = db.prepare('SELECT COUNT(*) as count FROM knowledge_cache WHERE verified = 1').get().count;
        const expired = db.prepare("SELECT COUNT(*) as count FROM knowledge_cache WHERE expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP").get().count;
        
        const bySource = db.prepare(`
            SELECT source_type, COUNT(*) as count 
            FROM knowledge_cache 
            GROUP BY source_type 
            ORDER BY count DESC
        `).all();
        
        const recentActivity = db.prepare(`
            SELECT 
                DATE(created_at) as date,
                COUNT(*) as count
            FROM knowledge_cache
            WHERE created_at > DATE('now', '-7 days')
            GROUP BY DATE(created_at)
            ORDER BY date DESC
        `).all();
        
        return {
            total,
            withEmbeddings,
            verified,
            expired,
            bySource,
            recentActivity
        };
    }
}

// Initialize tables when module is loaded
KnowledgeCache.init();

module.exports = KnowledgeCache;
