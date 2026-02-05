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
const { program } = require('commander');
const db = require('../lib/db');

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
        // Try to use Gemini if available
        if (gemini && gemini.extractTopics) {
            try {
                return await gemini.extractTopics(content);
            } catch (e) {
                console.warn('Gemini topic extraction failed:', e.message);
                // Fall through to keyword extraction
            }
        }
        
        // Fallback: simple keyword extraction
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
    
    async processSession(sessionId, sessionData) {
        console.log(`Processing session: ${sessionId}`);
        
        const messages = this.extractMessages(sessionData);
        const chunks = this.chunkByExchange(messages);
        
        if (chunks.length > MAX_CHUNKS_PER_SESSION) {
            console.warn(`Warning: Session ${sessionId} has ${chunks.length} chunks, capping at ${MAX_CHUNKS_PER_SESSION}`);
            chunks.splice(MAX_CHUNKS_PER_SESSION);
        }
        
        // Process chunks in batches
        const results = [];
        for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
            const batch = chunks.slice(i, i + BATCH_SIZE);
            
            for (const chunk of batch) {
                // Extract metadata
                const topicTags = await this.extractTopics(chunk.content);
                const hasDecision = this.detectDecisions(chunk.content);
                const hasAction = this.detectActions(chunk.content);
                
                // Create context content
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

async function createTables() {
    const dbPath = path.join(process.env.HOME, '.openclaw/data/agent.db');
    
    // Ensure database exists
    if (!fs.existsSync(path.dirname(dbPath))) {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    
    // Create tables (using existing db module pattern)
    const Database = require('better-sqlite3');
    const sqlite = new Database(dbPath);
    
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
            token_count INTEGER,
            embedding BLOB,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(session_id, chunk_index)
        )
    `);
    
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
    
    // Process session
    const chunks = await chunker.processSession(sessionId, sessionData);
    
    // Store in database
    const Database = require('better-sqlite3');
    const dbPath = path.join(process.env.HOME, '.openclaw/data/agent.db');
    const sqlite = new Database(dbPath);
    
    // Clear existing chunks for this session
    sqlite.prepare('DELETE FROM session_chunks WHERE session_id = ?').run(sessionId);
    
    // Insert new chunks
    const insertStmt = sqlite.prepare(`
        INSERT INTO session_chunks 
        (session_id, chunk_index, timestamp, speakers, topic_tags, has_decision, has_action, content, context_content, token_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    for (const chunk of chunks) {
        insertStmt.run(
            chunk.session_id,
            chunk.chunk_index,
            chunk.timestamp,
            chunk.speakers,
            chunk.topic_tags,
            chunk.has_decision,
            chunk.has_action,
            chunk.content,
            chunk.context_content || chunk.content, // Fallback to regular content if context not available
            chunk.token_count
        );
    }
    
    sqlite.close();
    console.log(`Processed ${chunks.length} chunks for session ${sessionId}`);
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
        
        sqlite.close();
        
        console.log('\n📊 Session Memory Status');
        console.log('======================');
        console.log(`Total chunks: ${totalChunks}`);
        console.log(`Total sessions: ${totalSessions}`);
        console.log(`Average tokens per chunk: ${avgTokens.toFixed(1)}`);
        console.log(`Chunks created in last 24h: ${recentChunks}`);
        
    } catch (error) {
        console.error('Error getting status:', error.message);
        process.exit(1);
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

if (require.main === module) {
    program.parse();
}

module.exports = { SessionValidator, SessionChunker, SessionMemoryError };
