#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { program } = require('commander');

// Load credentials and router
const credentials = require('../lib/credentials');
const router = require('../lib/router');

// Ensure memory/friction directory exists
const frictionDir = path.join(__dirname, '..', 'memory', 'friction');
if (!fs.existsSync(frictionDir)) {
    fs.mkdirSync(frictionDir, { recursive: true });
}

function getCurrentDateString() {
    return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

function loadFrictionEntries(days) {
    const entries = [];
    const now = new Date();
    
    console.log(`📖 Loading friction entries from the last ${days} days...`);
    
    for (let i = 0; i < days; i++) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        const filePath = path.join(frictionDir, `${dateStr}.json`);
        
        if (fs.existsSync(filePath)) {
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                const dayEntries = JSON.parse(content);
                entries.push(...dayEntries.map(e => ({ ...e, date: dateStr })));
                console.log(`   ✅ ${dateStr}: ${dayEntries.length} entries`);
            } catch (error) {
                console.error(`   ❌ Error reading ${filePath}:`, error.message);
            }
        }
    }
    
    console.log(`📊 Total entries loaded: ${entries.length}\n`);
    return entries;
}

function categorizeEntries(entries) {
    const stats = {
        total: entries.length,
        friction: entries.filter(e => e.type === 'friction').length,
        ideas: entries.filter(e => e.type === 'idea').length,
        byImpact: {
            high: entries.filter(e => e.impact === 'high').length,
            medium: entries.filter(e => e.impact === 'medium').length,
            low: entries.filter(e => e.impact === 'low').length
        },
        byCategory: {}
    };
    
    entries.forEach(entry => {
        stats.byCategory[entry.category] = (stats.byCategory[entry.category] || 0) + 1;
    });
    
    return stats;
}

function formatEntriesForLLM(entries) {
    return entries.map(entry => {
        const lines = [
            `Date: ${entry.date}`,
            `Type: ${entry.type}`,
            `Impact: ${entry.impact}`,
            `Category: ${entry.category}`,
            `Description: ${entry.description}`
        ];
        
        if (entry.suggested_fix) {
            lines.push(`Suggested Fix: ${entry.suggested_fix}`);
        }
        
        return lines.join('\n');
    }).join('\n\n---\n\n');
}

async function synthesizeWithAI(entries, stats, options) {
    console.log('🤖 Analyzing patterns with Gemini...\n');
    
    const prompt = `You are analyzing friction points and ideas from a software development workflow. Your job is to identify patterns, prioritize issues, and suggest concrete improvements.

## Data Summary
- Total entries: ${stats.total}
- Friction points: ${stats.friction}
- Ideas: ${stats.ideas}
- High impact: ${stats.byImpact.high}
- Medium impact: ${stats.byImpact.medium}
- Low impact: ${stats.byImpact.low}

## Categories
${Object.entries(stats.byCategory).map(([cat, count]) => `- ${cat}: ${count}`).join('\n')}

## Raw Data
${formatEntriesForLLM(entries)}

## Analysis Framework

Please provide a comprehensive analysis with these sections:

### 🔍 Pattern Analysis
Identify recurring themes, common categories, and systemic issues. What patterns emerge across time and categories?

### ⚡ Priority Matrix
Rank the most critical friction points by:
1. Impact (high/medium/low)
2. Frequency of occurrence
3. Ease of resolution
4. Cascading effects

### 💡 Solution Recommendations
For the top 3-5 friction points, provide:
- Root cause analysis
- Specific, actionable solutions
- Implementation complexity (hours/days/weeks)
- Dependencies or prerequisites

### 🚀 Quick Wins
List 3-5 small improvements that could be implemented immediately (< 2 hours each) to reduce daily friction.

### 📈 Trend Analysis
${options.days > 7 ? 'Compare recent patterns with earlier periods. Are friction points increasing/decreasing? Any seasonal patterns?' : 'Note: Limited to ' + options.days + ' days - consider running with --days 30 for trend analysis.'}

### 🎯 Feature Ideas
From the captured ideas, which align best with solving the identified friction points? Prioritize features that address multiple pain points.

### 📝 Process Improvements
What changes to workflows, tools, or practices could prevent these friction points from recurring?

Be specific, actionable, and focus on developer productivity. Provide concrete next steps, not just high-level observations.`;

    try {
        const result = await router.route({
            type: 'research',
            prompt: prompt,
            content: null
        });
        
        return result.result; // Extract the text from the router response
    } catch (error) {
        console.error('❌ Error during AI analysis:', error.message);
        throw error;
    }
}

