#!/usr/bin/env node

/**
 * Session Memory CLI Tool
 * 
 * Chunks and indexes OpenClaw session JSONL files for semantic search.
 * 
 * Usage:
 *   node tools/session-memory.js chunk --all
 *   node tools/session-memory.js chunk --session <id>
 *   node tools/session-memory.js validate <file>
 *   node tools/session-memory.js status
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { program } = require('commander');
const db = require('../lib/db');
const creds = require('../lib/credentials');

// For topic extraction and context generation
let gemini;
try {
    gemini = require('./gemini');
} catch (e) {
    console.warn('Gemini module not available, topic extraction will be limited:', e.message);
}

// OpenRouter API key for context generation
let OPENROUTER_KEY = null;
try {
    const envPath = path.join(__dirname, '..', '.env');
    if (fs.existsSync(envPath)) {
        const env = fs.readFileSync(envPath, 'utf8');
        const orMatch = env.match(/OPENROUTER_API_KEY=(.+)/m);
        if (orMatch) OPENROUTER_KEY = orMatch[1].trim();
    }
    if (!OPENROUTER_KEY) {
        const secrets = JSON.parse(fs.readFileSync(path.join(process.env.HOME, '.openclaw/secrets/openrouter.json')));
        OPENROUTER_KEY = secrets.api_key;
    }
} catch (e) {
    // Will be loaded on demand
}

/**
 * Generate contextual prefix for a chunk using Gemini via OpenRouter
 * Returns ~50 token context string describing who/what/when
 * 
 * @param {Object} chunk - Chunk with content, timestamp, speakers, session_id
 * @returns {Promise<{context: string, status: string}>}
 */
async function generateChunkContext(chunk) {
    // Load OpenRouter key if not already loaded
    if (!OPENROUTER_KEY) {
        try {
            const secrets = JSON.parse(fs.readFileSync(path.join(process.env.HOME, '.openclaw/secrets/openrouter.json')));
            OPENROUTER_KEY = secrets.api_key;
        } catch (e) {
            return { context: null, status: 'failed' };
        }
    }
    
    if (!OPENROUTER_KEY) {
        console.warn('OpenRouter API key not found, skipping context generation');
        return { context: null, status: 'failed' };
    }
    
    // Parse metadata
    const speakers = typeof chunk.speakers === 'string' ? JSON.parse(chunk.speakers) : (chunk.speakers || []);
    const speakerNames = speakers.map(s => s === 'user' ? 'Jason' : 'Max').join(' and ');
    
    let dateStr = 'unknown date';
    try {
        const date = new Date(chunk.timestamp);
        dateStr = date.toLocaleDateString('en-AU', { 
            weekday: 'long',
            year: 'numeric', 
            month: 'long', 
            day: 'numeric',
            timeZone: 'Australia/Melbourne'
        });
    } catch (e) {}
    
    // Build prompt from spec
    const prompt = `Given this chunk from a conversation transcript, write a brief context (1-2 sentences, ~50 tokens max) that explains:
- Who is speaking (if identifiable)
- What topic/decision this relates to
- When this occurred (if timestamp available)

Session: ${chunk.session_id || 'unknown'}
Date: ${dateStr}
Participants: ${speakerNames || 'Unknown'}

Chunk:
${chunk.content.substring(0, 1500)}

Context (be concise, 1-2 sentences):`;

    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENROUTER_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://openclaw.ai',
                'X-Title': 'OpenClaw Context Generation'
            },
            body: JSON.stringify({
                model: 'google/gemini-2.5-flash-lite',  // Cheapest option
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 100,  // Cap output to ~50-75 tokens
                temperature: 0.3  // More deterministic
            })
        });

        if (!response.ok) {
            const error = await response.text();
            console.warn(`OpenRouter error for chunk context: ${response.status} - ${error}`);
            return { context: null, status: 'failed' };
        }

        const data = await response.json();
        const contextText = data.choices?.[0]?.message?.content?.trim();
        
        if (!contextText) {
            return { context: null, status: 'failed' };
        }
        
        // Log usage for cost tracking
        const usage = data.usage || {};
        const cost = ((usage.prompt_tokens || 0) * 0.075 + (usage.completion_tokens || 0) * 0.30) / 1_000_000;
        
        try {
            const dbModule = require('../lib/db');
            dbModule.logUsage({
                model: 'google/gemini-2.5-flash-lite',
                provider: 'openrouter',
                tokensIn: usage.prompt_tokens || 0,
                tokensOut: usage.completion_tokens || 0,
                costUsd: cost,
                taskType: 'tool',
                taskDetail: 'session-memory context generation'
            });
        } catch (e) {}
        
        return { 
            context: `[Context: ${contextText}]`, 
            status: 'complete' 
        };
        
    } catch (error) {
        console.warn(`Context generation failed: ${error.message}`);
        return { context: null, status: 'failed' };
    }
}

// For embeddings
let openai;
try {
    const { OpenAI } = require('openai');
    openai = new OpenAI();
} catch (e) {
    console.warn('OpenAI module not available, embeddings will not work:', e.message);
}

// For embeddings
let sqliteVec;
try {
    sqliteVec = require('sqlite-vec');
} catch (e) {
    console.warn('sqlite-vec not available:', e.message);
}

// Constants from spec
const MAX_CHUNK_SIZE = 500; // tokens (~2000 chars)
const BATCH_SIZE = 100;
const MAX_CHUNKS_PER_SESSION = 2000;
const SESSIONS_DIR = '/home/node/.openclaw/agents/main/sessions';

class SessionMemoryError extends Error {
    constructor(type, message, details = {}, recoverable = true) {
        super(message);
        this.type = type;
        this.details = details;
        this.recoverable = recoverable;
    }
}

class SessionValidator {
    static validateSessionFile(filepath) {
        const result = { valid: true, errors: [], warnings: [] };
        
        try {
            if (!fs.existsSync(filepath)) {
                result.valid = false;
                result.errors.push(`File does not exist: ${filepath}`);
                return result;
            }
            
            const stats = fs.statSync(filepath);
            if (!stats.isFile()) {
                result.valid = false;
                result.errors.push(`Path is not a file: ${filepath}`);
                return result;
            }
            
            const content = fs.readFileSync(filepath, 'utf8');
            const lines = content.split('\n').filter(line => line.trim());
            
            for (let i = 0; i < lines.length; i++) {
                const lineNum = i + 1;
                
                try {
                    const obj = JSON.parse(lines[i]);
                    
                    // Validate required fields for messages
                    if (obj.type === 'message') {
                        if (!obj.message?.role) {
                            result.warnings.push(`Line ${lineNum}: Missing role in message`);
                        }
                        if (!obj.message?.content) {
                            result.warnings.push(`Line ${lineNum}: Missing content in message`);
                        }
                        if (!obj.timestamp) {
                            result.warnings.push(`Line ${lineNum}: Missing timestamp`);
                        }
                    }
                } catch (parseError) {
                    result.valid = false;
                    result.errors.push(`Line ${lineNum}: Invalid JSON - ${parseError.message}`);
                }
            }
            
        } catch (error) {
            result.valid = false;
            result.errors.push(`Error reading file: ${error.message}`);
        }
        
        return result;
    }
}

