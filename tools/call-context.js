#!/usr/bin/env node

/**
 * Call Context Builder
 * 
 * Builds pre-call context for voice agents by combining:
 * - Contact database information
 * - Session memory RAG (mentions of their name)
 * - Relationship history and preferences
 * 
 * Usage:
 *   node tools/call-context.js +61412345678
 *   node tools/call-context.js +61412345678 --name Diana
 *   node tools/call-context.js +61412345678 --name Diana --purpose "Birthday reminder"
 */

const db = require('../lib/db');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

class CallContextBuilder {
  constructor() {
    this.db = db;
  }

  /**
   * Main entry point - build full context for a contact
   */
  async buildContext(phone, options = {}) {
    try {
      console.log(`Building context for ${phone}...`);
      
      // 1. Lookup contact by phone
      const contact = await this.lookupContact(phone, options.name);
      
      // 2. Get relationship history from session memory
      const history = contact ? await this.getRelationshipHistory(contact.name) : [];
      
      // 3. Get recent activity context
      const recentActivity = contact ? await this.getRecentActivity(contact.name) : [];
      
      // 4. Build suggested topics
      const suggestedTopics = await this.buildSuggestedTopics(contact, history, options.purpose);
      
      const context = {
        contact: contact || {
          name: options.name || 'Unknown',
          phone: phone,
          relationship: null,
          preferences: {}
        },
        history,
        recent_activity: recentActivity,
        suggested_topics: suggestedTopics,
        call_purpose: options.purpose || null,
        generated_at: new Date().toISOString()
      };
      
      return context;
    } catch (error) {
      console.error('Error building context:', error);
      throw error;
    }
  }

  /**
   * Lookup contact by phone number, create if not exists
   */
  async lookupContact(phone, name = null) {
    console.log(`Looking up contact: ${phone}`);
    
    // Clean phone number (remove spaces, dashes, etc)
    const cleanPhone = phone.replace(/[\s\-\(\)]/g, '');
    
    // Try exact match first
    let contact = this.db.db.prepare(`
      SELECT * FROM contacts 
      WHERE phone = ? OR phone = ?
    `).get(phone, cleanPhone);
    
    // If not found and we have a name, create a basic contact
    if (!contact && name) {
      console.log(`Creating new contact: ${name} (${phone})`);
      
      this.db.db.prepare(`
        INSERT INTO contacts (name, phone, source, created_at, updated_at)
        VALUES (?, ?, 'voice_call', datetime('now'), datetime('now'))
      `).run(name, phone);
      
      // Retrieve the newly created contact
      contact = this.db.db.prepare('SELECT * FROM contacts WHERE phone = ?').get(phone);
    }
    
    if (contact) {
      // Parse preferences if they exist
      try {
        contact.preferences = contact.preferences ? JSON.parse(contact.preferences) : {};
      } catch (e) {
        contact.preferences = {};
      }
      
      console.log(`Found contact: ${contact.name} (relationship: ${contact.relationship || 'unspecified'})`);
    } else {
      console.log('No contact found and no name provided');
    }
    
    return contact;
  }

  /**
   * Get relationship history from session memory RAG
   */
  async getRelationshipHistory(name) {
    if (!name) return [];
    
    console.log(`Searching session memory for mentions of: ${name}`);
    
    try {
      // Use session-memory.js to search for mentions of this person
      const { stdout } = await execAsync(`node tools/session-memory.js search "${name}" --limit 10`);
      
      const history = [];
      const lines = stdout.split('\n');
      
      for (const line of lines) {
        if (line.trim() && !line.startsWith('Searching') && !line.startsWith('Found')) {
          // Extract meaningful context from search results
          if (line.includes(name)) {
            history.push(line.trim());
          }
        }
      }
      
      console.log(`Found ${history.length} relevant memories`);
      return history.slice(0, 5); // Keep top 5 most relevant
      
    } catch (error) {
      console.log('Note: Session memory search not available or failed');
      return [];
    }
  }

  /**
   * Get recent activity related to this contact
   */
  async getRecentActivity(name) {
    if (!name) return [];
    
    try {
      // Search recent activity for mentions of this person
      const activities = this.db.db.prepare(`
        SELECT * FROM activity 
        WHERE description LIKE ? 
        ORDER BY created_at DESC 
        LIMIT 5
      `).all(`%${name}%`);
      
      return activities.map(a => ({
        date: a.created_at,
        action: a.category,
        description: a.description
      }));
      
    } catch (error) {
      console.log('Note: Could not retrieve recent activity');
      return [];
    }
  }

