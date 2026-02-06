#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { program } = require('commander');

// Import our existing utilities
const creds = require('../lib/credentials');

const DECISIONS_DIR = path.join(process.env.HOME, '.openclaw', 'workspace', 'memory', 'decisions');
const PATTERNS_DIR = path.join(process.env.HOME, '.openclaw', 'workspace', 'memory', 'patterns');

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
            'X-Title': 'OpenClaw Pattern Analysis'
        },
        body: JSON.stringify({
            model: 'google/gemini-2.5-flash-lite',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 1000
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

function ensurePatternsDir() {
    if (!fs.existsSync(PATTERNS_DIR)) {
        fs.mkdirSync(PATTERNS_DIR, { recursive: true });
    }
}

function getWeekNumber(date) {
    const start = new Date(date.getFullYear(), 0, 1);
    const diff = (date - start + (start.getTimezoneOffset() - date.getTimezoneOffset()) * 60 * 1000);
    const oneWeek = 1000 * 60 * 60 * 24 * 7;
    return Math.floor(diff / oneWeek) + 1;
}

function getWeeklyPatternFile(date) {
    const year = date.getFullYear();
    const week = String(getWeekNumber(date)).padStart(2, '0');
    return path.join(PATTERNS_DIR, `${year}-W${week}.md`);
}

function loadDecisionsForWeek(endDate) {
    if (!fs.existsSync(DECISIONS_DIR)) {
        return [];
    }

    const decisions = [];
    const files = fs.readdirSync(DECISIONS_DIR).filter(f => f.endsWith('.json'));
    
    // Get decisions from the past week
    const weekStart = new Date(endDate);
    weekStart.setDate(weekStart.getDate() - 6); // 7 days including end date
    
    files.forEach(file => {
        const fileDate = new Date(file.replace('.json', ''));
        if (fileDate >= weekStart && fileDate <= endDate) {
            try {
                const dayDecisions = JSON.parse(fs.readFileSync(path.join(DECISIONS_DIR, file), 'utf8'));
                decisions.push(...dayDecisions);
            } catch (error) {
                console.error(`Error reading ${file}: ${error.message}`);
            }
        }
    });

    return decisions.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

async function analyzePatterns(decisions) {
    if (decisions.length === 0) {
        return {
            tendencies: ["No decisions recorded this week"],
            growth_areas: ["No data to analyze"],
            blind_spots: ["Unable to identify patterns without decision data"],
            summary: "No decisions were recorded this week, limiting pattern analysis."
        };
    }

    const prompt = `Analyze these decision journal entries to extract patterns about my decision-making approach. Focus on:

1. **Tendencies**: What patterns do I consistently follow? How do I approach problems?
2. **Growth areas**: Where am I improving? What positive changes do I see?
3. **Blind spots**: What might I be missing? Where could I improve?

Here are the decisions from this week:

${decisions.map((d, i) => `
**Decision ${i + 1}** (${new Date(d.timestamp).toLocaleDateString()})
- Context: ${d.context}
- Decision: ${d.decision}
- Reasoning: ${d.reasoning}
- Alternatives: ${d.alternatives_considered.length > 0 ? d.alternatives_considered.join(', ') : 'None recorded'}
- Confidence: ${d.confidence !== null ? Math.round(d.confidence * 100) + '%' : 'Not specified'}
- Outcome: ${d.outcome || 'Not yet determined'}
- Tags: ${d.tags.length > 0 ? d.tags.join(', ') : 'None'}
`).join('\n')}

Provide a structured analysis in JSON format:
{
  "tendencies": ["pattern 1", "pattern 2", ...],
  "growth_areas": ["area 1", "area 2", ...],
  "blind_spots": ["potential issue 1", "potential issue 2", ...],
  "summary": "2-3 sentence overview of key insights"
}

Be specific and actionable. Look for actual patterns in the data, not generic advice.`;

    try {
        const response = await callOpenRouter(prompt);

        // Try to extract JSON from the response
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        } else {
            // Fallback: parse structured text response
            return {
                tendencies: ["Could not parse structured analysis"],
                growth_areas: ["Review needed"],
                blind_spots: ["Analysis incomplete"],
                summary: response.substring(0, 200) + "..."
            };
        }
    } catch (error) {
        console.error(`Error in pattern analysis: ${error.message}`);
        return {
            tendencies: [`Analysis failed: ${error.message}`],
            growth_areas: ["Tool needs debugging"],
            blind_spots: ["Pattern analysis system issues"],
            summary: "Technical error prevented analysis this week."
        };
    }
}

function formatPatternReport(analysis, decisions, weekStart, weekEnd) {
    const year = weekEnd.getFullYear();
    const week = String(getWeekNumber(weekEnd)).padStart(2, '0');
    
    return `# Decision Patterns - Week ${year}-W${week}

**Period:** ${weekStart.toLocaleDateString()} - ${weekEnd.toLocaleDateString()}  
**Decisions analyzed:** ${decisions.length}  
**Generated:** ${new Date().toLocaleDateString()}

## 🎯 Key Tendencies
${analysis.tendencies.map(t => `- ${t}`).join('\n')}

## 📈 Growth Areas
${analysis.growth_areas.map(g => `- ${g}`).join('\n')}

## ⚠️ Blind Spots
${analysis.blind_spots.map(b => `- ${b}`).join('\n')}

## 💭 Summary
${analysis.summary}

---

## Decision Details
${decisions.length === 0 ? 'No decisions recorded this week.' : 
decisions.map((d, i) => `
### ${i + 1}. ${d.context}
- **Decision:** ${d.decision}
- **Reasoning:** ${d.reasoning}
- **Confidence:** ${d.confidence !== null ? Math.round(d.confidence * 100) + '%' : 'Not specified'}
- **Tags:** ${d.tags.length > 0 ? d.tags.join(', ') : 'None'}
${d.outcome ? `- **Outcome:** ${d.outcome}` : ''}
`).join('\n')}`;
}

async function analyzeWeeklyPatterns(options) {
    ensurePatternsDir();
    
    const endDate = options.week ? new Date(options.week + '-7') : new Date(); // Week format: YYYY-WW, default to current week
    const weekStart = new Date(endDate);
    weekStart.setDate(weekStart.getDate() - 6);
    
    console.log(`🔍 Analyzing patterns for week ending ${endDate.toLocaleDateString()}...`);
    
    const decisions = loadDecisionsForWeek(endDate);
    console.log(`📊 Found ${decisions.length} decisions in the past week`);
    
    if (decisions.length === 0) {
        console.log('⚠️  No decisions to analyze. Consider logging more decisions during the week.');
    }
    
    const analysis = await analyzePatterns(decisions);
    const report = formatPatternReport(analysis, decisions, weekStart, endDate);
    
    const outputFile = getWeeklyPatternFile(endDate);
    fs.writeFileSync(outputFile, report);
    
    console.log(`✅ Pattern analysis complete: ${outputFile}`);
    console.log('\n📋 Quick Summary:');
    console.log(`   Tendencies: ${analysis.tendencies.length}`);
    console.log(`   Growth areas: ${analysis.growth_areas.length}`);
    console.log(`   Blind spots: ${analysis.blind_spots.length}`);
    
    if (options.show) {
        console.log('\n' + report);
    }
}

function listPatterns(options) {
    ensurePatternsDir();
    
    const files = fs.readdirSync(PATTERNS_DIR)
        .filter(f => f.match(/^\d{4}-W\d{2}\.md$/))
        .sort()
        .reverse();
    
    if (files.length === 0) {
        console.log('No pattern analyses found yet.');
        return;
    }
    
    console.log(`📊 Pattern Analysis History (${files.length} weeks):\n`);
    
    files.slice(0, options.limit || 10).forEach(file => {
        const filePath = path.join(PATTERNS_DIR, file);
        const content = fs.readFileSync(filePath, 'utf8');
        
        // Extract summary from file
        const summaryMatch = content.match(/## 💭 Summary\n(.*?)\n\n/s);
        const summary = summaryMatch ? summaryMatch[1].trim() : 'No summary available';
        
        console.log(`**${file.replace('.md', '')}**`);
        console.log(`   ${summary}\n`);
    });
}

function showPattern(week) {
    ensurePatternsDir();
    
    const file = path.join(PATTERNS_DIR, `${week}.md`);
    if (!fs.existsSync(file)) {
        console.log(`Pattern analysis not found: ${week}.md`);
        return;
    }
    
    const content = fs.readFileSync(file, 'utf8');
    console.log(content);
}

// CLI setup
program
    .name('analyze-patterns')
    .description('Analyze decision patterns from the self-model system');

program
    .command('weekly')
    .description('Analyze patterns for a week')
    .option('-w, --week <week>', 'Week to analyze (YYYY-WW format), defaults to current week')
    .option('-s, --show', 'Show the full report after generation')
    .action(analyzeWeeklyPatterns);

program
    .command('list')
    .description('List previous pattern analyses')
    .option('-l, --limit <limit>', 'Number of recent analyses to show', '10')
    .action(listPatterns);

program
    .command('show <week>')
    .description('Show a specific pattern analysis (e.g., 2026-W06)')
    .action(showPattern);

// If no command specified, run weekly analysis
if (process.argv.length <= 2) {
    analyzeWeeklyPatterns({});
} else {
    program.parse();
}