class SessionChunker {
    constructor() {
        this.chunkId = 0;
    }
    
    static estimateTokens(text) {
        // Rough estimation: ~4 characters per token
        return Math.ceil(text.length / 4);
    }
    
    extractMessages(sessionData) {
        const messages = [];
        
        for (const line of sessionData) {
            if (line.type === 'message' && line.message) {
                messages.push({
                    role: line.message.role,
                    content: this.extractTextContent(line.message.content),
                    timestamp: line.timestamp
                });
            }
        }
        
        return messages;
    }
    
    extractTextContent(content) {
        if (typeof content === 'string') {
            return content;
        }
        
        if (Array.isArray(content)) {
            return content
                .filter(item => item.type === 'text')
                .map(item => item.text)
                .join(' ');
        }
        
        return '';
    }
    
    chunkByExchange(messages) {
        const chunks = [];
        let i = 0;
        
        while (i < messages.length) {
            const userMsg = messages[i];
            const assistantMsg = messages[i + 1];
            
            // Skip if not a proper exchange
            if (!userMsg || userMsg.role !== 'user') {
                i++;
                continue;
            }
            
            // Create exchange chunk
            let exchangeText = `User: ${userMsg.content}`;
            let speakers = ['user'];
            let timestamp = userMsg.timestamp;
            
            if (assistantMsg && assistantMsg.role === 'assistant') {
                exchangeText += `\nAssistant: ${assistantMsg.content}`;
                speakers.push('assistant');
                i += 2; // Skip both messages
            } else {
                i++; // Skip just the user message
            }
            
            const tokenCount = SessionChunker.estimateTokens(exchangeText);
            
            // If exchange is too large, split it
            if (tokenCount > MAX_CHUNK_SIZE) {
                const subChunks = this.splitLargeExchange(exchangeText, speakers, timestamp);
                chunks.push(...subChunks);
            } else {
                chunks.push({
                    content: exchangeText,
                    speakers,
                    timestamp,
                    token_count: tokenCount,
                    chunk_index: this.chunkId++
                });
            }
        }
        
        return chunks;
    }
    
    splitLargeExchange(text, speakers, timestamp) {
        const chunks = [];
        const targetSize = MAX_CHUNK_SIZE * 4; // Convert tokens to chars
        const sentences = text.split(/[.!?]+/).filter(s => s.trim());
        
        let currentChunk = '';
        let overlapBuffer = '';
        
        for (const sentence of sentences) {
            const proposedChunk = currentChunk + sentence + '.';
            
            if (proposedChunk.length > targetSize && currentChunk) {
                // Add overlap from previous chunk
                const finalChunk = overlapBuffer + currentChunk;
                chunks.push({
                    content: finalChunk.trim(),
                    speakers,
                    timestamp,
                    token_count: SessionChunker.estimateTokens(finalChunk),
                    chunk_index: this.chunkId++
                });
                
                // Set overlap buffer (last ~50 chars)
                overlapBuffer = currentChunk.slice(-50) + ' ';
                currentChunk = sentence + '.';
            } else {
                currentChunk = proposedChunk;
            }
        }
        
        // Add final chunk
        if (currentChunk) {
            const finalChunk = overlapBuffer + currentChunk;
            chunks.push({
                content: finalChunk.trim(),
                speakers,
                timestamp,
                token_count: SessionChunker.estimateTokens(finalChunk),
                chunk_index: this.chunkId++
            });
        }
        
        return chunks;
    }
    
    async extractTopics(content) {
        // Use simple keyword extraction (no external API dependencies)
        // This is fast, free, and reliable
        const keywords = this.extractKeywords(content);
        return keywords.slice(0, 3); // Max 3 topics
    }
    
    extractKeywords(text) {
        // Simple keyword extraction
        const commonWords = new Set(['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'can', 'may', 'might', 'must', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'this', 'that', 'these', 'those']);
        
        const words = text.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(word => word.length > 3 && !commonWords.has(word));
            
        const wordCount = {};
        words.forEach(word => {
            wordCount[word] = (wordCount[word] || 0) + 1;
        });
        
        return Object.entries(wordCount)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 5)
            .map(([word]) => word);
    }
    
    detectDecisions(content) {
        const decisionWords = ['decided', 'choose', 'conclude', 'resolve', 'determine', 'agree', 'final'];
        return decisionWords.some(word => content.toLowerCase().includes(word));
    }
    
    detectActions(content) {
        const actionWords = ['todo', 'action', 'implement', 'build', 'create', 'task', 'need to'];
        return actionWords.some(word => content.toLowerCase().includes(word));
    }
    
    createContextContent(chunkContent, metadata) {
        const { session_id, timestamp, speakers, topic_tags } = metadata;
        const date = new Date(timestamp).toLocaleString('en-US', {
            timeZone: 'Australia/Melbourne',
            dateStyle: 'full',
            timeStyle: 'short'
        });
        
        const speakerNames = speakers.map(s => s === 'user' ? 'Jason' : 'Max').join(' and ');
        const topics = topic_tags ? topic_tags.join(', ') : 'general discussion';
        
        return `[Session from ${date} Melbourne time]
[Participants: ${speakerNames}]
[Topics: ${topics}]
[Context: Exchange about ${topic_tags && topic_tags.length > 0 ? topic_tags[0] : 'various topics'}]

${chunkContent}`;
    }
    
    async processSession(sessionId, sessionData, options = {}) {
        console.log(`Processing session: ${sessionId}`);
        
        const messages = this.extractMessages(sessionData);
        const chunks = this.chunkByExchange(messages);
        
        if (chunks.length > MAX_CHUNKS_PER_SESSION) {
            console.warn(`Warning: Session ${sessionId} has ${chunks.length} chunks, capping at ${MAX_CHUNKS_PER_SESSION}`);
            chunks.splice(MAX_CHUNKS_PER_SESSION);
        }
        
        const generateContext = options.generateContext !== false; // Default to true
        
        // Process chunks in batches
        const results = [];
        for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
            const batch = chunks.slice(i, i + BATCH_SIZE);
            
            for (const chunk of batch) {
                // Extract metadata
                const topicTags = await this.extractTopics(chunk.content);
                const hasDecision = this.detectDecisions(chunk.content);
                const hasAction = this.detectActions(chunk.content);
                
                // Generate LLM context prefix if enabled
                let contextPrefix = null;
                let contextStatus = 'pending';
                
                if (generateContext) {
                    const contextResult = await generateChunkContext({
                        content: chunk.content,
                        timestamp: chunk.timestamp,
                        speakers: chunk.speakers,
                        session_id: sessionId
                    });
                    contextPrefix = contextResult.context;
                    contextStatus = contextResult.status;
                }
                
                // Create context content (legacy field, still useful)
                const contextContent = this.createContextContent(chunk.content, {
                    session_id: sessionId,
                    timestamp: chunk.timestamp,
                    speakers: chunk.speakers,
                    topic_tags: topicTags
                });
                
                const chunkData = {
                    session_id: sessionId,
                    chunk_index: chunk.chunk_index,
                    timestamp: chunk.timestamp,
                    speakers: JSON.stringify(chunk.speakers),
                    topic_tags: JSON.stringify(topicTags),
                    has_decision: hasDecision ? 1 : 0,
                    has_action: hasAction ? 1 : 0,
                    content: chunk.content,
                    context_content: contextContent,
                    context_prefix: contextPrefix,
                    context_status: contextStatus,
                    token_count: chunk.token_count
                };
                
                results.push(chunkData);
            }
            
            // Yield control between batches
            if (i + BATCH_SIZE < chunks.length) {
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        }
        
        return results;
    }
}

class EmbeddingGenerator {
    constructor() {
        this.openaiApiKey = creds.get('openai');
        if (!this.openaiApiKey) {
            throw new Error('OpenAI API key not found in credentials');
        }
    }
    
