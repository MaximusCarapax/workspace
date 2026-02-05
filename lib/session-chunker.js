/**
 * Session Chunker Library
 * 
 * Core logic for chunking OpenClaw session JSONL files
 * Implements exchange-based chunking with metadata extraction
 */

const fs = require('fs');
const path = require('path');

class SessionChunker {
    constructor(options = {}) {
        this.maxChunkSize = options.maxChunkSize || 500; // tokens
        this.maxChunksPerSession = options.maxChunksPerSession || 2000;
        this.batchSize = options.batchSize || 100;
        this.chunkId = 0;
    }
    
    /**
     * Estimate token count from text
     * @param {string} text 
     * @returns {number}
     */
    static estimateTokens(text) {
        // Rough estimation: ~4 characters per token
        return Math.ceil(text.length / 4);
    }
    
    /**
     * Extract text content from OpenClaw message content format
     * @param {string|Array} content 
     * @returns {string}
     */
    extractTextContent(content) {
        if (typeof content === 'string') {
            return content;
        }
        
        if (Array.isArray(content)) {
            return content
                .filter(item => item.type === 'text')
                .map(item => item.text || item.content || '')
                .join(' ');
        }
        
        return '';
    }
    
    /**
     * Extract messages from session data
     * @param {Array} sessionData 
     * @returns {Array}
     */
    extractMessages(sessionData) {
        const messages = [];
        
        for (const line of sessionData) {
            if (line.type === 'message' && line.message) {
                const textContent = this.extractTextContent(line.message.content);
                
                // Skip empty messages
                if (!textContent.trim()) continue;
                
                messages.push({
                    role: line.message.role,
                    content: textContent,
                    timestamp: line.timestamp,
                    id: line.id || null
                });
            }
        }
        
        return messages;
    }
    
