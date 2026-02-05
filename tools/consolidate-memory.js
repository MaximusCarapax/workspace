#!/usr/bin/env node

/**
 * Memory Consolidation Tool
 * 
 * Reviews recent daily memory files and suggests/adds entries to MEMORY.md
 * 
 * Usage:
 *   node tools/consolidate-memory.js review          # Review last 7 days, suggest updates
 *   node tools/consolidate-memory.js review --days 3 # Review last 3 days
 *   node tools/consolidate-memory.js apply           # Apply suggested consolidations
 */

const fs = require('fs');
const path = require('path');
const { program } = require('commander');

// Load OpenRouter key
let OPENROUTER_KEY = null;
try {
    const envPath = path.join(__dirname, '..', '.env');
    if (fs.existsSync(envPath)) {
        const env = fs.readFileSync(envPath, 'utf8');
        const match = env.match(/OPENROUTER_API_KEY=(.+)/m);
        if (match) OPENROUTER_KEY = match[1].trim();
    }
    if (!OPENROUTER_KEY) {
        const secretsPath = path.join(process.env.HOME, '.openclaw/secrets/openrouter.json');
        if (fs.existsSync(secretsPath)) {
            const secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
            OPENROUTER_KEY = secrets.api_key || secrets.apiKey;
        }
    }
} catch (e) {}

const MEMORY_DIR = path.join(__dirname, '..', 'memory');
const MEMORY_FILE = path.join(__dirname, '..', 'MEMORY.md');
const SUGGESTIONS_FILE = path.join(MEMORY_DIR, 'consolidation-suggestions.md');

/**
 * Get recent daily memory files
 */
function getRecentDailyFiles(days = 7) {
    const files = [];
    const today = new Date();
    
    for (let i = 0; i < days; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        const filePath = path.join(MEMORY_DIR, `${dateStr}.md`);
        
        if (fs.existsSync(filePath)) {
            files.push({
                date: dateStr,
                path: filePath,
                content: fs.readFileSync(filePath, 'utf8')
            });
        }
    }
    
    return files;
}

/**
 * Load current MEMORY.md content
 */
function loadMemoryFile() {
    if (fs.existsSync(MEMORY_FILE)) {
        return fs.readFileSync(MEMORY_FILE, 'utf8');
    }
    return '';
}

/**
 * Use Gemini to analyze daily files and suggest consolidations
 */
async function analyzeForConsolidation(dailyFiles, existingMemory) {
    if (!OPENROUTER_KEY) {
        throw new Error('OpenRouter API key not found');
    }
    
    const dailyContent = dailyFiles.map(f => 
        `## ${f.date}\n${f.content.substring(0, 3000)}`
    ).join('\n\n---\n\n');
    
    const prompt = `You are reviewing daily memory logs for an AI agent. Your task is to identify entries that should be consolidated into long-term memory.

EXISTING LONG-TERM MEMORY (MEMORY.md):
${existingMemory.substring(0, 4000)}

---

RECENT DAILY LOGS:
${dailyContent}

---

TASK: Identify information from the daily logs that:
1. Represents NEW facts, preferences, or lessons not already in MEMORY.md
2. Is significant enough to remember long-term (not just daily noise)
3. Would be useful for future context

For each item, provide:
- SECTION: Which section of MEMORY.md it belongs in (or "NEW SECTION: <name>")
- CONTENT: The actual text to add (concise, factual)
- REASON: Why this is worth remembering

Format as:
### Suggested Addition 1
**Section:** <section name>
**Content:** <text to add>
**Reason:** <why>

If nothing significant needs to be added, respond with "NO_CONSOLIDATION_NEEDED"`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${OPENROUTER_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'google/gemini-2.0-flash-001',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 2000,
            temperature: 0.3
        })
    });
    
    if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
    }
    
    const data = await response.json();
    return data.choices?.[0]?.message?.content || 'NO_CONSOLIDATION_NEEDED';
}

/**
 * Review command - analyze and suggest consolidations
 */
async function reviewCommand(options) {
    const days = options.days || 7;
    
    console.log(`📚 Reviewing last ${days} days of memory files...\n`);
    
    const dailyFiles = getRecentDailyFiles(days);
    if (dailyFiles.length === 0) {
        console.log('No daily memory files found.');
        return;
    }
    
    console.log(`Found ${dailyFiles.length} daily files:`);
    dailyFiles.forEach(f => console.log(`  - ${f.date}`));
    console.log('');
    
    const existingMemory = loadMemoryFile();
    
    console.log('🔍 Analyzing for consolidation opportunities...\n');
    
    try {
        const suggestions = await analyzeForConsolidation(dailyFiles, existingMemory);
        
        if (suggestions.includes('NO_CONSOLIDATION_NEEDED')) {
            console.log('✅ No consolidation needed - MEMORY.md is up to date.');
            return;
        }
        
        console.log('📝 Suggested consolidations:\n');
        console.log(suggestions);
        
        // Save suggestions for later application
        fs.writeFileSync(SUGGESTIONS_FILE, `# Memory Consolidation Suggestions\n\nGenerated: ${new Date().toISOString()}\nDays reviewed: ${days}\n\n${suggestions}`);
        console.log(`\n💾 Suggestions saved to: ${SUGGESTIONS_FILE}`);
        console.log('Run `node tools/consolidate-memory.js apply` to apply them.');
        
    } catch (e) {
        console.error('Error during analysis:', e.message);
        process.exit(1);
    }
}

/**
 * Apply command - apply saved suggestions (manual review encouraged)
 */
async function applyCommand() {
    if (!fs.existsSync(SUGGESTIONS_FILE)) {
        console.error('No suggestions file found. Run `review` first.');
        process.exit(1);
    }
    
    const suggestions = fs.readFileSync(SUGGESTIONS_FILE, 'utf8');
    console.log('📋 Current suggestions:\n');
    console.log(suggestions);
    console.log('\n⚠️  Manual review recommended before applying.');
    console.log('Edit MEMORY.md directly based on the suggestions above.');
    console.log('\nTo clear suggestions: rm memory/consolidation-suggestions.md');
}

program
    .name('consolidate-memory')
    .description('Consolidate daily memory files into long-term MEMORY.md');

program
    .command('review')
    .description('Review recent daily files and suggest consolidations')
    .option('--days <n>', 'Number of days to review', parseInt, 7)
    .action(reviewCommand);

program
    .command('apply')
    .description('View and apply saved suggestions')
    .action(applyCommand);

program.parse();