    async generateEmbedding(text) {
        try {
            const response = await fetch('https://api.openai.com/v1/embeddings', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.openaiApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    input: text,
                    model: 'text-embedding-3-small',
                    dimensions: 1536
                })
            });
            
            if (!response.ok) {
                throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
            }
            
            const data = await response.json();
            return data.data[0].embedding;
        } catch (error) {
            console.error('Error generating embedding:', error.message);
            throw error;
        }
    }
    
    async generateBatchEmbeddings(texts, batchSize = 100) {
        const embeddings = [];
        
        for (let i = 0; i < texts.length; i += batchSize) {
            const batch = texts.slice(i, i + batchSize);
            
            try {
                const response = await fetch('https://api.openai.com/v1/embeddings', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.openaiApiKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        input: batch,
                        model: 'text-embedding-3-small',
                        dimensions: 1536
                    })
                });
                
                if (!response.ok) {
                    throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
                }
                
                const data = await response.json();
                embeddings.push(...data.data.map(item => item.embedding));
                
                console.log(`Generated embeddings for batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(texts.length / batchSize)}`);
                
                // Rate limiting - wait between batches
                if (i + batchSize < texts.length) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            } catch (error) {
                console.error(`Error in batch ${Math.floor(i / batchSize) + 1}:`, error.message);
                // Fill with nulls for failed embeddings
                for (let j = 0; j < batch.length; j++) {
                    embeddings.push(null);
                }
            }
        }
        
        return embeddings;
    }
    
    embeddingToBuffer(embedding) {
        if (!embedding) return null;
        const buffer = Buffer.alloc(embedding.length * 4);
        for (let i = 0; i < embedding.length; i++) {
            buffer.writeFloatLE(embedding[i], i * 4);
        }
        return buffer;
    }
    
    bufferToEmbedding(buffer) {
        if (!buffer) return null;
        const embedding = [];
        for (let i = 0; i < buffer.length; i += 4) {
            embedding.push(buffer.readFloatLE(i));
        }
        return embedding;
    }
}

