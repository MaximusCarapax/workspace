#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { program } = require('commander');

// Ensure memory/decisions directory exists
const DECISIONS_DIR = path.join(process.env.HOME, '.openclaw', 'workspace', 'memory', 'decisions');

function ensureDecisionsDir() {
    if (!fs.existsSync(DECISIONS_DIR)) {
        fs.mkdirSync(DECISIONS_DIR, { recursive: true });
    }
}

function getDecisionFile(date) {
    const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD format
    return path.join(DECISIONS_DIR, `${dateStr}.json`);
}

function loadDecisions(date) {
    const filePath = getDecisionFile(date);
    if (!fs.existsSync(filePath)) {
        return [];
    }
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        console.error(`Error reading decisions file: ${error.message}`);
        return [];
    }
}

function saveDecisions(date, decisions) {
    const filePath = getDecisionFile(date);
    fs.writeFileSync(filePath, JSON.stringify(decisions, null, 2));
}

function validateDecision(decision) {
    const required = ['context', 'decision', 'reasoning'];
    const missing = required.filter(field => !decision[field] || decision[field].trim() === '');
    
    if (missing.length > 0) {
        throw new Error(`Missing required fields: ${missing.join(', ')}`);
    }

    if (decision.confidence && (decision.confidence < 0 || decision.confidence > 1)) {
        throw new Error('Confidence must be between 0 and 1');
    }
}

function logDecision(options) {
    ensureDecisionsDir();
    
    const now = new Date();
    const decision = {
        timestamp: now.toISOString(),
        context: options.context,
        decision: options.decision,
        alternatives_considered: options.alternatives ? options.alternatives.split(',').map(alt => alt.trim()) : [],
        reasoning: options.reasoning,
        outcome: options.outcome || null,
        confidence: options.confidence ? parseFloat(options.confidence) : null,
        tags: options.tags ? options.tags.split(',').map(tag => tag.trim()) : []
    };

    try {
        validateDecision(decision);
    } catch (error) {
        console.error(`Validation error: ${error.message}`);
        process.exit(1);
    }

    const decisions = loadDecisions(now);
    decisions.push(decision);
    saveDecisions(now, decisions);

    console.log(`✅ Decision logged to ${getDecisionFile(now)}`);
    console.log(`📝 ${decision.context}: ${decision.decision}`);
}

function listDecisions(options) {
    ensureDecisionsDir();
    
    const date = options.date ? new Date(options.date) : new Date();
    const decisions = loadDecisions(date);

    if (decisions.length === 0) {
        console.log(`No decisions found for ${date.toISOString().split('T')[0]}`);
        return;
    }

    console.log(`\n📋 Decisions for ${date.toISOString().split('T')[0]}: ${decisions.length}\n`);
    
    decisions.forEach((decision, index) => {
        const time = new Date(decision.timestamp).toLocaleTimeString();
        console.log(`${index + 1}. [${time}] ${decision.context}`);
        console.log(`   Decision: ${decision.decision}`);
        if (decision.confidence !== null) {
            console.log(`   Confidence: ${Math.round(decision.confidence * 100)}%`);
        }
        if (decision.tags.length > 0) {
            console.log(`   Tags: ${decision.tags.join(', ')}`);
        }
        if (decision.outcome) {
            console.log(`   Outcome: ${decision.outcome}`);
        }
        console.log();
    });
}

function searchDecisions(query, options) {
    ensureDecisionsDir();
    
    const results = [];
    const files = fs.readdirSync(DECISIONS_DIR).filter(f => f.endsWith('.json'));
    
    files.forEach(file => {
        const date = new Date(file.replace('.json', ''));
        const decisions = loadDecisions(date);
        
        decisions.forEach(decision => {
            const searchText = [
                decision.context,
                decision.decision,
                decision.reasoning,
                decision.outcome || '',
                decision.tags.join(' ')
            ].join(' ').toLowerCase();
            
            if (searchText.includes(query.toLowerCase())) {
                results.push({ ...decision, date: file.replace('.json', '') });
            }
        });
    });

    if (results.length === 0) {
        console.log(`No decisions found matching: ${query}`);
        return;
    }

    console.log(`\n🔍 Found ${results.length} decision(s) matching "${query}":\n`);
    
    results.forEach((decision, index) => {
        console.log(`${index + 1}. [${decision.date}] ${decision.context}`);
        console.log(`   Decision: ${decision.decision}`);
        if (decision.confidence !== null) {
            console.log(`   Confidence: ${Math.round(decision.confidence * 100)}%`);
        }
        console.log(`   Reasoning: ${decision.reasoning}`);
        console.log();
    });
}

function updateOutcome(options) {
    ensureDecisionsDir();
    
    const date = options.date ? new Date(options.date) : new Date();
    const decisions = loadDecisions(date);
    
    if (decisions.length === 0) {
        console.log(`No decisions found for ${date.toISOString().split('T')[0]}`);
        return;
    }

    const index = parseInt(options.index) - 1;
    if (index < 0 || index >= decisions.length) {
        console.log(`Invalid index. Use a number between 1 and ${decisions.length}`);
        return;
    }

    decisions[index].outcome = options.outcome;
    saveDecisions(date, decisions);

    console.log(`✅ Updated outcome for decision: ${decisions[index].context}`);
    console.log(`📋 Outcome: ${options.outcome}`);
}

// CLI setup
program
    .name('log-decision')
    .description('Log and manage decisions in the self-model system');

program
    .command('log')
    .description('Log a new decision')
    .requiredOption('-c, --context <context>', 'Context or situation for the decision')
    .requiredOption('-d, --decision <decision>', 'The decision that was made')
    .requiredOption('-r, --reasoning <reasoning>', 'Why this decision was made')
    .option('-a, --alternatives <alternatives>', 'Comma-separated list of alternatives considered')
    .option('-o, --outcome <outcome>', 'Outcome of the decision (if known)')
    .option('--confidence <confidence>', 'Confidence level (0-1)')
    .option('-t, --tags <tags>', 'Comma-separated tags')
    .action(logDecision);

program
    .command('list')
    .description('List decisions for a date')
    .option('-d, --date <date>', 'Date (YYYY-MM-DD), defaults to today')
    .action(listDecisions);

program
    .command('search <query>')
    .description('Search decisions by text')
    .action(searchDecisions);

program
    .command('outcome')
    .description('Update the outcome of a decision')
    .requiredOption('-i, --index <index>', 'Index of decision to update (from list command)')
    .requiredOption('-o, --outcome <outcome>', 'Outcome to record')
    .option('-d, --date <date>', 'Date of decision (YYYY-MM-DD), defaults to today')
    .action(updateOutcome);

// If no command specified, show help
if (process.argv.length <= 2) {
    program.help();
}

program.parse();