  /**
   * Build suggested topics based on context
   */
  async buildSuggestedTopics(contact, history, purpose) {
    const topics = [];
    
    // Add purpose if provided
    if (purpose) {
      topics.push(purpose);
    }
    
    // Add relationship-specific topics
    if (contact && contact.relationship) {
      if (contact.relationship.toLowerCase().includes('mum') || 
          contact.relationship.toLowerCase().includes('mother')) {
        topics.push('Ask about health and wellbeing');
        topics.push('Family news and updates');
      }
      
      if (contact.relationship.toLowerCase().includes('work') ||
          contact.relationship.toLowerCase().includes('colleague')) {
        topics.push('Work projects and progress');
        topics.push('Professional updates');
      }
    }
    
    // Add preference-based topics
    if (contact && contact.preferences && contact.preferences.interests) {
      topics.push(`Ask about ${contact.preferences.interests}`);
    }
    
    // Extract topics from recent history
    for (const historyItem of history.slice(0, 3)) {
      if (historyItem.toLowerCase().includes('garden')) {
        topics.push('Ask about garden progress');
      }
      if (historyItem.toLowerCase().includes('birthday')) {
        topics.push('Birthday wishes or plans');
      }
      if (historyItem.toLowerCase().includes('travel')) {
        topics.push('Travel experiences or plans');
      }
    }
    
    // Default topics if none found
    if (topics.length === 0) {
      topics.push('General catch-up');
      topics.push('How are things going?');
    }
    
    // Remove duplicates and limit
    return [...new Set(topics)].slice(0, 5);
  }

  /**
   * Update contact with call information
   */
  async updateContactCallInfo(phone, callData = {}) {
    const contact = await this.lookupContact(phone);
    if (!contact) return;
    
    const updates = {};
    
    if (callData.duration) {
      updates.total_calls = (contact.total_calls || 0) + 1;
      updates.last_call = new Date().toISOString();
    }
    
    if (callData.relationship && !contact.relationship) {
      updates.relationship = callData.relationship;
    }
    
    if (callData.preferences) {
      const currentPrefs = contact.preferences || {};
      const newPrefs = { ...currentPrefs, ...callData.preferences };
      updates.preferences = JSON.stringify(newPrefs);
    }
    
    if (Object.keys(updates).length > 0) {
      const setClause = Object.keys(updates).map(key => `${key} = ?`).join(', ');
      const values = Object.values(updates);
      
      this.db.db.prepare(`
        UPDATE contacts 
        SET ${setClause}, updated_at = datetime('now')
        WHERE id = ?
      `).run(...values, contact.id);
      
      console.log(`Updated contact ${contact.name} with call information`);
    }
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help')) {
    console.log(`
Call Context Builder

Usage:
  node tools/call-context.js <phone> [options]

Options:
  --name <name>         Contact name (if not in database)
  --purpose <purpose>   Purpose of the call
  --json                Output raw JSON only
  --update              Update contact after call

Examples:
  node tools/call-context.js +61412345678
  node tools/call-context.js +61412345678 --name Diana --purpose "Birthday reminder"
  node tools/call-context.js +61412345678 --json
    `);
    return;
  }
  
  const phone = args[0];
  const options = {};
  
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--name' && args[i + 1]) {
      options.name = args[i + 1];
      i++;
    } else if (args[i] === '--purpose' && args[i + 1]) {
      options.purpose = args[i + 1];
      i++;
    } else if (args[i] === '--json') {
      options.jsonOnly = true;
    }
  }
  
  try {
    const builder = new CallContextBuilder();
    const context = await builder.buildContext(phone, options);
    
    if (options.jsonOnly) {
      console.log(JSON.stringify(context, null, 2));
    } else {
      console.log('\n=== CALL CONTEXT ===');
      console.log(`Contact: ${context.contact.name} (${context.contact.phone})`);
      console.log(`Relationship: ${context.contact.relationship || 'Unknown'}`);
      
      if (context.call_purpose) {
        console.log(`Purpose: ${context.call_purpose}`);
      }
      
      if (context.history.length > 0) {
        console.log('\nHistory:');
        context.history.forEach(h => console.log(`  - ${h}`));
      }
      
      if (context.suggested_topics.length > 0) {
        console.log('\nSuggested Topics:');
        context.suggested_topics.forEach(t => console.log(`  - ${t}`));
      }
      
      console.log('\n=== JSON OUTPUT ===');
      console.log(JSON.stringify(context, null, 2));
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
  module.exports = CallContextBuilder;
}