async function createTables() {
    const dbPath = path.join(process.env.HOME, '.openclaw/data/agent.db');
    
    // Ensure database exists
    if (!fs.existsSync(path.dirname(dbPath))) {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    
    // Create tables (using existing db module pattern)
    const Database = require('better-sqlite3');
    const sqlite = new Database(dbPath);
    
    // Load sqlite-vec extension if available
    if (sqliteVec) {
        try {
            sqliteVec.load(sqlite);
            console.log('✓ sqlite-vec extension loaded');
        } catch (e) {
            console.warn('Failed to load sqlite-vec extension:', e.message);
        }
    }
    
    // Create session_chunks table with all required columns from spec
    sqlite.exec(`
        CREATE TABLE IF NOT EXISTS session_chunks (
            id INTEGER PRIMARY KEY,
            session_id TEXT NOT NULL,
            chunk_index INTEGER NOT NULL,
            timestamp DATETIME NOT NULL,
            speakers TEXT,
            topic_tags TEXT,
            has_decision INTEGER DEFAULT 0,
            has_action INTEGER DEFAULT 0,
            content TEXT NOT NULL,
            context_content TEXT,
            context_prefix TEXT,
            context_status TEXT DEFAULT 'pending',
            token_count INTEGER,
            embedding BLOB,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(session_id, chunk_index)
        )
    `);
    
    // Migration: Add context columns if they don't exist (for existing databases)
    try {
        sqlite.exec(`ALTER TABLE session_chunks ADD COLUMN context_prefix TEXT`);
        console.log('✓ Added context_prefix column');
    } catch (e) {
        // Column already exists, ignore
    }
    try {
        sqlite.exec(`ALTER TABLE session_chunks ADD COLUMN context_status TEXT DEFAULT 'pending'`);
        console.log('✓ Added context_status column');
    } catch (e) {
        // Column already exists, ignore
    }
    
    // Create sqlite-vec virtual table for vector search if extension is loaded
    if (sqliteVec) {
        try {
            sqlite.exec(`
                CREATE VIRTUAL TABLE IF NOT EXISTS session_embeddings USING vec0(
                    chunk_id INTEGER PRIMARY KEY,
                    embedding FLOAT[1536]
                )
            `);
            console.log('✓ Vector search table created');
        } catch (e) {
            console.warn('Failed to create vector search table:', e.message);
        }
    }
    
    // Create FTS5 virtual table for BM25 search
    try {
        sqlite.exec(`
            CREATE VIRTUAL TABLE IF NOT EXISTS session_chunks_fts USING fts5(
                chunk_id UNINDEXED,
                content,
                tokenize = 'porter'
            )
        `);
        console.log('✓ FTS5 table created for BM25 search');
        
        // Populate FTS5 table with existing chunks if empty
        const ftsCount = sqlite.prepare('SELECT COUNT(*) as count FROM session_chunks_fts').get()?.count || 0;
        if (ftsCount === 0) {
            const chunkCount = sqlite.prepare('SELECT COUNT(*) as count FROM session_chunks').get()?.count || 0;
            if (chunkCount > 0) {
                console.log(`Populating FTS5 table with ${chunkCount} existing chunks...`);
                sqlite.exec(`
                    INSERT INTO session_chunks_fts (chunk_id, content)
                    SELECT id, content FROM session_chunks
                `);
                console.log('✓ FTS5 table populated');
            }
        }
    } catch (e) {
        console.warn('Failed to create or populate FTS5 table:', e.message);
    }
    
    // Create session_index_state table for tracking
    sqlite.exec(`
        CREATE TABLE IF NOT EXISTS session_index_state (
            session_id TEXT PRIMARY KEY,
            file_path TEXT NOT NULL,
            file_hash TEXT NOT NULL,
            last_indexed DATETIME NOT NULL,
            chunk_count INTEGER NOT NULL,
            status TEXT NOT NULL
        )
    `);
    
    sqlite.exec(`
        CREATE INDEX IF NOT EXISTS idx_chunks_timestamp ON session_chunks(timestamp)
    `);
    
    sqlite.exec(`
        CREATE INDEX IF NOT EXISTS idx_chunks_session ON session_chunks(session_id)
    `);
    
    sqlite.close();
}

async function chunkCommand(options) {
    try {
        await createTables();
        
        const chunker = new SessionChunker();
        
        if (options.all) {
            console.log('Chunking all sessions...');
            const sessionFiles = fs.readdirSync(SESSIONS_DIR)
                .filter(file => file.endsWith('.jsonl'));
                
            for (const file of sessionFiles) {
                const sessionId = path.basename(file, '.jsonl');
                await processSessionFile(chunker, sessionId, path.join(SESSIONS_DIR, file));
            }
        } else if (options.session) {
            console.log(`Chunking session: ${options.session}`);
            const sessionFile = path.join(SESSIONS_DIR, `${options.session}.jsonl`);
            await processSessionFile(chunker, options.session, sessionFile);
        } else {
            console.error('Either --all or --session <id> must be specified');
            process.exit(1);
        }
        
        console.log('Chunking completed successfully!');
    } catch (error) {
        console.error('Error during chunking:', error.message);
        process.exit(1);
    }
}

function computeFileHash(filepath) {
    const content = fs.readFileSync(filepath, 'utf8');
    return crypto.createHash('sha256').update(content).digest('hex');
}


async function processSessionFile(chunker, sessionId, filepath) {
    // Validate file
    const validation = SessionValidator.validateSessionFile(filepath);
    if (!validation.valid) {
        console.error(`Validation failed for ${sessionId}:`, validation.errors.join(', '));
        return;
    }
    
    if (validation.warnings.length > 0) {
        console.warn(`Warnings for ${sessionId}:`, validation.warnings.join(', '));
    }
    
    // Open database early for hash check
    const Database = require('better-sqlite3');
    const dbPath = path.join(process.env.HOME, '.openclaw/data/agent.db');
    const sqlite = new Database(dbPath);
    
    // 1. HASH CHECK - skip unchanged files
    const currentHash = computeFileHash(filepath);
    const existingState = sqlite.prepare('SELECT file_hash, chunk_count FROM session_index_state WHERE session_id = ?').get(sessionId);
    
    if (existingState && existingState.file_hash === currentHash) {
        console.log(`Skipping ${sessionId} - unchanged (${existingState.chunk_count} chunks already indexed)`);
        sqlite.close();
        return;
    }
    
    // Read and parse session data
    const content = fs.readFileSync(filepath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());
    const sessionData = [];
    
    for (const line of lines) {
        try {
            sessionData.push(JSON.parse(line));
        } catch (error) {
            // Skip invalid lines (already warned about in validation)
            continue;
        }
    }
    
    // 2. INCREMENTAL CHUNKING - only process new messages
    // Get the last chunk's timestamp and index for this session
    const lastChunk = sqlite.prepare(`
        SELECT MAX(chunk_index) as last_index, MAX(timestamp) as last_timestamp 
        FROM session_chunks 
        WHERE session_id = ?
    `).get(sessionId);
    
    const lastTimestamp = lastChunk?.last_timestamp || null;
    const lastIndex = lastChunk?.last_index ?? -1;
    
    // Filter session data to only new messages (after last indexed timestamp)
    let newSessionData = sessionData;
    if (lastTimestamp) {
        newSessionData = sessionData.filter(item => {
            if (item.type !== 'message' || !item.timestamp) return false;
            return item.timestamp > lastTimestamp;
        });
        
        if (newSessionData.length === 0) {
            // Hash changed but no new messages - might be metadata change, update hash only
            console.log(`${sessionId} - file changed but no new messages, updating hash`);
            const now = new Date().toISOString();
            sqlite.prepare(`
                UPDATE session_index_state 
                SET file_hash = ?, last_indexed = ?
                WHERE session_id = ?
            `).run(currentHash, now, sessionId);
            sqlite.close();
            return;
        }
        
        console.log(`${sessionId} - found ${newSessionData.length} new messages (after ${lastTimestamp})`);
    }
    
    // Reset chunker's chunkId to continue from last index
    chunker.chunkId = lastIndex + 1;
    
    // Process only new messages
    const newChunks = await chunker.processSession(sessionId, newSessionData);
    
    if (newChunks.length === 0) {
        console.log(`${sessionId} - no new chunks generated`);
        // Still update the hash
        const now = new Date().toISOString();
        sqlite.prepare(`
            UPDATE session_index_state 
            SET file_hash = ?, last_indexed = ?
            WHERE session_id = ?
        `).run(currentHash, now, sessionId);
        sqlite.close();
        return;
    }
    
    // 3. INSERT NEW CHUNKS (don't delete existing!)
    const insertStmt = sqlite.prepare(`
        INSERT INTO session_chunks 
        (session_id, chunk_index, timestamp, speakers, topic_tags, has_decision, has_action, content, context_content, context_prefix, context_status, token_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        
    // Prepare FTS5 insert statement
    const insertFtsStmt = sqlite.prepare(`
        INSERT INTO session_chunks_fts (chunk_id, content)
        VALUES (?, ?)
    `);
        
    let contextComplete = 0;
    let contextFailed = 0;
        
    for (const chunk of newChunks) {
        // Insert into main table
        const result = insertStmt.run(
            chunk.session_id,
            chunk.chunk_index,
            chunk.timestamp,
            chunk.speakers,
            chunk.topic_tags,
            chunk.has_decision,
            chunk.has_action,
            chunk.content,
            chunk.context_content || chunk.content,
            chunk.context_prefix,
            chunk.context_status || 'pending',
            chunk.token_count
        );
            
        const chunkId = result.lastInsertRowid;
            
        // Insert into FTS5 table for BM25 search
        try {
            insertFtsStmt.run(chunkId, chunk.content);
        } catch (e) {
            console.warn(`Failed to insert into FTS5 table for chunk ${chunkId}:`, e.message);
        }
            
        if (chunk.context_status === 'complete') contextComplete++;
        if (chunk.context_status === 'failed') contextFailed++;
    }
    
    // 4. UPDATE INDEX STATE - track total chunks
    const totalChunks = sqlite.prepare('SELECT COUNT(*) as count FROM session_chunks WHERE session_id = ?').get(sessionId)?.count || 0;
    
    const now = new Date().toISOString();
    const upsertStmt = sqlite.prepare(`
        INSERT INTO session_index_state (session_id, file_path, file_hash, last_indexed, chunk_count, status)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
            file_hash = excluded.file_hash,
            last_indexed = excluded.last_indexed,
            chunk_count = excluded.chunk_count,
            status = excluded.status
    `);
    
    upsertStmt.run(
        sessionId,
        filepath,
        currentHash,
        now,
        totalChunks,
        'chunked'
    );
    
    sqlite.close();
    
    if (lastTimestamp) {
        console.log(`Added ${newChunks.length} new chunks for session ${sessionId} (total: ${totalChunks})`);
    } else {
        console.log(`Processed ${newChunks.length} chunks for session ${sessionId}`);
    }
    
    // Log context generation stats
    if (contextComplete > 0 || contextFailed > 0) {
        console.log(`  Context: ${contextComplete} complete, ${contextFailed} failed`);
    }
}



async function validateCommand(file) {
    const validation = SessionValidator.validateSessionFile(file);
    
    if (validation.valid) {
        console.log('✓ Validation passed');
        if (validation.warnings.length > 0) {
            console.log('\nWarnings:');
            validation.warnings.forEach(warning => console.log(`  ${warning}`));
        }
    } else {
        console.log('✗ Validation failed');
        console.log('\nErrors:');
        validation.errors.forEach(error => console.log(`  ${error}`));
        
        if (validation.warnings.length > 0) {
            console.log('\nWarnings:');
            validation.warnings.forEach(warning => console.log(`  ${warning}`));
        }
        process.exit(1);
    }
}

async function statusCommand() {
    try {
        const Database = require('better-sqlite3');
        const dbPath = path.join(process.env.HOME, '.openclaw/data/agent.db');
        
        if (!fs.existsSync(dbPath)) {
            console.log('No database found. Run chunk command first.');
            return;
        }
        
        const sqlite = new Database(dbPath);
        
        const totalChunks = sqlite.prepare('SELECT COUNT(*) as count FROM session_chunks').get()?.count || 0;
        const totalSessions = sqlite.prepare('SELECT COUNT(DISTINCT session_id) as count FROM session_chunks').get()?.count || 0;
        const avgTokens = sqlite.prepare('SELECT AVG(token_count) as avg FROM session_chunks').get()?.avg || 0;
        const recentChunks = sqlite.prepare('SELECT COUNT(*) as count FROM session_chunks WHERE created_at > datetime(\'now\', \'-24 hours\')').get()?.count || 0;
        
        // Get index state info
        const indexedSessions = sqlite.prepare('SELECT COUNT(*) as count FROM session_index_state').get()?.count || 0;
        const failedSessions = sqlite.prepare("SELECT COUNT(*) as count FROM session_index_state WHERE status = 'failed'").get()?.count || 0;
        
        // Context generation stats
        let contextComplete = 0, contextFailed = 0, contextPending = 0;
        try {
            contextComplete = sqlite.prepare("SELECT COUNT(*) as count FROM session_chunks WHERE context_status = 'complete'").get()?.count || 0;
            contextFailed = sqlite.prepare("SELECT COUNT(*) as count FROM session_chunks WHERE context_status = 'failed'").get()?.count || 0;
            contextPending = sqlite.prepare("SELECT COUNT(*) as count FROM session_chunks WHERE context_status = 'pending' OR context_status IS NULL").get()?.count || 0;
        } catch (e) {
            // columns might not exist yet
        }
        
        // Embedding stats
        const embeddedChunks = sqlite.prepare('SELECT COUNT(*) as count FROM session_chunks WHERE embedding IS NOT NULL').get()?.count || 0;
        
        sqlite.close();
        
        console.log('\n📊 Session Memory Status');
        console.log('========================');
        console.log(`Total chunks: ${totalChunks}`);
        console.log(`Total sessions: ${totalSessions}`);
        console.log(`Indexed sessions: ${indexedSessions}`);
        console.log(`Failed sessions: ${failedSessions}`);
        console.log(`Average tokens per chunk: ${avgTokens.toFixed(1)}`);
        console.log(`Chunks created in last 24h: ${recentChunks}`);
        
        console.log('\n🧠 Context Generation');
        console.log(`  Complete: ${contextComplete}`);
        console.log(`  Failed: ${contextFailed}`);
        console.log(`  Pending: ${contextPending}`);
        
        console.log('\n🔢 Embeddings');
        console.log(`  Embedded: ${embeddedChunks}/${totalChunks}`);
        
    } catch (error) {
        console.error('Error getting status:', error.message);
        process.exit(1);
    }
}

// Build contextual content for embedding
function buildContextualContent(chunk) {
    const date = new Date(chunk.timestamp);
    const dateStr = date.toLocaleDateString('en-AU', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Australia/Melbourne'
    });
    
    const speakers = JSON.parse(chunk.speakers || '[]');
    const topics = JSON.parse(chunk.topic_tags || '[]');
    
    let context = `[Session from ${dateStr}]\n`;
    context += `[Participants: ${speakers.join(', ') || 'Unknown'}]\n`;
    if (topics.length > 0) {
        context += `[Topics: ${topics.join(', ')}]\n`;
    }
    context += '\n' + chunk.content;
    
    return context;
}

// Generate embeddings via OpenAI
async function generateEmbedding(text) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new SessionMemoryError('CONFIG_ERROR', 'OPENAI_API_KEY not set');
    }
    
    const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'text-embedding-3-small',
            input: text
        })
    });
    
    if (!response.ok) {
        const error = await response.text();
        throw new SessionMemoryError('EMBEDDING_ERROR', `OpenAI API error: ${error}`);
    }
    
    const data = await response.json();
    return data.data[0].embedding;
}


async function embedCommand(options) {
    try {
        await createTables();
        
        const Database = require('better-sqlite3');
        const dbPath = path.join(process.env.HOME, '.openclaw/data/agent.db');
        const sqlite = new Database(dbPath);
        
        // Load sqlite-vec extension
        try {
            sqlite.loadExtension('vec');
        } catch (error) {
            console.warn('sqlite-vec extension not available, embeddings will be stored but not searchable');
        }
        
        // Determine which chunks need embedding
        let chunksToEmbed;
        if (options.all) {
            // Get all chunks without embeddings
            chunksToEmbed = sqlite.prepare(`
                SELECT sc.* FROM session_chunks sc
                LEFT JOIN session_embeddings se ON sc.id = se.chunk_id
                WHERE se.chunk_id IS NULL
                ORDER BY sc.session_id, sc.chunk_index
            `).all();
        } else if (options.session) {
            // Get chunks for specific session without embeddings
            chunksToEmbed = sqlite.prepare(`
                SELECT sc.* FROM session_chunks sc
                LEFT JOIN session_embeddings se ON sc.id = se.chunk_id
                WHERE sc.session_id = ? AND se.chunk_id IS NULL
                ORDER BY sc.chunk_index
            `).all(options.session);
        } else if (options.status) {
            // Show embedding status
            const totalChunks = sqlite.prepare('SELECT COUNT(*) as count FROM session_chunks').get()?.count || 0;
            const embeddedChunks = sqlite.prepare('SELECT COUNT(*) as count FROM session_embeddings').get()?.count || 0;
            const sessionsWithEmbeddings = sqlite.prepare(`
                SELECT COUNT(DISTINCT sc.session_id) as count 
                FROM session_chunks sc
                JOIN session_embeddings se ON sc.id = se.chunk_id
            `).get()?.count || 0;
            
            console.log('\n📊 Embedding Status');
            console.log('==================');
            console.log(`Total chunks: ${totalChunks}`);
            console.log(`Embedded chunks: ${embeddedChunks}`);
            console.log(`Pending chunks: ${totalChunks - embeddedChunks}`);
            console.log(`Sessions with embeddings: ${sessionsWithEmbeddings}`);
            
            // Show sessions needing embedding
            const pendingSessions = sqlite.prepare(`
                SELECT sc.session_id, COUNT(*) as pending_count
                FROM session_chunks sc
                LEFT JOIN session_embeddings se ON sc.id = se.chunk_id
                WHERE se.chunk_id IS NULL
                GROUP BY sc.session_id
                ORDER BY pending_count DESC
            `).all();
            
            if (pendingSessions.length > 0) {
                console.log('\nSessions needing embedding:');
                pendingSessions.forEach(session => {
                    console.log(`  ${session.session_id}: ${session.pending_count} chunks`);
                });
            }
            
            sqlite.close();
            return;
        } else {
            console.error('Either --all, --session <id>, or --status must be specified');
            sqlite.close();
            process.exit(1);
        }
        
        if (chunksToEmbed.length === 0) {
            console.log('No chunks need embedding.');
            sqlite.close();
            return;
        }
        
        console.log(`Generating embeddings for ${chunksToEmbed.length} chunks...`);
        
        // Create embedding generator
        const embeddingGenerator = new EmbeddingGenerator();
        
        // Process in batches
        const BATCH_SIZE = 10;
        let processed = 0;
        let failed = 0;
        
        for (let i = 0; i < chunksToEmbed.length; i += BATCH_SIZE) {
            const batch = chunksToEmbed.slice(i, i + BATCH_SIZE);
            
            for (const chunk of batch) {
                try {
                    // Use context_prefix + content if available (Anthropic contextual RAG approach)
                    // Fall back to context_content, then raw content
                    let textToEmbed;
                    if (chunk.context_prefix) {
                        textToEmbed = `${chunk.context_prefix}\n\n${chunk.content}`;
                    } else if (chunk.context_content) {
                        textToEmbed = chunk.context_content;
                    } else {
                        textToEmbed = chunk.content;
                    }
                    const embedding = await embeddingGenerator.generateEmbedding(textToEmbed);
                    
                    // Convert embedding to Buffer for storage
                    const buffer = embeddingGenerator.embeddingToBuffer(embedding);
                    
                    // Update embedding in session_chunks
                    sqlite.prepare('UPDATE session_chunks SET embedding = ? WHERE id = ?')
                        .run(buffer, chunk.id);
                    
                    // Insert into session_embeddings virtual table
                    try {
                        sqlite.prepare(`
                            INSERT OR REPLACE INTO session_embeddings (chunk_id, embedding)
                            VALUES (?, ?)
                        `).run(chunk.id, JSON.stringify(Array.from(embedding)));
                    } catch (error) {
                        console.warn(`Could not insert into session_embeddings for chunk ${chunk.id}:`, error.message);
                    }
                    
                    processed++;
                    if (processed % 10 === 0) {
                        console.log(`Progress: ${processed}/${chunksToEmbed.length} chunks embedded`);
                    }
                } catch (error) {
                    console.error(`Failed to embed chunk ${chunk.id} from session ${chunk.session_id}:`, error.message);
                    failed++;
                }
            }
            
            // Yield between batches
            if (i + BATCH_SIZE < chunksToEmbed.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        
        // Update index state status
        const sessionIds = [...new Set(chunksToEmbed.map(c => c.session_id))];
        for (const sessionId of sessionIds) {
            const now = new Date().toISOString();
            sqlite.prepare(`
                UPDATE session_index_state 
                SET status = 'embedded', last_indexed = ?
                WHERE session_id = ?
            `).run(now, sessionId);
        }
        
        sqlite.close();
        
        console.log(`\nEmbedding completed!`);
        console.log(`  Successfully embedded: ${processed} chunks`);
        console.log(`  Failed: ${failed} chunks`);
        
        if (failed > 0) {
            console.log('Status: DEGRADED');
        } else {
            console.log('Status: OK');
        }
        
    } catch (error) {
        console.error('Error during embedding:', error.message);
        process.exit(1);
    }
}

async function searchCommand(query, options) {
    try {
        const Database = require('better-sqlite3');
        const dbPath = path.join(process.env.HOME, '.openclaw/data/agent.db');
        
        if (!fs.existsSync(dbPath)) {
            console.error('No database found. Run chunk and embed commands first.');
            process.exit(1);
        }
        
        const sqlite = new Database(dbPath);
        
        // Check if we have embeddings
        const embeddedChunks = sqlite.prepare('SELECT COUNT(*) as count FROM session_chunks WHERE embedding IS NOT NULL').get()?.count || 0;
        if (embeddedChunks === 0) {
            console.error('No embedded chunks found. Run embed command first.');
            sqlite.close();
            process.exit(1);
        }
        
        // Generate embedding for the query
        const embeddingGenerator = new EmbeddingGenerator();
        console.log(`🔍 Searching for: "${query}"`);
        const queryEmbedding = await embeddingGenerator.generateEmbedding(query);
        
        // Build base filter conditions
        let filterConditions = [];
        const filterParams = [];
        
        // Add date filters
        if (options.after) {
            filterConditions.push('sc.timestamp >= ?');
            filterParams.push(new Date(options.after).toISOString());
        }
        
        if (options.before) {
            filterConditions.push('sc.timestamp <= ?');
            filterParams.push(new Date(options.before).toISOString());
        }
        
        // Add topic filter
        if (options.topic) {
            filterConditions.push('sc.topic_tags LIKE ?');
            filterParams.push(`%"${options.topic}"%`);
        }
        
        const filterClause = filterConditions.length > 0 ? 'WHERE ' + filterConditions.join(' AND ') + ' AND' : 'WHERE';
        
        // 1. Run embedding search (cosine similarity)
        console.log('Running embedding search...');
        const embeddingSql = `
            SELECT 
                sc.id,
                sc.session_id,
                sc.timestamp,
                sc.speakers,
                sc.topic_tags,
                sc.content,
                sc.embedding,
                sc.has_decision,
                sc.has_action
            FROM session_chunks sc
            ${filterClause} sc.embedding IS NOT NULL
        `;
        
        const allChunks = sqlite.prepare(embeddingSql).all(...filterParams);
        
        if (allChunks.length === 0) {
            console.log('No chunks found matching the filters.');
            sqlite.close();
            return;
        }
        
        // Calculate cosine similarity for each chunk
        const embeddingResults = allChunks.map(chunk => {
            const embedding = embeddingGenerator.bufferToEmbedding(chunk.embedding);
            const similarity = cosineSimilarity(queryEmbedding, embedding);
            
            return {
                ...chunk,
                embedding_score: similarity
            };
        });
        
        // Sort by embedding score
        embeddingResults.sort((a, b) => b.embedding_score - a.embedding_score);
        
        // 2. Run BM25 search using FTS5
        console.log('Running BM25 keyword search...');
        let bm25Results = [];
        try {
            // Escape query for FTS5
            const ftsQuery = query.split(/\s+/)
                .map(term => `"${term}"*`)
                .join(' ');
            
            const bm25Sql = `
                SELECT 
                    sc.id,
                    sc.session_id,
                    sc.timestamp,
                    sc.speakers,
                    sc.topic_tags,
                    sc.content,
                    sc.embedding,
                    sc.has_decision,
                    sc.has_action,
                    fts.rank as bm25_score
                FROM session_chunks_fts fts
                JOIN session_chunks sc ON fts.chunk_id = sc.id
                WHERE fts.content MATCH ?
                ${filterConditions.length > 0 ? 'AND ' + filterConditions.join(' AND ') : ''}
                ORDER BY fts.rank
                LIMIT 100
            `;
            
            const bm25Params = [ftsQuery, ...filterParams];
            bm25Results = sqlite.prepare(bm25Sql).all(...bm25Params);
            
            // Normalize BM25 scores (higher is better in FTS5 rank)
            if (bm25Results.length > 0) {
                // FTS5 rank is lower for better matches, so invert
                const maxRank = Math.max(...bm25Results.map(r => r.bm25_score));
                bm25Results.forEach(r => {
                    r.bm25_score = maxRank > 0 ? (maxRank - r.bm25_score + 1) / maxRank : 1;
                });
            }
        } catch (e) {
            console.warn('BM25 search failed:', e.message);
            bm25Results = [];
        }
        
        // 3. Combine results using Reciprocal Rank Fusion (RRF)
        console.log('Combining results with RRF...');
        const k = 60; // Standard constant from spec
        
        // Create maps to store RRF scores
        const rrfScores = new Map();
        
        // Process embedding results
        embeddingResults.forEach((result, index) => {
            const chunkId = result.id;
            const rank = index + 1;
            const score = 1.0 / (k + rank);
            rrfScores.set(chunkId, (rrfScores.get(chunkId) || 0) + score);
        });
        
        // Process BM25 results
        bm25Results.forEach((result, index) => {
            const chunkId = result.id;
            const rank = index + 1;
            const score = 1.0 / (k + rank);
            rrfScores.set(chunkId, (rrfScores.get(chunkId) || 0) + score);
        });
        
        // Combine all unique chunks
        const allResultsMap = new Map();
        [...embeddingResults, ...bm25Results].forEach(result => {
            if (!allResultsMap.has(result.id)) {
                allResultsMap.set(result.id, result);
            }
        });
        
        // Create final results with RRF scores
        const combinedResults = Array.from(allResultsMap.values()).map(result => {
            const rrfScore = rrfScores.get(result.id) || 0;
            return {
                ...result,
                rrf_score: rrfScore,
                embedding_score: result.embedding_score || 0,
                bm25_score: result.bm25_score || 0
            };
        });
        
        // Sort by RRF score
        combinedResults.sort((a, b) => b.rrf_score - a.rrf_score);
        
        // Limit results
        const limit = parseInt(options.limit) || 5;
        const topResults = combinedResults.slice(0, limit);
        
        // Format and display results
        console.log('');
        console.log(`📊 Search Results (Hybrid RRF):`);
        console.log(`Embedding matches: ${embeddingResults.length}, BM25 matches: ${bm25Results.length}`);
        console.log('');
        
        topResults.forEach((result, index) => {
            const date = new Date(result.timestamp).toLocaleString('en-AU', {
                timeZone: 'Australia/Melbourne',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
            
            const topics = JSON.parse(result.topic_tags || '[]');
            const topicStr = topics.length > 0 ? topics.join(', ') : 'general';
            
            console.log(`[${index + 1}] RRF Score: ${result.rrf_score.toFixed(4)} | ${date}`);
            console.log(`    Embedding: ${result.embedding_score?.toFixed(2) || 'N/A'} | BM25: ${result.bm25_score?.toFixed(2) || 'N/A'}`);
            console.log(`    Topics: ${topicStr}`);
            
            // Show content with line breaks for readability
            const content = result.content.length > 200 
                ? result.content.substring(0, 200) + '...'
                : result.content;
            const lines = content.split('\n');
            lines.forEach(line => {
                if (line.trim()) {
                    console.log(`    "${line.trim()}"`);
                }
            });
            console.log('');
        });
        
        console.log(`Showing ${topResults.length} of ${combinedResults.length} combined results`);
        
        sqlite.close();
        
    } catch (error) {
        console.error('Error during search:', error.message);
        process.exit(1);
    }
}

// Calculate cosine similarity between two embeddings
function cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) {
        return 0;
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
    
    if (normA === 0 || normB === 0) {
        return 0;
    }
    
    return dotProduct / (normA * normB);
}

async function backfillContextCommand(options) {
    try {
        await createTables();
        
        const Database = require('better-sqlite3');
        const dbPath = path.join(process.env.HOME, '.openclaw/data/agent.db');
        const sqlite = new Database(dbPath);
        
        const batchSize = parseInt(options.batch) || 100;
        const reembed = options.reembed !== false; // Default to true
        
        // Find chunks without context_prefix
        const pendingChunks = sqlite.prepare(`
            SELECT id, session_id, content, timestamp, speakers, context_status
            FROM session_chunks 
            WHERE context_prefix IS NULL 
            ORDER BY timestamp DESC
            LIMIT ?
        `).all(batchSize);
        
        if (pendingChunks.length === 0) {
            console.log('✓ All chunks already have context. Nothing to backfill.');
            sqlite.close();
            return;
        }
        
        console.log(`Found ${pendingChunks.length} chunks without context (batch size: ${batchSize})`);
        console.log('Generating context via Gemini/OpenRouter...\n');
        
        // Prepare update statement
        const updateStmt = sqlite.prepare(`
            UPDATE session_chunks 
            SET context_prefix = ?, context_status = ?, embedding = NULL
            WHERE id = ?
        `);
        
        let completed = 0;
        let failed = 0;
        const chunksToReembed = [];
        
        for (let i = 0; i < pendingChunks.length; i++) {
            const chunk = pendingChunks[i];
            
            // Generate context
            const result = await generateChunkContext({
                content: chunk.content,
                timestamp: chunk.timestamp,
                speakers: chunk.speakers,
                session_id: chunk.session_id
            });
            
            // Update database
            updateStmt.run(result.context, result.status, chunk.id);
            
            if (result.status === 'complete') {
                completed++;
                chunksToReembed.push(chunk.id);
            } else {
                failed++;
            }
            
            // Progress indicator
            if ((i + 1) % 10 === 0 || i === pendingChunks.length - 1) {
                process.stdout.write(`\rProgress: ${i + 1}/${pendingChunks.length} (${completed} complete, ${failed} failed)`);
            }
            
            // Rate limiting - slight delay between requests
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        
        console.log('\n');
        
        // Show remaining count
        const remaining = sqlite.prepare(`
            SELECT COUNT(*) as count FROM session_chunks WHERE context_prefix IS NULL
        `).get()?.count || 0;
        
        console.log(`\n📊 Backfill Results:`);
        console.log(`  Processed: ${pendingChunks.length}`);
        console.log(`  Complete: ${completed}`);
        console.log(`  Failed: ${failed}`);
        console.log(`  Remaining: ${remaining}`);
        
        // Re-embed chunks with new context
        if (reembed && chunksToReembed.length > 0) {
            console.log(`\n🔄 Re-embedding ${chunksToReembed.length} chunks with new context...`);
            
            // Clear embeddings for updated chunks so embed command will regenerate them
            sqlite.prepare(`
                UPDATE session_chunks 
                SET embedding = NULL 
                WHERE id IN (${chunksToReembed.join(',')})
            `).run();
            
            // Delete from session_embeddings
            try {
                sqlite.prepare(`
                    DELETE FROM session_embeddings 
                    WHERE chunk_id IN (${chunksToReembed.join(',')})
                `).run();
            } catch (e) {
                // session_embeddings might not exist
            }
            
            console.log(`  Cleared ${chunksToReembed.length} embeddings. Run 'embed --all' to regenerate.`);
        }
        
        if (remaining > 0) {
            console.log(`\n💡 Run 'backfill-context --batch ${batchSize}' again to process more chunks.`);
        }
        
        sqlite.close();
        
    } catch (error) {
        console.error('Error during backfill:', error.message);
        process.exit(1);
    }
}

async function healthCommand() {
    try {
        const Database = require('better-sqlite3');
        const dbPath = path.join(process.env.HOME, '.openclaw/data/agent.db');
        
        if (!fs.existsSync(dbPath)) {
            console.log('Health: ERROR - No database found');
            return;
        }
        
        const sqlite = new Database(dbPath);
        
        // Check if tables exist
        const chunksTable = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session_chunks'").get();
        const stateTable = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session_index_state'").get();
        
        if (!chunksTable || !stateTable) {
            console.log('Health: DEGRADED - Required tables missing');
            sqlite.close();
            return;
        }
        
        const totalChunks = sqlite.prepare('SELECT COUNT(*) as count FROM session_chunks').get()?.count || 0;
        const totalSessions = sqlite.prepare('SELECT COUNT(DISTINCT session_id) as count FROM session_chunks').get()?.count || 0;
        const failedSessions = sqlite.prepare("SELECT COUNT(*) as count FROM session_index_state WHERE status = 'failed'").get()?.count || 0;
        const lastIndexed = sqlite.prepare('SELECT MAX(last_indexed) as latest FROM session_index_state').get()?.latest;
        
        // Check embeddings
        const embeddedChunks = sqlite.prepare('SELECT COUNT(*) as count FROM session_chunks WHERE embedding IS NOT NULL').get()?.count || 0;
        
        sqlite.close();
        
        console.log('Session Memory Health Check:');
        console.log(`  Total chunks: ${totalChunks}`);
        console.log(`  Total sessions: ${totalSessions}`);
        console.log(`  Embedded chunks: ${embeddedChunks}`);
        console.log(`  Failed sessions: ${failedSessions}`);
        console.log(`  Last indexed: ${lastIndexed || 'Never'}`);
        
        if (failedSessions > 0) {
            console.log('Status: DEGRADED');
        } else if (totalSessions === 0) {
            console.log('Status: OK (No sessions indexed yet)');
        } else if (embeddedChunks < totalChunks * 0.9) {
            console.log('Status: DEGRADED - Many chunks not embedded');
        } else {
            console.log('Status: OK');
        }
        
    } catch (error) {
        console.error('Health check error:', error.message);
        console.log('Status: ERROR');
    }
}

// CLI Configuration
program
    .name('session-memory')
    .description('Session Memory CLI Tool - Chunks and indexes OpenClaw session JSONL files')
    .version('1.0.0');

program
    .command('chunk')
    .description('Process and chunk session files')
    .option('--all', 'Process all sessions')
    .option('--session <id>', 'Process specific session')
    .action(chunkCommand);

program
    .command('validate <file>')
    .description('Validate a session JSONL file')
    .action(validateCommand);

program
    .command('status')
    .description('Show indexing status and statistics')
    .action(statusCommand);

program
    .command('health')
    .description('Show health status of session memory system')
    .action(healthCommand);

program
    .command('backfill-context')
    .description('Generate context for existing chunks without context_prefix')
    .option('--batch <n>', 'Number of chunks to process (default: 100)', '100')
    .option('--no-reembed', 'Skip clearing embeddings (will need manual re-embed)')
    .action(backfillContextCommand);

program
    .command('embed')
    .description('Generate embeddings for session chunks')
    .option('--all', 'Embed all chunks')
    .option('--session <id>', 'Embed chunks for specific session')
    .option('--status', 'Show embedding status')
    .action(embedCommand);

program
    .command('search <query>')
    .description('Search session chunks using semantic similarity')
    .option('--after <date>', 'Filter by date after (YYYY-MM-DD)')
    .option('--before <date>', 'Filter by date before (YYYY-MM-DD)')
    .option('--topic <tag>', 'Filter by topic tag')
    .option('--limit <n>', 'Limit number of results (default: 5)')
    .action(searchCommand);

if (require.main === module) {
    program.parse();
}

module.exports = { SessionValidator, SessionChunker, SessionMemoryError };
