#!/usr/bin/env node
/**
 * Content Calendar CLI
 * Track content from idea → draft → review → schedule → publish → track
 * 
 * Usage:
 *   node content.js add "Your idea here" --platform linkedin
 *   node content.js draft <id> "Full post content here"
 *   node content.js score <id> --hook 4 --auth 3 --value 5 --engage 4 --fit 4
 *   node content.js review                              List items needing review
 *   node content.js schedule <id> --date "2026-02-05"
 *   node content.js publish <id> [--url "post_url"]
 *   node content.js track <id> --impressions 1234 --engagements 56 --replies 3
 *   node content.js list [--status ...] [--platform ...]
 *   node content.js view <id>
 *   node content.js stats
 */

const fs = require('fs');
const path = require('path');
const db = require('../lib/db');

const MIN_SCORE = 15; // Minimum score (out of 25) to be schedulable

// Parse args
const args = process.argv.slice(2);
const command = args[0];

function getFlag(flag) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) {
    return args[idx + 1];
  }
  return null;
}

function getFlagInt(flag) {
  const val = getFlag(flag);
  return val ? parseInt(val) : null;
}

function hasFlag(flag) {
  return args.includes(flag);
}

// Format date
function formatDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Status emoji
function statusEmoji(status) {
  const map = {
    idea: '💡',
    draft: '📝',
    reviewed: '✅',
    scheduled: '📅',
    published: '🚀'
  };
  return map[status] || '❓';
}

// Platform emoji
function platformEmoji(platform) {
  const map = {
    linkedin: '🔗',
    x: '𝕏',
    twitter: '𝕏',
    both: '🔗𝕏'
  };
  return map[platform] || '📱';
}

// Truncate text
function truncate(text, len = 50) {
  if (!text) return '';
  if (text.length <= len) return text;
  return text.substring(0, len - 3) + '...';
}

// Calculate total score
function totalScore(scores) {
  if (!scores) return null;
  return (scores.hook || 0) + (scores.authenticity || 0) + (scores.value || 0) + 
         (scores.engagement || 0) + (scores.fit || 0);
}

// Score bar visualization
function scoreBar(score) {
  if (score === null) return '[ - - - - - ]';
  const filled = Math.round(score / 5);
  return '[' + '█'.repeat(filled) + '░'.repeat(5 - filled) + ']';
}

