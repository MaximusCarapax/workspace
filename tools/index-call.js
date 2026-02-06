#!/usr/bin/env node

/**
 * Call Log Pipeline to RAG
 * 
 * Processes call transcripts and indexes them into session memory:
 * - Extracts structured information (participants, topics, decisions)
 * - Creates session_chunk entries with source: 'voice_call'
 * - Appends summary to daily memory file
 * 
 * Usage:
 *   node tools/index-call.js --transcript "Call transcript text..."
 *   node tools/index-call.js --file transcript.txt --contact "+61412345678"
 *   node tools/index-call.js --conversation-id "conv_123" --contact "Diana"
 */

const fs = require('fs');
const path = require('path');
const db = require('../lib/db');
const creds = require('../lib/credentials');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

class CallIndexer {
  constructor() {
    this.db = db;
  }

  /**
   * Main entry point - process a call transcript
   */
  async indexCall(transcript, options = {}) {
    try {
      console.log('Processing call transcript...');
      
      // 1. Extract structured information using LLM
      const extraction = await this.extractCallInfo(transcript, options);
      
      // 2. Create session chunks for RAG indexing
      const sessionId = await this.createSessionChunks(transcript, extraction);
      
      // 3. Update daily memory file
      await this.updateDailyMemory(extraction);
      
      // 4. Update contact information if applicable
      if (options.contact) {
        await this.updateContactFromCall(options.contact, extraction);
      }
      
      console.log('Call successfully indexed to RAG system');
      console.log(`Session ID: ${sessionId}`);
      
      return {
        session_id: sessionId,
        extraction,
        status: 'success'
      };
      
    } catch (error) {
      console.error('Error indexing call:', error);
      throw error;
    }
  }