function generateMarkdownReport(synthesis, entries, stats, days) {
    const dateStr = getCurrentDateString();
    
    const report = `# Friction & Ideas Synthesis - ${dateStr}

*Generated from ${entries.length} entries over ${days} days*

## 📊 Quick Stats

- **Total entries:** ${stats.total}
- **Friction points:** ${stats.friction}  
- **Ideas:** ${stats.ideas}
- **High impact issues:** ${stats.byImpact.high}

### Category Breakdown
${Object.entries(stats.byCategory)
    .sort(([,a], [,b]) => b - a)
    .map(([cat, count]) => `- **${cat}:** ${count}`)
    .join('\n')}

## 🤖 AI Analysis

${synthesis}

## 📋 Raw Data Summary

### Recent High-Impact Friction
${entries
    .filter(e => e.type === 'friction' && e.impact === 'high')
    .slice(0, 5)
    .map(e => `- **[${e.date}]** ${e.description} *(${e.category})*`)
    .join('\n') || 'None found'}

### Recent Ideas
${entries
    .filter(e => e.type === 'idea')
    .slice(0, 5)
    .map(e => `- **[${e.date}]** ${e.description} *(${e.category})*`)
    .join('\n') || 'None found'}

---

*Next synthesis: ${new Date(Date.now() + 24*60*60*1000).toISOString().split('T')[0]}*`;

    return report;
}

async function synthesize(options) {
    const days = parseInt(options.days) || 7;
    
    // Load entries
    const entries = loadFrictionEntries(days);
    
    if (entries.length === 0) {
        console.log(`No friction entries found in the last ${days} days.`);
        console.log('💡 Try logging some friction first: node tools/log-friction.js "description" --impact high');
        return;
    }
    
    // Calculate stats
    const stats = categorizeEntries(entries);
    
    // Generate AI analysis
    const synthesis = await synthesizeWithAI(entries, stats, { days });
    
    // Generate markdown report
    const report = generateMarkdownReport(synthesis, entries, stats, days);
    
    // Save to file
    const dateStr = getCurrentDateString();
    const outputPath = path.join(frictionDir, `synthesis-${dateStr}.md`);
    
    try {
        fs.writeFileSync(outputPath, report);
        console.log('✅ Synthesis complete!');
        console.log(`📁 Report saved to: ${outputPath}`);
        console.log(`📄 Report length: ${report.length} chars`);
        
        if (options.show) {
            console.log('\n' + '='.repeat(60));
            console.log(report);
        }
    } catch (error) {
        console.error('❌ Error saving report:', error.message);
        process.exit(1);
    }
}

program
    .name('synthesize-friction')
    .description('Analyze friction patterns and generate insights')
    .version('1.0.0');

program
    .command('synthesize')
    .description('Generate synthesis report from recent friction entries')
    .option('--days <n>', 'Number of days to analyze', '7')
    .option('--show', 'Show the report in console after generation')
    .action(synthesize);

program
    .command('list-reports')
    .description('List existing synthesis reports')
    .action(() => {
        const files = fs.readdirSync(frictionDir)
            .filter(f => f.startsWith('synthesis-') && f.endsWith('.md'))
            .sort()
            .reverse();
            
        if (files.length === 0) {
            console.log('No synthesis reports found.');
            return;
        }
        
        console.log(`📊 Found ${files.length} synthesis reports:\n`);
        files.forEach(file => {
            const filePath = path.join(frictionDir, file);
            const stats = fs.statSync(filePath);
            const date = file.match(/synthesis-(\d{4}-\d{2}-\d{2})\.md/)?.[1];
            console.log(`📄 ${date || file} (${Math.round(stats.size/1024)}KB)`);
        });
    });

program
    .command('show')
    .description('Show a specific synthesis report')
    .argument('<date>', 'Date in YYYY-MM-DD format (or "latest")')
    .action((date) => {
        let filePath;
        
        if (date === 'latest') {
            const files = fs.readdirSync(frictionDir)
                .filter(f => f.startsWith('synthesis-') && f.endsWith('.md'))
                .sort()
                .reverse();
            
            if (files.length === 0) {
                console.log('No synthesis reports found.');
                return;
            }
            
            filePath = path.join(frictionDir, files[0]);
        } else {
            filePath = path.join(frictionDir, `synthesis-${date}.md`);
        }
        
        if (!fs.existsSync(filePath)) {
            console.log(`Report not found: ${filePath}`);
            return;
        }
        
        const content = fs.readFileSync(filePath, 'utf8');
        console.log(content);
    });

// Default action
if (process.argv.length === 2) {
    console.log('Usage: node tools/synthesize-friction.js <command>');
    console.log('Commands: synthesize, list-reports, show');
    program.help();
} else {
    program.parse();
}