    /**
     * Chunk messages by conversation exchanges
     * @param {Array} messages 
     * @returns {Array}
     */
    chunkByExchange(messages) {
        const chunks = [];
        let i = 0;
        
        while (i < messages.length) {
            const userMsg = messages[i];
            
            // Find user message
            if (!userMsg || userMsg.role !== 'user') {
                i++;
                continue;
            }
            
            // Look for corresponding assistant response
            let assistantMsg = null;
            let nextIndex = i + 1;
            
            // Skip any non-assistant messages to find the response
            while (nextIndex < messages.length && messages[nextIndex].role !== 'assistant') {
                nextIndex++;
            }
            
            if (nextIndex < messages.length && messages[nextIndex].role === 'assistant') {
                assistantMsg = messages[nextIndex];
            }
            
            // Create exchange text
            let exchangeText = `User: ${userMsg.content.trim()}`;
            let speakers = ['user'];
            let timestamp = userMsg.timestamp;
            
            if (assistantMsg) {
                exchangeText += `\n\nAssistant: ${assistantMsg.content.trim()}`;
                speakers.push('assistant');
            }
            
            const tokenCount = SessionChunker.estimateTokens(exchangeText);
            
            // If exchange is too large, split it
            if (tokenCount > this.maxChunkSize) {
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
            
            // Move to next unprocessed message
            i = assistantMsg ? nextIndex + 1 : i + 1;
        }
        
        return chunks;
    }
    
    /**
     * Split large exchanges into smaller chunks with overlap
     * @param {string} text 
     * @param {Array} speakers 
     * @param {string} timestamp 
     * @returns {Array}
     */
    splitLargeExchange(text, speakers, timestamp) {
        const chunks = [];
        const targetSize = this.maxChunkSize * 4; // Convert tokens to chars
        const overlapSize = 200; // Characters of overlap
        
        // Try to split on paragraphs first
        let parts = text.split('\n\n').filter(p => p.trim());
        
        // If no paragraphs, split on sentences
        if (parts.length <= 1) {
            parts = text.split(/[.!?]+/).filter(s => s.trim()).map(s => s + '.');
        }
        
        let currentChunk = '';
        let overlapBuffer = '';
        
        for (const part of parts) {
            const proposedChunk = currentChunk + (currentChunk ? '\n\n' : '') + part;
            
            if (proposedChunk.length > targetSize && currentChunk) {
                // Save current chunk with overlap
                const finalChunk = overlapBuffer + currentChunk;
                chunks.push({
                    content: finalChunk.trim(),
                    speakers,
                    timestamp,
                    token_count: SessionChunker.estimateTokens(finalChunk),
                    chunk_index: this.chunkId++
                });
                
                // Set overlap buffer
                const lastSentences = currentChunk.split(/[.!?]+/).slice(-2).join('.') + '.';
                overlapBuffer = lastSentences.slice(-overlapSize) + '\n\n';
                currentChunk = part;
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
    
    /**
     * Extract topic keywords using simple keyword analysis
     * @param {string} content 
     * @returns {Array}
     */
    extractTopics(content) {
        const commonWords = new Set([
            'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
            'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had',
            'do', 'does', 'did', 'will', 'would', 'could', 'should', 'can', 'may', 'might',
            'must', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us',
            'them', 'this', 'that', 'these', 'those', 'user', 'assistant'
        ]);
        
        // Extract meaningful words
        const words = content.toLowerCase()
            .replace(/[^\w\s-]/g, ' ')
            .split(/\s+/)
            .filter(word => 
                word.length > 3 && 
                !commonWords.has(word) &&
                !word.match(/^\d+$/) // Skip pure numbers
            );
        
        // Count word frequencies
        const wordCount = {};
        words.forEach(word => {
            wordCount[word] = (wordCount[word] || 0) + 1;
        });
        
        // Get top keywords
        const keywords = Object.entries(wordCount)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 3)
            .map(([word]) => word.replace(/-/g, '_')); // Replace hyphens for tag compatibility
            
        return keywords;
    }
    
    /**
     * Detect if content contains decisions/conclusions
     * @param {string} content 
     * @returns {boolean}
     */
    detectDecisions(content) {
        const decisionPatterns = [
            /\b(decided?|choose|chose|conclude|resolved?|determined?|agreed?)\b/i,
            /\b(final decision|conclusion|resolution)\b/i,
            /\b(let's go with|we'll use|I'll proceed with)\b/i,
            /\b(settled on|opted for)\b/i
        ];
        
        return decisionPatterns.some(pattern => pattern.test(content));
    }
    
    /**
     * Detect if content contains action items
     * @param {string} content 
     * @returns {boolean}
     */
    detectActions(content) {
        const actionPatterns = [
            /\b(todo|to-do|action item|task|need to|should do|will do|plan to)\b/i,
            /\b(implement|build|create|develop|write|code|fix)\b/i,
            /\b(next step|follow up|remember to)\b/i,
            /\b(schedule|deadline|due date)\b/i
        ];
        
        return actionPatterns.some(pattern => pattern.test(content));
    }
    
    /**
     * Process a session file and return chunked data
     * @param {string} sessionId 
     * @param {Array} sessionData 
     * @returns {Promise<Array>}
     */
    async processSession(sessionId, sessionData) {
        console.log(`📄 Processing session: ${sessionId}`);
        
        // Extract messages
        const messages = this.extractMessages(sessionData);
        
        if (messages.length === 0) {
            console.log(`⚠️  No valid messages found in session ${sessionId}`);
            return [];
        }
        
        // Chunk messages
        const chunks = this.chunkByExchange(messages);
        
        // Cap chunks if too many
        if (chunks.length > this.maxChunksPerSession) {
            console.warn(`⚠️  Session ${sessionId} has ${chunks.length} chunks, capping at ${this.maxChunksPerSession}`);
            chunks.splice(this.maxChunksPerSession);
        }
        
        // Process chunks in batches
        const results = [];
        for (let i = 0; i < chunks.length; i += this.batchSize) {
            const batch = chunks.slice(i, i + this.batchSize);
            
            for (const chunk of batch) {
                // Extract metadata
                const topicTags = this.extractTopics(chunk.content);
                const hasDecision = this.detectDecisions(chunk.content) ? 1 : 0;
                const hasAction = this.detectActions(chunk.content) ? 1 : 0;
                
                const chunkData = {
                    session_id: sessionId,
                    chunk_index: chunk.chunk_index,
                    timestamp: chunk.timestamp,
                    speakers: JSON.stringify(chunk.speakers),
                    topic_tags: JSON.stringify(topicTags),
                    has_decision: hasDecision,
                    has_action: hasAction,
                    content: chunk.content,
                    token_count: chunk.token_count
                };
                
                results.push(chunkData);
            }
            
            // Yield control between batches
            if (i + this.batchSize < chunks.length) {
                await new Promise(resolve => setTimeout(resolve, 1));
            }
        }
        
        console.log(`✅ Processed ${results.length} chunks for session ${sessionId}`);
        return results;
    }
}

module.exports = { SessionChunker };