  /**
   * Extract structured information from transcript using LLM
   */
  async extractCallInfo(transcript, options = {}) {
    console.log('Extracting structured information from transcript...');
    
    const prompt = `Analyze this voice call transcript and extract structured information.

TRANSCRIPT:
${transcript}

CONTEXT:
- Contact: ${options.contact || 'Unknown'}
- Duration: ${options.duration || 'Unknown'}

Extract the following information and return as JSON:

{
  "participants": ["Name 1", "Name 2"],
  "duration_minutes": number or null,
  "topics_discussed": ["Topic 1", "Topic 2"],
  "key_points": ["Important point 1", "Important point 2"],
  "decisions_made": ["Decision 1", "Decision 2"],
  "action_items": ["Action 1", "Action 2"],
  "follow_ups": ["Follow up 1", "Follow up 2"],
  "sentiment": "positive|neutral|negative",
  "call_purpose": "Brief description of why the call happened",
  "outcome": "Brief description of what was accomplished",
  "relationship_insights": ["Insight about relationship/preferences"],
  "summary": "2-3 sentence summary of the call"
}

Be concise but capture the essential information. If information is not available, use null or empty arrays.`;

    try {
      // Use Gemini via OpenRouter for extraction
      const { stdout } = await execAsync(`node tools/gemini.js "${prompt.replace(/"/g, '\\"')}"`, {
        maxBuffer: 1024 * 1024 // 1MB buffer for large transcripts
      });
      
      // Try to extract JSON from the response
      const jsonMatch = stdout.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const extracted = JSON.parse(jsonMatch[0]);
        console.log('Successfully extracted call information');
        return extracted;
      } else {
        throw new Error('Could not extract JSON from LLM response');
      }
      
    } catch (error) {
      console.log('LLM extraction failed, using basic parsing');
      
      // Fallback to basic extraction
      return {
        participants: this.extractParticipants(transcript, options),
        duration_minutes: options.duration ? parseInt(options.duration) : null,
        topics_discussed: this.extractBasicTopics(transcript),
        key_points: [],
        decisions_made: [],
        action_items: [],
        follow_ups: [],
        sentiment: 'neutral',
        call_purpose: 'Voice call',
        outcome: 'Call completed',
        relationship_insights: [],
        summary: `Voice call with ${options.contact || 'contact'} - transcript processed`
      };
    }
  }

  /**
   * Create session chunks for RAG indexing
   */
  async createSessionChunks(transcript, extraction) {
    console.log('Creating session chunks for RAG...');
    
    // Generate a session ID for this call
    const sessionId = `voice_call_${Date.now()}`;
    const timestamp = new Date().toISOString();
    
    // Chunk the transcript (split into manageable pieces)
    const chunks = this.chunkTranscript(transcript, extraction);
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      // Insert into session_chunks table with correct schema
      this.db.db.prepare(`
        INSERT INTO session_chunks (
          session_id, chunk_index, timestamp, speakers, topic_tags,
          has_decision, has_action, content, context_content,
          context_prefix, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        sessionId,
        i + 1,
        timestamp,
        JSON.stringify(extraction.participants),
        JSON.stringify(extraction.topics_discussed || []),
        extraction.decisions_made && extraction.decisions_made.length > 0 ? 1 : 0,
        extraction.action_items && extraction.action_items.length > 0 ? 1 : 0,
        chunk.content,
        chunk.context,
        `Voice call: ${extraction.call_purpose} - ${extraction.participants.join(', ')}`,
        'voice_call'
      );
    }
    
    console.log(`Created ${chunks.length} session chunks`);
    
    // Trigger embedding generation (async)
    try {
      execAsync('node tools/session-memory.js embed --recent 10').catch(() => {
        console.log('Note: Could not trigger embedding generation');
      });
    } catch (e) {
      // Silent fail - embedding is optional
    }
    
    return sessionId;
  }

  /**
   * Chunk transcript into manageable pieces with context
   */
  chunkTranscript(transcript, extraction) {
    const chunks = [];
    const maxChunkSize = 1000; // characters per chunk
    
    // Add a context header to each chunk
    const contextHeader = `VOICE CALL TRANSCRIPT
Participants: ${extraction.participants.join(', ')}
Purpose: ${extraction.call_purpose}
Date: ${new Date().toLocaleDateString()}

---

`;
    
    // Split transcript into chunks
    const words = transcript.split(' ');
    let currentChunk = '';
    
    for (const word of words) {
      if (currentChunk.length + word.length + 1 > maxChunkSize) {
        if (currentChunk.trim()) {
          chunks.push({
            content: currentChunk.trim(),
            context: contextHeader + currentChunk.trim()
          });
        }
        currentChunk = word;
      } else {
        currentChunk += (currentChunk ? ' ' : '') + word;
      }
    }
    
    // Add remaining chunk
    if (currentChunk.trim()) {
      chunks.push({
        content: currentChunk.trim(),
        context: contextHeader + currentChunk.trim()
      });
    }
    
    // If transcript is short, create single chunk
    if (chunks.length === 0) {
      chunks.push({
        content: transcript,
        context: contextHeader + transcript
      });
    }
    
    return chunks;
  }

  /**
   * Update daily memory file with call summary
   */
  async updateDailyMemory(extraction) {
    console.log('Updating daily memory file...');
    
    const today = new Date().toISOString().split('T')[0];
    const memoryDir = path.join(process.cwd(), 'memory');
    const memoryFile = path.join(memoryDir, `${today}.md`);
    
    // Ensure memory directory exists
    if (!fs.existsSync(memoryDir)) {
      fs.mkdirSync(memoryDir, { recursive: true });
    }
    
    // Create memory entry
    const timestamp = new Date().toLocaleTimeString();
    const memoryEntry = `
## ${timestamp} - Voice Call

**Participants:** ${extraction.participants.join(', ')}
**Purpose:** ${extraction.call_purpose}
**Duration:** ${extraction.duration_minutes ? `${extraction.duration_minutes} minutes` : 'Unknown'}
**Sentiment:** ${extraction.sentiment}

**Summary:** ${extraction.summary}

**Key Points:**
${extraction.key_points.map(point => `- ${point}`).join('\n')}

**Action Items:**
${extraction.action_items.map(item => `- ${item}`).join('\n')}

**Follow-ups:**
${extraction.follow_ups.map(item => `- ${item}`).join('\n')}

---
`;
    
    // Append to daily memory file
    fs.appendFileSync(memoryFile, memoryEntry);
    console.log(`Added call summary to ${memoryFile}`);
  }

  /**
   * Update contact information based on call insights
   */
  async updateContactFromCall(contactIdentifier, extraction) {
    console.log(`Updating contact information for: ${contactIdentifier}`);
    
    try {
      // Find contact by phone or name
      let contact = null;
      
      if (contactIdentifier.includes('+') || contactIdentifier.match(/^\d/)) {
        // Looks like a phone number
        contact = this.db.db.prepare('SELECT * FROM contacts WHERE phone = ?').get(contactIdentifier);
      } else {
        // Looks like a name
        contact = this.db.db.prepare('SELECT * FROM contacts WHERE name LIKE ?').get(`%${contactIdentifier}%`);
      }
      
      if (!contact) {
        console.log('Contact not found in database');
        return;
      }
      
      // Update call statistics
      const totalCalls = (contact.total_calls || 0) + 1;
      const lastCall = new Date().toISOString();
      
      // Merge relationship insights into preferences
      let preferences = {};
      try {
        preferences = contact.preferences ? JSON.parse(contact.preferences) : {};
      } catch (e) {
        preferences = {};
      }
      
      // Add new insights
      if (extraction.relationship_insights && extraction.relationship_insights.length > 0) {
        if (!preferences.insights) {
          preferences.insights = [];
        }
        preferences.insights = [...preferences.insights, ...extraction.relationship_insights];
        
        // Keep only unique insights, limit to 10
        preferences.insights = [...new Set(preferences.insights)].slice(-10);
      }
      
      // Update last contact date
      const lastContactDate = new Date().toISOString().split('T')[0];
      
      // Update the contact record
      this.db.db.prepare(`
        UPDATE contacts 
        SET 
          total_calls = ?,
          last_call = ?,
          last_contact = ?,
          preferences = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(
        totalCalls,
        lastCall,
        lastContactDate,
        JSON.stringify(preferences),
        contact.id
      );
      
      console.log(`Updated contact ${contact.name}: ${totalCalls} total calls`);
      
    } catch (error) {
      console.log('Error updating contact:', error.message);
    }
  }

  /**
   * Basic participant extraction (fallback)
   */
  extractParticipants(transcript, options) {
    const participants = ['Max']; // Our voice agent
    
    if (options.contact) {
      participants.push(options.contact);
    }
    
    // Try to find speaker names in transcript
    const speakerPattern = /(\w+):\s/g;
    let match;
    while ((match = speakerPattern.exec(transcript)) !== null) {
      const name = match[1];
      if (!participants.includes(name) && name !== 'Max') {
        participants.push(name);
      }
    }
    
    return participants;
  }

  /**
   * Basic topic extraction (fallback)
   */
  extractBasicTopics(transcript) {
    const topics = [];
    const commonTopics = [
      'work', 'family', 'health', 'travel', 'birthday', 'garden', 
      'appointment', 'meeting', 'project', 'weather', 'call back'
    ];
    
    const lowerTranscript = transcript.toLowerCase();
    for (const topic of commonTopics) {
      if (lowerTranscript.includes(topic)) {
        topics.push(topic.charAt(0).toUpperCase() + topic.slice(1));
      }
    }
    
    return topics.slice(0, 5); // Limit to 5 topics
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help')) {
    console.log(`
Call Log Pipeline to RAG

Usage:
  node tools/index-call.js --transcript "text" [options]
  node tools/index-call.js --file path/to/transcript.txt [options]
  node tools/index-call.js --conversation-id "conv_123" [options]

Options:
  --transcript "text"       Direct transcript text
  --file <path>            Path to transcript file
  --conversation-id <id>   ElevenLabs conversation ID to fetch
  --contact <phone|name>   Contact identifier
  --duration <minutes>     Call duration in minutes
  --json                   Output result as JSON

Examples:
  node tools/index-call.js --transcript "Hello, this is Max..." --contact "+61412345678"
  node tools/index-call.js --file transcript.txt --contact "Diana" --duration 5
  node tools/index-call.js --conversation-id "conv_123" --contact "+61412345678"
    `);
    return;
  }
  
  let transcript = '';
  const options = {};
  
  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    
    switch (arg) {
      case '--transcript':
        transcript = next;
        i++;
        break;
      case '--file':
        if (!fs.existsSync(next)) {
          console.error(`File not found: ${next}`);
          process.exit(1);
        }
        transcript = fs.readFileSync(next, 'utf8');
        i++;
        break;
      case '--conversation-id':
        // TODO: Implement ElevenLabs API call to fetch transcript
        console.error('Conversation ID fetching not yet implemented');
        console.error('Use --transcript or --file for now');
        process.exit(1);
        break;
      case '--contact':
        options.contact = next;
        i++;
        break;
      case '--duration':
        options.duration = next;
        i++;
        break;
      case '--json':
        options.json = true;
        break;
    }
  }
  
  if (!transcript.trim()) {
    console.error('No transcript provided. Use --transcript, --file, or --conversation-id');
    process.exit(1);
  }
  
  try {
    const indexer = new CallIndexer();
    const result = await indexer.indexCall(transcript, options);
    
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log('\n=== CALL INDEXED SUCCESSFULLY ===');
      console.log(`Session ID: ${result.session_id}`);
      console.log(`Summary: ${result.extraction.summary}`);
      console.log(`Participants: ${result.extraction.participants.join(', ')}`);
      console.log(`Topics: ${result.extraction.topics_discussed.join(', ')}`);
      
      if (result.extraction.action_items.length > 0) {
        console.log('\nAction Items:');
        result.extraction.action_items.forEach(item => console.log(`  - ${item}`));
      }
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// Export for library use
if (require.main === module) {
  main();
} else {
  module.exports = CallIndexer;
}