// Commands
const commands = {
  add: () => {
    const content = args.slice(1).filter(a => !a.startsWith('--')).join(' ');
    if (!content) {
      console.log('Usage: content add "Your idea here" [--platform linkedin|x|both]');
      process.exit(1);
    }
    
    const data = loadData();
    const item = {
      id: genId(data),
      hook: content,          // Original idea/hook
      selected_hook: null,    // Chosen hook from generated options
      content: null,          // Full drafted content (null until drafted)
      platform: getFlag('--platform') || 'linkedin',
      status: 'idea',
      scores: null,           // { hook, authenticity, value, engagement, fit }
      review_score: null,     // AI review score (1-10)
      review_notes: null,     // AI review feedback
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      scheduledFor: null,
      publishedAt: null,
      publishedUrl: null,
      notes: '',
      tags: [],
      performance: null       // { impressions, engagements, replies, trackedAt }
    };
    
    data.items.push(item);
    saveData(data);
    console.log(`✅ Added ${item.id}: "${truncate(content, 60)}"`);
    console.log(`   Next: draft full content with: node content.js draft ${item.id} "Full post..."`);
  },
  
  draft: () => {
    const id = args[1];
    
    if (!id) {
      console.log('Usage: content draft <id>');
      console.log('');
      console.log('AI will expand the selected hook into a full post.');
      console.log('Item must have a selected_hook field.');
      process.exit(1);
    }
    
    const data = loadData();
    const item = data.items.find(i => i.id.toLowerCase() === id.toLowerCase());
    
    if (!item) {
      console.log(`❌ Item ${id} not found`);
      process.exit(1);
    }
    
    if (!item.selected_hook) {
      console.log(`❌ Item ${id} has no selected hook. Generate hooks first.`);
      process.exit(1);
    }
    
    console.log(`🤖 Generating draft for ${item.id}...`);
    
    // Build the prompt for Gemini
    const prompt = `Hook: ${item.selected_hook}
Platform: ${item.platform}
Original idea: ${item.hook || 'N/A'} - ${item.notes || 'N/A'}

Write a ${item.platform} post that:
- Opens with this hook
- Delivers value (teach, entertain, or provoke)
- Ends with a CTA or question
- Matches platform conventions

Keep it punchy. No fluff.`;
    
    // Call Gemini API
    const { exec } = require('child_process');
    const path = require('path');
    const geminiPath = path.join(__dirname, 'gemini.js');
    
    exec(`node "${geminiPath}" "${prompt.replace(/"/g, '\\"')}"`, (error, stdout, stderr) => {
      if (error) {
        console.log(`❌ AI call failed: ${error.message}`);
        process.exit(1);
      }
      
      if (stderr) {
        console.log(`⚠️ AI warning: ${stderr}`);
      }
      
      const generatedContent = stdout.trim();
      
      if (!generatedContent) {
        console.log(`❌ AI returned empty content`);
        process.exit(1);
      }
      
      // Update the item
      item.content = generatedContent;
      item.status = 'draft';
      item.updatedAt = new Date().toISOString();
      saveData(data);
      
      console.log(`📝 AI drafted ${item.id} (${generatedContent.length} chars)`);
      console.log(`   Next: review it with: node content.js review ${item.id}`);
      console.log('');
      console.log('Generated content:');
      console.log('─'.repeat(50));
      console.log(generatedContent);
    });
  },

  review: () => {
    const id = args[1];
    
    // If ID is provided, do AI review of specific item
    if (id) {
    
    const data = loadData();
    const item = data.items.find(i => i.id.toLowerCase() === id.toLowerCase());
    
    if (!item) {
      console.log(`❌ Item ${id} not found`);
      process.exit(1);
    }
    
    if (!item.content) {
      console.log(`❌ Item ${id} has no draft content. Draft it first.`);
      process.exit(1);
    }
    
    console.log(`🔍 AI reviewing ${item.id}...`);
    
    // Build the prompt for Gemini
    const prompt = `Draft: ${item.content}
Platform: ${item.platform}

Score this draft on 5 criteria (1-10 scale):
1. Hook strength - Does it stop the scroll?
2. Clarity - Is the message clear and concise?
3. Value delivered - Does it teach, entertain, or provoke?
4. CTA effectiveness - Does it encourage engagement?
5. Platform fit - Does it match platform conventions?

Return JSON: {"hook_score": N, "clarity_score": N, "value_score": N, "cta_score": N, "platform_score": N, "average_score": N.N, "notes": "detailed feedback"}`;
    
    // Call Gemini API
    const { exec } = require('child_process');
    const path = require('path');
    const geminiPath = path.join(__dirname, 'gemini.js');
    
    exec(`node "${geminiPath}" "${prompt.replace(/"/g, '\\"')}"`, (error, stdout, stderr) => {
      if (error) {
        console.log(`❌ AI call failed: ${error.message}`);
        process.exit(1);
      }
      
      if (stderr) {
        console.log(`⚠️ AI warning: ${stderr}`);
      }
      
      const responseText = stdout.trim();
      
      if (!responseText) {
        console.log(`❌ AI returned empty response`);
        process.exit(1);
      }
      
      let review;
      try {
        // Try to parse JSON from the response
        const jsonMatch = responseText.match(/\{.*\}/s);
        if (jsonMatch) {
          review = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('No JSON found in response');
        }
      } catch (e) {
        console.log(`❌ Failed to parse AI response as JSON: ${e.message}`);
        console.log(`Raw response: ${responseText}`);
        process.exit(1);
      }
      
      // Validate the review structure
      if (!review.average_score || typeof review.average_score !== 'number') {
        console.log(`❌ Invalid review format: missing or invalid average_score`);
        process.exit(1);
      }
      
      // Update the item
      item.review_score = review.average_score;
      item.review_notes = review.notes || 'No detailed feedback provided';
      item.status = 'review';
      item.updatedAt = new Date().toISOString();
      saveData(data);
      
      const score = review.average_score;
      const status = score >= 7 ? '✅ APPROVED' : score >= 5 ? '⚠️ NEEDS WORK' : '❌ REJECTED';
      
      console.log(`🔍 AI reviewed ${item.id}: ${score}/10 — ${status}`);
      
      // Show breakdown
      console.log('');
      console.log('Breakdown:');
      if (review.hook_score) console.log(`  Hook strength:    ${review.hook_score}/10`);
      if (review.clarity_score) console.log(`  Clarity:          ${review.clarity_score}/10`);
      if (review.value_score) console.log(`  Value delivered:  ${review.value_score}/10`);
      if (review.cta_score) console.log(`  CTA effectiveness: ${review.cta_score}/10`);
      if (review.platform_score) console.log(`  Platform fit:     ${review.platform_score}/10`);
      
      console.log('');
      console.log('Feedback:');
      console.log(review.notes);
      
      if (score >= 7) {
        console.log('');
        console.log(`Next: schedule with: node content.js approve ${item.id} --date "YYYY-MM-DD"`);
      } else {
        console.log('');
        console.log('Consider revising the draft or creating a new one.');
      }
    });
  },
  
  score: () => {
    const id = args[1];
    if (!id) {
      console.log('Usage: content score <id> --hook <1-5> --auth <1-5> --value <1-5> --engage <1-5> --fit <1-5>');
      console.log('');
      console.log('Scoring criteria (see CONTENT_STANDARDS.md):');
      console.log('  --hook    Hook strength (stops the scroll?)');
      console.log('  --auth    Authenticity (distinctly MY voice?)');
      console.log('  --value   Value density (insight-packed?)');
      console.log('  --engage  Engagement potential (will spark conversation?)');
      console.log('  --fit     Platform fit (right for the channel?)');
      console.log('');
      console.log(`Minimum ${MIN_SCORE}/25 required to schedule.`);
      process.exit(1);
    }
    
    const data = loadData();
    const item = data.items.find(i => i.id.toLowerCase() === id.toLowerCase());
    
    if (!item) {
      console.log(`❌ Item ${id} not found`);
      process.exit(1);
    }
    
    const hook = getFlagInt('--hook');
    const auth = getFlagInt('--auth');
    const value = getFlagInt('--value');
    const engage = getFlagInt('--engage');
    const fit = getFlagInt('--fit');
    
    if (!hook || !auth || !value || !engage || !fit) {
      console.log('❌ All five scores required: --hook --auth --value --engage --fit');
      process.exit(1);
    }
    
    // Validate ranges
    const scores = [hook, auth, value, engage, fit];
    if (scores.some(s => s < 1 || s > 5)) {
      console.log('❌ All scores must be between 1 and 5');
      process.exit(1);
    }
    
    item.scores = {
      hook,
      authenticity: auth,
      value,
      engagement: engage,
      fit
    };
    
    const total = totalScore(item.scores);
    
    if (total >= MIN_SCORE) {
      item.status = 'reviewed';
      console.log(`✅ Scored ${item.id}: ${total}/25 — APPROVED`);
      console.log(`   Next: schedule with: node content.js schedule ${item.id} --date "YYYY-MM-DD"`);
    } else {
      console.log(`⚠️ Scored ${item.id}: ${total}/25 — BELOW THRESHOLD (${MIN_SCORE} required)`);
      console.log(`   Revise the draft or kill it.`);
    }
    
    item.updatedAt = new Date().toISOString();
    saveData(data);
    
    // Show breakdown
    console.log('');
    console.log('   Breakdown:');
    console.log(`     Hook:       ${hook}/5 ${scoreBar(hook)}`);
    console.log(`     Authentic:  ${auth}/5 ${scoreBar(auth)}`);
    console.log(`     Value:      ${value}/5 ${scoreBar(value)}`);
    console.log(`     Engagement: ${engage}/5 ${scoreBar(engage)}`);
    console.log(`     Fit:        ${fit}/5 ${scoreBar(fit)}`);
  },
  
  review: () => {
    const data = loadData();
    
    // Items needing review: have draft content but no scores, or scored below threshold
    const needsReview = data.items.filter(i => {
      if (i.status === 'draft' && i.content && !i.scores) return true;
      if (i.scores && totalScore(i.scores) < MIN_SCORE) return true;
      return false;
    });
    
    // Items ready to schedule: reviewed but not scheduled
    const readyToSchedule = data.items.filter(i => 
      i.status === 'reviewed' && !i.scheduledFor
    );
    
    if (needsReview.length === 0 && readyToSchedule.length === 0) {
      console.log('✨ No items need review!');
      return;
    }
    
    if (needsReview.length > 0) {
      console.log(`\n🔍 NEEDS REVIEW (${needsReview.length})`);
      console.log('─'.repeat(60));
      needsReview.forEach(i => {
        const scoreStr = i.scores ? `${totalScore(i.scores)}/25 ⚠️` : 'unscored';
        console.log(`  ${i.id} ${platformEmoji(i.platform)} ${truncate(i.hook, 40)} [${scoreStr}]`);
      });
    }
    
    if (readyToSchedule.length > 0) {
      console.log(`\n📅 READY TO SCHEDULE (${readyToSchedule.length})`);
      console.log('─'.repeat(60));
      readyToSchedule.forEach(i => {
        const score = totalScore(i.scores);
        console.log(`  ${i.id} ${platformEmoji(i.platform)} ${truncate(i.hook, 40)} [${score}/25 ✅]`);
      });
    }
    console.log('');
  },
  
  list: () => {
    const data = loadData();
    let items = data.items;
    
    const statusFilter = getFlag('--status');
    const platformFilter = getFlag('--platform');
    
    if (statusFilter) {
      items = items.filter(i => i.status === statusFilter);
    }
    if (platformFilter) {
      items = items.filter(i => i.platform === platformFilter || i.platform === 'both');
    }
    
    if (items.length === 0) {
      console.log('No content items found.');
      return;
    }
    
    // Group by status
    const grouped = { idea: [], draft: [], reviewed: [], scheduled: [], published: [] };
    items.forEach(i => {
      if (grouped[i.status]) grouped[i.status].push(i);
    });
    
    for (const [status, group] of Object.entries(grouped)) {
      if (group.length === 0) continue;
      console.log(`\n${statusEmoji(status)} ${status.toUpperCase()} (${group.length})`);
      console.log('─'.repeat(60));
      
      group.forEach(i => {
        const sched = i.scheduledFor ? ` 📅 ${formatDate(i.scheduledFor)}` : '';
        const score = i.scores ? ` [${totalScore(i.scores)}/25]` : '';
        console.log(`  ${i.id} ${platformEmoji(i.platform)} ${truncate(i.hook || i.content, 40)}${score}${sched}`);
      });
    }
    console.log('');
  },
  
  view: () => {
    const id = args[1];
    if (!id) {
      console.log('Usage: content view <id>');
      process.exit(1);
    }
    
    const data = loadData();
    const item = data.items.find(i => i.id.toLowerCase() === id.toLowerCase());
    
    if (!item) {
      console.log(`❌ Item ${id} not found`);
      process.exit(1);
    }
    
    console.log(`\n${statusEmoji(item.status)} ${item.id} - ${item.status.toUpperCase()}`);
    console.log('─'.repeat(60));
    console.log(`Platform:  ${platformEmoji(item.platform)} ${item.platform}`);
    console.log(`Created:   ${formatDate(item.createdAt)}`);
    console.log(`Updated:   ${formatDate(item.updatedAt)}`);
    if (item.scheduledFor) console.log(`Scheduled: ${formatDate(item.scheduledFor)}`);
    if (item.publishedAt) console.log(`Published: ${formatDate(item.publishedAt)}`);
    if (item.publishedUrl) console.log(`URL:       ${item.publishedUrl}`);
    if (item.tags.length) console.log(`Tags:      ${item.tags.join(', ')}`);
    
    if (item.scores) {
      const total = totalScore(item.scores);
      console.log('─'.repeat(60));
      console.log(`Score: ${total}/25 ${total >= MIN_SCORE ? '✅' : '⚠️'}`);
      console.log(`  Hook:       ${item.scores.hook}/5`);
      console.log(`  Authentic:  ${item.scores.authenticity}/5`);
      console.log(`  Value:      ${item.scores.value}/5`);
      console.log(`  Engagement: ${item.scores.engagement}/5`);
      console.log(`  Fit:        ${item.scores.fit}/5`);
    }
    
    console.log('─'.repeat(60));
    console.log('\nHook/Idea:');
    console.log(item.hook || '(none)');
    
    if (item.content) {
      console.log('\nFull Draft:');
      console.log(item.content);
    }
    
    if (item.notes) {
      console.log('\nNotes:');
      console.log(item.notes);
    }
    
    if (item.performance) {
      console.log('\n📊 Performance:');
      console.log(`  Impressions:  ${item.performance.impressions || '-'}`);
      console.log(`  Engagements:  ${item.performance.engagements || '-'}`);
      console.log(`  Replies:      ${item.performance.replies || '-'}`);
      console.log(`  Tracked:      ${formatDate(item.performance.trackedAt)}`);
    }
    console.log('');
  },
  
  edit: () => {
    const id = args[1];
    if (!id) {
      console.log('Usage: content edit <id> [--hook "..."] [--content "..."] [--status ...] [--platform ...] [--notes "..."] [--tags "a,b,c"]');
      process.exit(1);
    }
    
    const data = loadData();
    const item = data.items.find(i => i.id.toLowerCase() === id.toLowerCase());
    
    if (!item) {
      console.log(`❌ Item ${id} not found`);
      process.exit(1);
    }
    
    const hook = getFlag('--hook');
    const content = getFlag('--content');
    const status = getFlag('--status');
    const platform = getFlag('--platform');
    const notes = getFlag('--notes');
    const tags = getFlag('--tags');
    
    if (hook) item.hook = hook;
    if (content) item.content = content;
    if (status) item.status = status;
    if (platform) item.platform = platform;
    if (notes) item.notes = notes;
    if (tags) item.tags = tags.split(',').map(t => t.trim());
    
    item.updatedAt = new Date().toISOString();
    saveData(data);
    
    console.log(`✅ Updated ${item.id}`);
  },
  
  schedule: () => {
    const id = args[1];
    const date = getFlag('--date');
    
    if (!id || !date) {
      console.log('Usage: content schedule <id> --date "2026-02-05"');
      process.exit(1);
    }
    
    const data = loadData();
    const item = data.items.find(i => i.id.toLowerCase() === id.toLowerCase());
    
    if (!item) {
      console.log(`❌ Item ${id} not found`);
      process.exit(1);
    }
    
    // Check if scored and passing
    if (!item.scores) {
      console.log(`⚠️ Item ${id} hasn't been scored yet. Score it first.`);
      process.exit(1);
    }
    
    const score = totalScore(item.scores);
    if (score < MIN_SCORE) {
      console.log(`⚠️ Item ${id} scored ${score}/25 — below ${MIN_SCORE} threshold. Revise first.`);
      process.exit(1);
    }
    
    if (!item.content) {
      console.log(`⚠️ Item ${id} has no draft content. Draft it first.`);
      process.exit(1);
    }
    
    item.status = 'scheduled';
    item.scheduledFor = new Date(date).toISOString();
    item.updatedAt = new Date().toISOString();
    saveData(data);
    
    console.log(`📅 Scheduled ${item.id} for ${formatDate(item.scheduledFor)}`);
  },
  
  publish: () => {
    const id = args[1];
    if (!id) {
      console.log('Usage: content publish <id> [--url "https://..."]');
      process.exit(1);
    }
    
    const data = loadData();
    const item = data.items.find(i => i.id.toLowerCase() === id.toLowerCase());
    
    if (!item) {
      console.log(`❌ Item ${id} not found`);
      process.exit(1);
    }
    
    item.status = 'published';
    item.publishedAt = new Date().toISOString();
    if (getFlag('--url')) item.publishedUrl = getFlag('--url');
    item.updatedAt = new Date().toISOString();
    saveData(data);
    
    console.log(`🚀 Published ${item.id}`);
    if (item.publishedUrl) console.log(`   URL: ${item.publishedUrl}`);
    console.log(`   Track performance later: node content.js track ${item.id} --impressions X --engagements Y --replies Z`);
  },
  
  track: () => {
    const id = args[1];
    if (!id) {
      console.log('Usage: content track <id> --impressions <n> --engagements <n> --replies <n>');
      process.exit(1);
    }
    
    const data = loadData();
    const item = data.items.find(i => i.id.toLowerCase() === id.toLowerCase());
    
    if (!item) {
      console.log(`❌ Item ${id} not found`);
      process.exit(1);
    }
    
    const impressions = getFlagInt('--impressions');
    const engagements = getFlagInt('--engagements');
    const replies = getFlagInt('--replies');
    
    item.performance = {
      impressions: impressions || item.performance?.impressions || 0,
      engagements: engagements || item.performance?.engagements || 0,
      replies: replies || item.performance?.replies || 0,
      trackedAt: new Date().toISOString()
    };
    
    item.updatedAt = new Date().toISOString();
    saveData(data);
    
    console.log(`📊 Tracked ${item.id}:`);
    console.log(`   Impressions: ${item.performance.impressions}`);
    console.log(`   Engagements: ${item.performance.engagements}`);
    console.log(`   Replies: ${item.performance.replies}`);
    
    // Calculate engagement rate
    if (item.performance.impressions > 0) {
      const rate = ((item.performance.engagements / item.performance.impressions) * 100).toFixed(2);
      console.log(`   Engagement rate: ${rate}%`);
    }
  },
  
  delete: () => {
    const id = args[1];
    if (!id) {
      console.log('Usage: content delete <id>');
      process.exit(1);
    }
    
    const data = loadData();
    const idx = data.items.findIndex(i => i.id.toLowerCase() === id.toLowerCase());
    
    if (idx === -1) {
      console.log(`❌ Item ${id} not found`);
      process.exit(1);
    }
    
    const removed = data.items.splice(idx, 1)[0];
    saveData(data);
    
    console.log(`🗑️ Deleted ${removed.id}: "${truncate(removed.hook || removed.content, 40)}"`);
  },
  
  kanban: () => {
    const data = loadData();
    const items = data.items;
    
    // Group items by status (map old status names to display names)
    const statusMapping = {
      idea: 'IDEAS',
      hooks: 'HOOKS', 
      draft: 'DRAFTS',
      review: 'REVIEW',
      reviewed: 'REVIEW', // map old 'reviewed' to 'REVIEW'
      scheduled: 'SCHEDULED',
      published: 'POSTED'
    };
    
    const columns = {
      'IDEAS': [],
      'HOOKS': [],
      'DRAFTS': [], 
      'REVIEW': [],
      'SCHEDULED': [],
      'POSTED': []
    };
    
    // Group items into columns
    items.forEach(item => {
      const displayStatus = statusMapping[item.status] || item.status.toUpperCase();
      if (columns[displayStatus]) {
        columns[displayStatus].push(item);
      }
    });
    
    // Calculate column widths (aim for ~15 chars each, adjust based on content)
    const colWidth = 18;
    const statusKeys = ['IDEAS', 'HOOKS', 'DRAFTS', 'REVIEW', 'SCHEDULED', 'POSTED'];
    
    // Print headers with counts
    console.log('');
    const headerLine = statusKeys
      .map(status => `${status} (${columns[status].length})`.padEnd(colWidth))
      .join('');
    console.log(headerLine);
    
    // Print separator line
    console.log('─'.repeat(headerLine.length));
    
    // Find max rows needed
    const maxRows = Math.max(...statusKeys.map(status => columns[status].length), 1);
    
    // Print items row by row
    for (let row = 0; row < maxRows; row++) {
      const rowData = statusKeys.map(status => {
        const items = columns[status];
        if (row < items.length) {
          const item = items[row];
          const title = truncate(item.hook || item.content || '(no content)', 15);
          return `${item.id}: ${title}`.padEnd(colWidth);
        } else {
          return '-'.padEnd(colWidth);
        }
      }).join('');
      
      console.log(rowData);
    }
    console.log('');
  },
  
  stats: () => {
    const data = loadData();
    const items = data.items;
    
    // Enhanced status mapping for display
    const statusMapping = {
      idea: 'IDEAS',
      hooks: 'HOOKS',
      draft: 'DRAFTS', 
      review: 'REVIEW',
      reviewed: 'REVIEW', // map old 'reviewed' to 'REVIEW'
      scheduled: 'SCHEDULED',
      published: 'POSTED'
    };
    
    const byStatus = {};
    const byPlatform = { linkedin: 0, x: 0, both: 0 };
    
    // Count by mapped status
    items.forEach(i => {
      const displayStatus = statusMapping[i.status] || i.status;
      byStatus[displayStatus] = (byStatus[displayStatus] || 0) + 1;
      byPlatform[i.platform] = (byPlatform[i.platform] || 0) + 1;
    });
    
    console.log('\n📊 Content Pipeline Stats');
    console.log('─'.repeat(50));
    console.log(`Total items: ${items.length}`);
    console.log('');
    
    // Status breakdown with better formatting
    console.log('By Status:');
    const statusOrder = ['IDEAS', 'HOOKS', 'DRAFTS', 'REVIEW', 'SCHEDULED', 'POSTED'];
    statusOrder.forEach(status => {
      const count = byStatus[status] || 0;
      if (count > 0) {
        const emoji = status === 'IDEAS' ? '💡' : 
                     status === 'HOOKS' ? '🪝' :
                     status === 'DRAFTS' ? '📝' :
                     status === 'REVIEW' ? '🔍' :
                     status === 'SCHEDULED' ? '📅' : '🚀';
        console.log(`  ${emoji} ${status}: ${count}`);
      }
    });
    
    console.log('');
    console.log('By Platform:');
    Object.entries(byPlatform).forEach(([p, c]) => {
      if (c > 0) console.log(`  ${platformEmoji(p)} ${p}: ${c}`);
    });
    
    // Review score analysis
    const scoredItems = items.filter(i => i.scores);
    if (scoredItems.length > 0) {
      const avgScores = {
        hook: 0, authenticity: 0, value: 0, engagement: 0, fit: 0
      };
      
      scoredItems.forEach(item => {
        avgScores.hook += item.scores.hook || 0;
        avgScores.authenticity += item.scores.authenticity || 0;
        avgScores.value += item.scores.value || 0;
        avgScores.engagement += item.scores.engagement || 0;
        avgScores.fit += item.scores.fit || 0;
      });
      
      Object.keys(avgScores).forEach(key => {
        avgScores[key] = (avgScores[key] / scoredItems.length).toFixed(1);
      });
      
      const avgTotal = (scoredItems.reduce((sum, item) => sum + totalScore(item.scores), 0) / scoredItems.length).toFixed(1);
      
      console.log('');
      console.log(`📋 Review Scores (${scoredItems.length} items scored):`);
      console.log(`  Average Total: ${avgTotal}/25.0`);
      console.log(`  Hook:         ${avgScores.hook}/5.0`);
      console.log(`  Authenticity: ${avgScores.authenticity}/5.0`);
      console.log(`  Value:        ${avgScores.value}/5.0`);
      console.log(`  Engagement:   ${avgScores.engagement}/5.0`);
      console.log(`  Platform Fit: ${avgScores.fit}/5.0`);
    }
    
    // Time-based stats
    const now = new Date();
    const oneWeekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const oneMonthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
    
    const postsThisWeek = items.filter(i => 
      i.status === 'published' && i.createdAt && new Date(i.createdAt) >= oneWeekAgo
    ).length;
    
    const postsThisMonth = items.filter(i => 
      i.status === 'published' && i.createdAt && new Date(i.createdAt) >= oneMonthAgo
    ).length;
    
    const newIdeasThisWeek = items.filter(i =>
      i.status === 'idea' && i.createdAt && new Date(i.createdAt) >= oneWeekAgo
    ).length;
    
    console.log('');
    console.log('📅 Recent Activity:');
    console.log(`  Posts this week:  ${postsThisWeek}`);
    console.log(`  Posts this month: ${postsThisMonth}`);
    console.log(`  New ideas this week: ${newIdeasThisWeek}`);
    
    // Upcoming scheduled
    const scheduled = items
      .filter(i => i.status === 'scheduled' && i.scheduledFor)
      .sort((a, b) => new Date(a.scheduledFor) - new Date(b.scheduledFor))
      .slice(0, 5);
    
    if (scheduled.length > 0) {
      console.log('');
      console.log('📅 Next up:');
      scheduled.forEach(i => {
        const score = i.scores ? `[${totalScore(i.scores)}/25]` : '';
        console.log(`  ${formatDate(i.scheduledFor)} - ${truncate(i.hook, 35)} ${score}`);
      });
    }
    console.log('');
  },
  
  help: () => {
    console.log(`
📝 Content Calendar CLI

Workflow: idea → draft → score → schedule → publish → track

Commands:
  add <idea> [--platform linkedin|x|both]     Add new idea
  draft <id>                                  AI generates full post from selected hook
  review <id>                                 AI scores draft on 5 criteria (1-10 scale)
  score <id> --hook N --auth N --value N      Manual score (1-5 each, legacy)
            --engage N --fit N                Min ${MIN_SCORE}/25 to schedule
  review                                      List items needing review
  schedule <id> --date "YYYY-MM-DD"           Schedule approved content
  publish <id> [--url "..."]                  Mark as published
  track <id> --impressions N --engagements N  Log performance metrics
            --replies N
  kanban                                      Show content pipeline in columns
  list [--status ...] [--platform ...]        List items
  view <id>                                   View item details
  edit <id> [--hook] [--content] [--status]   Edit item fields
           [--platform] [--notes] [--tags]
  delete <id>                                 Delete item
  stats                                       Enhanced pipeline statistics

Statuses: idea → draft → reviewed → scheduled → published
Platforms: linkedin, x, both

Scoring (see CONTENT_STANDARDS.md):
  --hook     Hook strength (stops the scroll?)
  --auth     Authenticity (distinctly MY voice?)
  --value    Value density (insight-packed?)
  --engage   Engagement potential (sparks conversation?)
  --fit      Platform fit (right for the channel?)

Examples:
  node content.js add "AI agents need proactive behavior" --platform linkedin
  node content.js draft C009 "Full 200-word post about AI agents..."
  node content.js score C009 --hook 4 --auth 5 --value 4 --engage 3 --fit 4
  node content.js schedule C009 --date "2026-02-05"
  node content.js publish C009 --url "https://linkedin.com/posts/..."
  node content.js track C009 --impressions 5000 --engagements 150 --replies 12
  node content.js kanban                      # View pipeline kanban board
  node content.js stats                       # Enhanced statistics with scores
`);
  }
};

// Run command
if (!command || command === 'help' || command === '-h' || command === '--help') {
  commands.help();
} else if (commands[command]) {
  commands[command]();
} else {
  console.log(`Unknown command: ${command}`);
  console.log('Run "node content.js help" for usage');
  process.exit(1);
}
