#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { program } = require('commander');

// Import our existing utilities
const creds = require('../lib/credentials');

const WORKSPACE_ROOT = path.join(process.env.HOME, '.openclaw', 'workspace');
const SOUL_PATH = path.join(WORKSPACE_ROOT, 'SOUL.md');
const PATTERNS_DIR = path.join(WORKSPACE_ROOT, 'memory', 'patterns');
const MEMORY_DIR = path.join(WORKSPACE_ROOT, 'memory');
const IDENTITY_EVOLUTION_PATH = path.join(MEMORY_DIR, 'identity-evolution.md');

// OpenRouter API configuration
async function callOpenRouter(prompt) {
    const openrouterKey = creds.get('openrouter');
    if (!openrouterKey) {
        throw new Error('OPENROUTER_API_KEY not found');
    }
    
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${openrouterKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://openclaw.ai',
            'X-Title': 'OpenClaw Identity Analysis'
        },
        body: JSON.stringify({
            model: 'google/gemini-2.5-flash-lite',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 1200
        })
    });

    if (!res.ok) {
        const error = await res.text();
        throw new Error(`OpenRouter error: ${res.status} - ${error}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    
    if (text) {
        return text;
    }
    
    throw new Error('No response from OpenRouter');
}

function ensureIdentityFile() {
    if (!fs.existsSync(MEMORY_DIR)) {
        fs.mkdirSync(MEMORY_DIR, { recursive: true });
    }
    
    if (!fs.existsSync(IDENTITY_EVOLUTION_PATH)) {
        const header = `# Identity Evolution Log

This file tracks how my actual behavior and patterns compare to my defined identity in SOUL.md over time.

## Format
Each entry includes:
- **Consistent Behaviors**: What aligns with my stated identity
- **Emergent Traits**: New patterns not captured in SOUL.md
- **Contradictions**: Where behavior conflicts with stated values
- **Evolution**: How my identity is actually developing

---

`;
        fs.writeFileSync(IDENTITY_EVOLUTION_PATH, header);
    }
}

function loadSoul() {
    if (!fs.existsSync(SOUL_PATH)) {
        throw new Error('SOUL.md not found. This tool requires a defined identity baseline.');
    }
    return fs.readFileSync(SOUL_PATH, 'utf8');
}

function getRecentPatterns(weeksBack = 4) {
    if (!fs.existsSync(PATTERNS_DIR)) {
        return [];
    }

    const patternFiles = fs.readdirSync(PATTERNS_DIR)
        .filter(f => f.match(/^\d{4}-W\d{2}\.md$/))
        .sort()
        .reverse()
        .slice(0, weeksBack);

    const patterns = [];
    patternFiles.forEach(file => {
        try {
            const content = fs.readFileSync(path.join(PATTERNS_DIR, file), 'utf8');
            patterns.push({
                week: file.replace('.md', ''),
                content: content
            });
        } catch (error) {
            console.error(`Error reading pattern file ${file}: ${error.message}`);
        }
    });

    return patterns;
}

async function analyzeIdentityEvolution(soul, patterns) {
    if (patterns.length === 0) {
        return {
            consistent_behaviors: ["No recent patterns to analyze"],
            emergent_traits: ["Insufficient data for analysis"],
            contradictions: ["Cannot identify without pattern data"],
            evolution_summary: "No recent pattern data available for identity analysis."
        };
    }

    const prompt = `Compare my actual behavior patterns against my defined identity to track evolution.

**My Defined Identity (SOUL.md):**
${soul}

**Recent Behavior Patterns:**
${patterns.map(p => `
**${p.week}:**
${p.content}
`).join('\n')}

Analyze the relationship between my defined identity and actual behavior patterns. Provide a JSON response with:

{
  "consistent_behaviors": ["behavior 1", "behavior 2", ...],
  "emergent_traits": ["new trait 1", "new trait 2", ...],
  "contradictions": ["contradiction 1", "contradiction 2", ...],
  "evolution_summary": "2-3 sentences about how my identity is actually developing"
}

Focus on:
- **Consistent behaviors**: What patterns align with my stated identity in SOUL.md?
- **Emergent traits**: What new consistent patterns appear that aren't captured in SOUL.md?
- **Contradictions**: Where does my actual behavior conflict with my stated values/approach?
- **Evolution summary**: How is my identity actually developing vs. what's written?

Be specific and evidence-based. Reference actual patterns from the data.`;

    try {
        const response = await callOpenRouter(prompt);

        // Try to extract JSON from the response
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        } else {
            // Fallback: parse structured text response
            return {
                consistent_behaviors: ["Could not parse structured analysis"],
                emergent_traits: ["Review needed"],
                contradictions: ["Analysis incomplete"],
                evolution_summary: response.substring(0, 200) + "..."
            };
        }
    } catch (error) {
        console.error(`Error in identity analysis: ${error.message}`);
        return {
            consistent_behaviors: [`Analysis failed: ${error.message}`],
            emergent_traits: ["Tool needs debugging"],
            contradictions: ["Identity analysis system issues"],
            evolution_summary: "Technical error prevented identity analysis."
        };
    }
}

function formatIdentityEntry(analysis, patternsAnalyzed) {
    const timestamp = new Date().toISOString();
    const date = new Date().toLocaleDateString();
    
    return `

## Identity Analysis - ${date}

**Timestamp:** ${timestamp}  
**Patterns analyzed:** ${patternsAnalyzed} weeks  

### ✅ Consistent Behaviors
${analysis.consistent_behaviors.map(b => `- ${b}`).join('\n')}

### 🌱 Emergent Traits
${analysis.emergent_traits.map(t => `- ${t}`).join('\n')}

### ⚠️ Contradictions
${analysis.contradictions.map(c => `- ${c}`).join('\n')}

### 📈 Evolution Summary
${analysis.evolution_summary}

---`;
}

async function trackIdentityEvolution(options) {
    ensureIdentityFile();
    
    console.log('🔍 Analyzing identity evolution...');
    
    try {
        const soul = loadSoul();
        const patterns = getRecentPatterns(options.weeks || 4);
        
        console.log(`📊 Found ${patterns.length} weeks of pattern data`);
        
        if (patterns.length === 0) {
            console.log('⚠️  No pattern data found. Run weekly pattern analysis first.');
            return;
        }
        
        const analysis = await analyzeIdentityEvolution(soul, patterns);
        const entry = formatIdentityEntry(analysis, patterns.length);
        
        // Append to identity evolution file
        fs.appendFileSync(IDENTITY_EVOLUTION_PATH, entry);
        
        console.log(`✅ Identity analysis complete and logged to ${IDENTITY_EVOLUTION_PATH}`);
        console.log('\n📋 Quick Summary:');
        console.log(`   Consistent behaviors: ${analysis.consistent_behaviors.length}`);
        console.log(`   Emergent traits: ${analysis.emergent_traits.length}`);
        console.log(`   Contradictions: ${analysis.contradictions.length}`);
        
        if (options.show) {
            console.log('\n' + entry);
        }
        
        // Flag significant contradictions
        if (analysis.contradictions.length > 0 && !analysis.contradictions[0].includes('Analysis failed')) {
            console.log('\n⚠️  Contradictions detected! Consider reviewing SOUL.md or examining these behaviors:');
            analysis.contradictions.forEach(c => console.log(`   - ${c}`));
        }
        
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
}

function showEvolution(options) {
    ensureIdentityFile();
    
    if (!fs.existsSync(IDENTITY_EVOLUTION_PATH)) {
        console.log('No identity evolution data found yet.');
        return;
    }
    
    const content = fs.readFileSync(IDENTITY_EVOLUTION_PATH, 'utf8');
    
    if (options.recent) {
        // Show just the most recent entry
        const entries = content.split('## Identity Analysis -').slice(1);
        if (entries.length === 0) {
            console.log('No identity analysis entries found yet.');
            return;
        }
        
        const recent = '## Identity Analysis -' + entries[entries.length - 1];
        console.log(recent);
    } else {
        console.log(content);
    }
}

function compareWithSoul() {
    if (!fs.existsSync(SOUL_PATH)) {
        console.log('SOUL.md not found.');
        return;
    }
    
    const soul = fs.readFileSync(SOUL_PATH, 'utf8');
    const evolution = fs.existsSync(IDENTITY_EVOLUTION_PATH) ? 
        fs.readFileSync(IDENTITY_EVOLUTION_PATH, 'utf8') : 
        'No identity evolution data yet.';
    
    console.log('# Identity Comparison\n');
    console.log('## Defined Identity (SOUL.md)');
    console.log(soul);
    console.log('\n## Evolution Log');
    console.log(evolution);
}

function getEvolutionStats() {
    if (!fs.existsSync(IDENTITY_EVOLUTION_PATH)) {
        console.log('No identity evolution data found yet.');
        return;
    }
    
    const content = fs.readFileSync(IDENTITY_EVOLUTION_PATH, 'utf8');
    const entries = content.split('## Identity Analysis -').slice(1);
    
    if (entries.length === 0) {
        console.log('No identity analysis entries found yet.');
        return;
    }
    
    console.log(`📊 Identity Evolution Statistics\n`);
    console.log(`Total analyses: ${entries.length}`);
    
    // Extract dates for timeline
    const dates = entries.map(entry => {
        const dateMatch = entry.match(/^([^\n]+)/);
        return dateMatch ? dateMatch[1].trim() : 'Unknown date';
    });
    
    console.log(`Timeline: ${dates[0]} → ${dates[dates.length - 1]}`);
    
    // Count patterns in most recent entry
    if (entries.length > 0) {
        const recent = entries[entries.length - 1];
        const consistent = (recent.match(/### ✅ Consistent Behaviors\n(.*?)\n\n/s) || ['', ''])[1];
        const emergent = (recent.match(/### 🌱 Emergent Traits\n(.*?)\n\n/s) || ['', ''])[1];
        const contradictions = (recent.match(/### ⚠️ Contradictions\n(.*?)\n\n/s) || ['', ''])[1];
        
        console.log(`\nMost Recent Analysis:`);
        console.log(`  Consistent behaviors: ${(consistent.match(/^- /gm) || []).length}`);
        console.log(`  Emergent traits: ${(emergent.match(/^- /gm) || []).length}`);
        console.log(`  Contradictions: ${(contradictions.match(/^- /gm) || []).length}`);
    }
}

// CLI setup
program
    .name('track-identity')
    .description('Track identity evolution by comparing patterns against SOUL.md');

program
    .command('analyze')
    .description('Analyze current identity vs. defined identity')
    .option('-w, --weeks <weeks>', 'Number of weeks of patterns to analyze', '4')
    .option('-s, --show', 'Show the analysis after completion')
    .action(trackIdentityEvolution);

program
    .command('show')
    .description('Show identity evolution log')
    .option('-r, --recent', 'Show only the most recent analysis')
    .action(showEvolution);

program
    .command('compare')
    .description('Compare SOUL.md with evolution log side-by-side')
    .action(compareWithSoul);

program
    .command('stats')
    .description('Show identity evolution statistics')
    .action(getEvolutionStats);

// If no command specified, run analyze
if (process.argv.length <= 2) {
    trackIdentityEvolution({});
} else {
    program.parse();
}