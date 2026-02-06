#!/usr/bin/env node
/**
 * Smart X Mentions System
 * Intelligent scoring, categorization, and relationship tracking for X/Twitter mentions
 * 
 * Usage:
 *   node x-smart-mentions.js check           # Pull, score, categorize new mentions
 *   node x-smart-mentions.js digest          # Show summary by score/category
 *   node x-smart-mentions.js relationship <handle>  # Show relationship data
 *   node x-smart-mentions.js setup          # Create database tables
 * 
 * Components:
 *   1. Mention Scoring (0-100 based on quality, relevance, engagement)
 *   2. Auto-Categorization (question, compliment, criticism, collab, mention, spam)
 *   3. Relationship Tracking (stranger → acquaintance → contact → friend)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const db = require('../lib/db');
const creds = require('../lib/credentials');

// Load existing x-mentions functionality
const xMentionsPath = path.join(__dirname, 'x-mentions.js');

// AI topics for relevance scoring
const AI_KEYWORDS = [
  'ai', 'artificial intelligence', 'machine learning', 'ml', 'llm', 'gpt', 'claude', 
  'gemini', 'agent', 'automation', 'robot', 'bot', 'neural', 'deep learning',
  'prompt', 'chatgpt', 'openai', 'anthropic', 'transformer', 'nlp', 'computer vision'
];

// Initialize database tables
async function setupDatabase() {
  
  // X mentions table with scoring and categorization
  db.db.exec(`
    CREATE TABLE IF NOT EXISTS x_mentions (
      id TEXT PRIMARY KEY,
      author_handle TEXT NOT NULL,
      author_name TEXT,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      conversation_id TEXT,
      
      -- Scoring components
      score INTEGER DEFAULT 0,
      account_quality_score INTEGER DEFAULT 0,
      content_relevance_score INTEGER DEFAULT 0,
      engagement_signal_score INTEGER DEFAULT 0,
      relationship_bonus_score INTEGER DEFAULT 0,
      
      -- Categorization
      category TEXT, -- question, compliment, criticism, collab, mention, spam
      category_confidence REAL,
      
      -- Processing status
      processed_at TEXT,
      responded_at TEXT,
      
      created_at_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // X relationships table
  db.db.exec(`
    CREATE TABLE IF NOT EXISTS x_relationships (
      handle TEXT PRIMARY KEY,
      first_interaction TEXT NOT NULL,
      total_interactions INTEGER DEFAULT 1,
      last_interaction TEXT NOT NULL,
      tier TEXT DEFAULT 'stranger', -- stranger, acquaintance, contact, friend
      notes TEXT, -- JSON array of interaction summaries
      
      -- Account metadata (cached from latest interaction)
      display_name TEXT,
      followers_count INTEGER,
      following_count INTEGER,
      verified BOOLEAN DEFAULT FALSE,
      
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Add indexes for performance
  db.db.exec(`
    CREATE INDEX IF NOT EXISTS idx_x_mentions_score ON x_mentions(score DESC);
    CREATE INDEX IF NOT EXISTS idx_x_mentions_category ON x_mentions(category);
    CREATE INDEX IF NOT EXISTS idx_x_mentions_author ON x_mentions(author_handle);
    CREATE INDEX IF NOT EXISTS idx_x_mentions_created ON x_mentions(created_at_timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_x_relationships_tier ON x_relationships(tier);
    CREATE INDEX IF NOT EXISTS idx_x_relationships_interactions ON x_relationships(total_interactions DESC);
  `);
  
  console.log('✓ Database tables created/updated');
}

// Fetch new mentions using existing x-mentions.js tool
async function fetchNewMentions() {
  try {
    const result = execSync(`node "${xMentionsPath}" check`, {
      encoding: 'utf8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    // Extract JSON from the output - look for lines that start with { and end with }
    const lines = result.split('\n');
    let jsonStartIndex = -1;
    let jsonEndIndex = -1;
    
    // Find the start of JSON (line starting with {)
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().startsWith('{')) {
        jsonStartIndex = i;
        break;
      }
    }
    
    // Find the end of JSON (line ending with })
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim().endsWith('}')) {
        jsonEndIndex = i;
        break;
      }
    }
    
    if (jsonStartIndex === -1 || jsonEndIndex === -1) {
      throw new Error('No valid JSON found in x-mentions.js output');
    }
    
    const jsonOutput = lines.slice(jsonStartIndex, jsonEndIndex + 1).join('\n').trim();
    const mentionsResult = JSON.parse(jsonOutput);
    
    if (mentionsResult.error) {
      throw new Error(mentionsResult.error);
    }
    
    return {
      source: mentionsResult.source,
      mentions: mentionsResult.mentions || [],
      newCount: mentionsResult.newCount || 0
    };
  } catch (error) {
    db.logError({
      source: 'x-smart-mentions',
      message: error.message,
      details: 'Failed to fetch mentions via x-mentions.js',
      stack: error.stack
    });
    throw error;
  }
}

// Score account quality (0-30 points)
function scoreAccountQuality(authorHandle, authorName) {
  let score = 0;
  
  // TODO: In real implementation, we'd fetch these from Twitter API
  // For now, use heuristics based on handle/name patterns
  
  // Handle age heuristics (older patterns typically = more established)
  if (authorHandle && authorHandle.length >= 4 && !authorHandle.includes('_')) {
    score += 5; // Clean handle
  }
  
  // Name completeness
  if (authorName && authorName.length > 3 && !authorName.includes('_')) {
    score += 5; // Real-looking name
  }
  
  // Verification heuristics (can't determine without API)
  // Would add +20 for verified accounts
  
  return Math.min(score, 30);
}

// Score content relevance (0-30 points)
function scoreContentRelevance(text) {
  if (!text) return 0;
  
  const textLower = text.toLowerCase();
  let score = 0;
  
  // Check for AI/automation keywords
  const keywordMatches = AI_KEYWORDS.filter(keyword => 
    textLower.includes(keyword)
  ).length;
  
  score += Math.min(keywordMatches * 5, 25); // Up to 25 points for keyword matches
  
  // Bonus for technical depth indicators
  if (textLower.includes('api') || textLower.includes('code') || textLower.includes('developer')) {
    score += 5;
  }
  
  return Math.min(score, 30);
}

// Score engagement signal (0-25 points)
function scoreEngagementSignal(text) {
  if (!text) return 0;
  
  const textLower = text.toLowerCase();
  let score = 0;
  
  // Question indicators (high engagement potential)
  if (textLower.includes('?') || textLower.includes('how') || textLower.includes('what') || 
      textLower.includes('why') || textLower.includes('when') || textLower.includes('where')) {
    score += 15; // Questions get high score
  }
  
  // Statement/sharing (medium engagement)
  else if (textLower.includes('great') || textLower.includes('love') || 
           textLower.includes('awesome') || textLower.includes('thanks')) {
    score += 10; // Positive statements
  }
  
  // Generic mention (low engagement)
  else {
    score += 5; // Basic mention
  }
  
  // Length bonus (more detailed = more engaged)
  if (text.length > 100) {
    score += 5;
  }
  
  return Math.min(score, 25);
}

// Score relationship bonus (0-15 points)
async function scoreRelationshipBonus(authorHandle) {
  try {
    const relationship = db.db.prepare(
      'SELECT * FROM x_relationships WHERE handle = ?'
    ).get(authorHandle);
    
    if (!relationship) return 0; // New person, no bonus
    
    let bonus = 0;
    
    // Tier bonuses
    switch (relationship.tier) {
      case 'friend': bonus += 15; break;
      case 'contact': bonus += 10; break;
      case 'acquaintance': bonus += 5; break;
      default: bonus += 0;
    }
    
    // Interaction history bonus
    if (relationship.total_interactions >= 5) {
      bonus += 3;
    }
    
    return Math.min(bonus, 15);
  } catch (error) {
    db.logError({
      source: 'x-smart-mentions',
      message: error.message,
      details: `Failed to score relationship bonus for ${authorHandle}`,
      stack: error.stack
    });
    return 0;
  }
}

// Calculate total mention score
async function scoreMention(mention) {
  const accountScore = scoreAccountQuality(mention.author, mention.authorName);
  const relevanceScore = scoreContentRelevance(mention.text);
  const engagementScore = scoreEngagementSignal(mention.text);
  const relationshipBonus = await scoreRelationshipBonus(mention.author);
  
  const totalScore = accountScore + relevanceScore + engagementScore + relationshipBonus;
  
  return {
    total: Math.min(totalScore, 100),
    account_quality: accountScore,
    content_relevance: relevanceScore,
    engagement_signal: engagementScore,
    relationship_bonus: relationshipBonus
  };
}

// Categorize mention using Gemini
async function categorizeMention(mention) {
  const openrouterApiKey = creds.get('openrouter');
  if (!openrouterApiKey) {
    console.warn('OpenRouter API key not found, skipping categorization');
    return { category: 'mention', confidence: 0.5 };
  }
  
  const prompt = `
Categorize this X/Twitter mention into one of these categories:

Categories:
- question: Someone asking a specific question
- compliment: Positive feedback, praise, or appreciation
- criticism: Negative feedback, disagreement, or complaint
- collab: Business/collaboration opportunity, partnership proposal
- mention: Simple mention with no clear action needed
- spam: Irrelevant, promotional, or spam content

Mention text: "${mention.text}"
Author: @${mention.author}

Respond with just the category name (no explanation).
`.trim();

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openrouterApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'google/gemini-2.0-flash-thinking-exp',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 10,
        temperature: 0.1
      })
    });
    
    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status}`);
    }
    
    const result = await response.json();
    const category = result.choices[0]?.message?.content?.trim().toLowerCase();
    
    const validCategories = ['question', 'compliment', 'criticism', 'collab', 'mention', 'spam'];
    const finalCategory = validCategories.includes(category) ? category : 'mention';
    
    return {
      category: finalCategory,
      confidence: 0.9 // High confidence for LLM categorization
    };
    
  } catch (error) {
    db.logError({
      source: 'x-smart-mentions',
      message: error.message,
      details: `Failed to categorize mention ${mention.id}`,
      stack: error.stack
    });
    
    // Fallback to simple heuristics
    const text = mention.text.toLowerCase();
    if (text.includes('?')) return { category: 'question', confidence: 0.7 };
    if (text.includes('great') || text.includes('love') || text.includes('awesome')) {
      return { category: 'compliment', confidence: 0.6 };
    }
    if (text.includes('wrong') || text.includes('bad') || text.includes('disagree')) {
      return { category: 'criticism', confidence: 0.6 };
    }
    if (text.includes('collab') || text.includes('partner') || text.includes('work together')) {
      return { category: 'collab', confidence: 0.7 };
    }
    
    return { category: 'mention', confidence: 0.5 };
  }
}

// Update or create relationship record
async function updateRelationship(mention) {
  try {
    const existing = db.db.prepare(
      'SELECT * FROM x_relationships WHERE handle = ?'
    ).get(mention.author);
    
    if (existing) {
      // Update existing relationship
      const newInteractions = existing.total_interactions + 1;
      let newTier = existing.tier;
      
      // Tier progression logic
      if (newInteractions >= 10 && existing.tier === 'contact') newTier = 'friend';
      else if (newInteractions >= 5 && existing.tier === 'acquaintance') newTier = 'contact';
      else if (newInteractions >= 2 && existing.tier === 'stranger') newTier = 'acquaintance';
      
      // Update notes
      const notes = existing.notes ? JSON.parse(existing.notes) : [];
      const newNote = {
        date: new Date().toISOString().split('T')[0],
        type: 'mention',
        summary: mention.text.substring(0, 100) + (mention.text.length > 100 ? '...' : '')
      };
      notes.unshift(newNote);
      const updatedNotes = notes.slice(0, 10); // Keep last 10 interactions
      
      db.db.prepare(
        `UPDATE x_relationships 
         SET total_interactions = ?, last_interaction = ?, tier = ?, notes = ?,
             display_name = ?, updated_at = CURRENT_TIMESTAMP
         WHERE handle = ?`
      ).run(newInteractions, new Date().toISOString(), newTier, JSON.stringify(updatedNotes),
            mention.authorName, mention.author);
      
      console.log(`Updated relationship: @${mention.author} (${existing.tier} → ${newTier}, ${newInteractions} interactions)`);
    } else {
      // Create new relationship
      const initialNote = {
        date: new Date().toISOString().split('T')[0],
        type: 'mention',
        summary: mention.text.substring(0, 100) + (mention.text.length > 100 ? '...' : '')
      };
      
      db.db.prepare(
        `INSERT INTO x_relationships 
         (handle, first_interaction, total_interactions, last_interaction, tier, notes, display_name)
         VALUES (?, ?, 1, ?, 'stranger', ?, ?)`
      ).run(mention.author, new Date().toISOString(), new Date().toISOString(),
            JSON.stringify([initialNote]), mention.authorName);
      
      console.log(`New relationship: @${mention.author} (stranger, 1 interaction)`);
    }
  } catch (error) {
    db.logError({
      source: 'x-smart-mentions',
      message: error.message,
      details: `Failed to update relationship for ${mention.author}`,
      stack: error.stack
    });
  }
}

// Process a mention (score, categorize, update relationships, store)
async function processMention(mention) {
  try {
    // Check if already processed
    const existing = db.db.prepare(
      'SELECT id FROM x_mentions WHERE id = ?'
    ).get(mention.id);
    
    if (existing) {
      console.log(`Skipping already processed mention: ${mention.id}`);
      return;
    }
    
    // Score the mention
    const scores = await scoreMention(mention);
    
    // Categorize the mention
    const { category, confidence } = await categorizeMention(mention);
    
    // Update relationship
    await updateRelationship(mention);
    
    // Store in database
    db.db.prepare(
      `INSERT INTO x_mentions 
       (id, author_handle, author_name, text, created_at, conversation_id,
        score, account_quality_score, content_relevance_score, 
        engagement_signal_score, relationship_bonus_score,
        category, category_confidence, processed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      mention.id, mention.author, mention.authorName, mention.text,
      mention.createdAt, mention.conversationId,
      scores.total, scores.account_quality, scores.content_relevance,
      scores.engagement_signal, scores.relationship_bonus,
      category, confidence, new Date().toISOString()
    );
    
    console.log(`Processed: @${mention.author} | Score: ${scores.total} | Category: ${category}`);
    
    // Alert for high-value mentions
    if (scores.total >= 80) {
      console.log(`🚨 HIGH-VALUE MENTION (${scores.total}/100): @${mention.author} - ${category}`);
      console.log(`Text: ${mention.text.substring(0, 200)}${mention.text.length > 200 ? '...' : ''}`);
    }
    
  } catch (error) {
    db.logError({
      source: 'x-smart-mentions',
      message: error.message,
      details: `Failed to process mention ${mention.id}`,
      stack: error.stack
    });
    throw error;
  }
}

// Check for new mentions and process them
async function checkAndProcess() {
  try {
    console.log('Fetching new mentions...');
    const { source, mentions, newCount } = await fetchNewMentions();
    
    if (newCount === 0) {
      console.log('No new mentions to process');
      return;
    }
    
    console.log(`Found ${newCount} new mentions via ${source}`);
    
    // Process each mention
    for (const mention of mentions) {
      await processMention(mention);
      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`✓ Processed ${newCount} mentions`);
    
    // Show high-priority items
    const highPriority = await getDigest('high');
    if (highPriority.mentions.length > 0) {
      console.log('\n🔥 High-priority mentions requiring attention:');
      highPriority.mentions.forEach(m => {
        console.log(`  ${m.score}/100 | @${m.author_handle} | ${m.category} | ${m.text.substring(0, 100)}...`);
      });
    }
    
  } catch (error) {
    db.logError({
      source: 'x-smart-mentions',
      message: error.message,
      details: 'Failed during check and process',
      stack: error.stack
    });
    console.error('Error:', error.message);
  }
}

// Get mentions digest
async function getDigest(filter = 'all') {
  let whereClause = '';
  let params = [];
  
  switch (filter) {
    case 'high':
      whereClause = 'WHERE score >= 80';
      break;
    case 'medium':
      whereClause = 'WHERE score >= 50 AND score < 80';
      break;
    case 'today':
      whereClause = 'WHERE DATE(created_at_timestamp) = DATE("now")';
      break;
    case 'unresponded':
      whereClause = 'WHERE responded_at IS NULL AND score >= 50';
      break;
  }
  
  const mentions = db.db.prepare(
    `SELECT * FROM x_mentions ${whereClause} 
     ORDER BY score DESC, created_at_timestamp DESC 
     LIMIT 20`
  ).all(...params);
  
  // Get category breakdown
  const categories = db.db.prepare(
    `SELECT category, COUNT(*) as count, AVG(score) as avg_score
     FROM x_mentions ${whereClause}
     GROUP BY category
     ORDER BY count DESC`
  ).all(...params);
  
  return {
    mentions,
    categories,
    summary: {
      total: mentions.length,
      highPriority: mentions.filter(m => m.score >= 80).length,
      unresponded: mentions.filter(m => !m.responded_at).length
    }
  };
}

// Show relationship data
async function showRelationship(handle) {
  if (!handle) {
    // Show relationship summary
    const relationships = db.db.prepare(
      `SELECT tier, COUNT(*) as count FROM x_relationships 
       GROUP BY tier ORDER BY count DESC`
    ).all();
    
    const recent = db.db.prepare(
      `SELECT handle, tier, total_interactions, last_interaction
       FROM x_relationships 
       ORDER BY last_interaction DESC LIMIT 10`
    ).all();
    
    return { relationships, recent };
  }
  
  // Show specific relationship
  const cleanHandle = handle.replace('@', '');
  const relationship = db.db.prepare(
    'SELECT * FROM x_relationships WHERE handle = ?'
  ).get(cleanHandle);
  
  if (!relationship) {
    return { error: `No relationship found for @${cleanHandle}` };
  }
  
  // Get mention history
  const mentions = db.db.prepare(
    `SELECT id, text, score, category, created_at_timestamp
     FROM x_mentions 
     WHERE author_handle = ?
     ORDER BY created_at_timestamp DESC`
  ).all(cleanHandle);
  
  return {
    relationship: {
      ...relationship,
      notes: relationship.notes ? JSON.parse(relationship.notes) : []
    },
    mentions
  };
}

// CLI handler
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  try {
    switch (command) {
      case 'setup':
        await setupDatabase();
        break;
        
      case 'check':
        await checkAndProcess();
        break;
        
      case 'digest': {
        const filter = args[1] || 'all';
        const result = await getDigest(filter);
        console.log(JSON.stringify(result, null, 2));
        break;
      }
      
      case 'relationship': {
        const handle = args[1];
        const result = await showRelationship(handle);
        console.log(JSON.stringify(result, null, 2));
        break;
      }
      
      default:
        console.log(`
Smart X Mentions System

Usage:
  node x-smart-mentions.js setup                    # Create database tables
  node x-smart-mentions.js check                    # Pull, score, categorize new mentions
  node x-smart-mentions.js digest [filter]          # Show summary (all|high|medium|today|unresponded)
  node x-smart-mentions.js relationship [handle]    # Show relationship data

Components:
  • Mention Scoring (0-100): Account quality + Content relevance + Engagement + Relationship bonus
  • Auto-Categorization: question, compliment, criticism, collab, mention, spam
  • Relationship Tracking: stranger → acquaintance → contact → friend

Examples:
  node x-smart-mentions.js check                    # Process new mentions
  node x-smart-mentions.js digest high              # Show high-priority mentions (80+)
  node x-smart-mentions.js relationship @jason      # Show relationship with @jason
        `);
    }
  } catch (error) {
    db.logError({
      source: 'x-smart-mentions',
      message: error.message,
      details: `Command: ${command}`,
      stack: error.stack
    });
    console.error('Error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  setupDatabase,
  fetchNewMentions,
  scoreMention,
  categorizeMention,
  updateRelationship,
  processMention,
  checkAndProcess,
  getDigest,
  showRelationship
};