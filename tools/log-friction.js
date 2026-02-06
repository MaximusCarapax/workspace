#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { program } = require('commander');

// Ensure memory/friction directory exists
const frictionDir = path.join(__dirname, '..', 'memory', 'friction');
if (!fs.existsSync(frictionDir)) {
    fs.mkdirSync(frictionDir, { recursive: true });
}

function getCurrentDateString() {
    return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

function getCurrentTimestamp() {
    return new Date().toISOString();
}

function logEntry(description, options) {
    const dateStr = getCurrentDateString();
    const filePath = path.join(frictionDir, `${dateStr}.json`);
    
    // Load existing entries or create new array
    let entries = [];
    if (fs.existsSync(filePath)) {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            entries = JSON.parse(content);
        } catch (error) {
            console.error(`Error reading ${filePath}:`, error.message);
            entries = [];
        }
    }
    
    // Create new entry
    const entry = {
        timestamp: getCurrentTimestamp(),
        description: description,
        type: options.type || 'friction',
        impact: options.impact || 'medium',
        category: options.category || 'other',
        suggested_fix: options.fix || null
    };
    
    // Add to entries
    entries.push(entry);
    
    // Save back to file
    try {
        fs.writeFileSync(filePath, JSON.stringify(entries, null, 2));
        console.log(`✅ Logged ${entry.type}: "${description}"`);
        console.log(`📁 Saved to: ${filePath}`);
        console.log(`📊 Impact: ${entry.impact} | Category: ${entry.category}`);
    } catch (error) {
        console.error(`Error writing to ${filePath}:`, error.message);
        process.exit(1);
    }
}

function listEntries(options) {
    const days = parseInt(options.days) || 7;
    const typeFilter = options.type;
    
    const entries = [];
    const now = new Date();
    
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
            } catch (error) {
                console.error(`Error reading ${filePath}:`, error.message);
            }
        }
    }
    
    // Filter by type if specified
    const filteredEntries = typeFilter ? 
        entries.filter(e => e.type === typeFilter) : entries;
    
    if (filteredEntries.length === 0) {
        const typeMsg = typeFilter ? ` of type "${typeFilter}"` : '';
        console.log(`No entries found${typeMsg} in the last ${days} days.`);
        return;
    }
    
    // Sort by timestamp (newest first)
    filteredEntries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    console.log(`\n📋 Found ${filteredEntries.length} entries in the last ${days} days:\n`);
    
    filteredEntries.forEach((entry, index) => {
        const icon = entry.type === 'idea' ? '💡' : '⚠️';
        const impactIcon = {
            high: '🔴',
            medium: '🟡', 
            low: '🟢'
        }[entry.impact] || '⚪';
        
        console.log(`${index + 1}. ${icon} [${entry.date}] ${impactIcon} ${entry.description}`);
        console.log(`   Type: ${entry.type} | Impact: ${entry.impact} | Category: ${entry.category}`);
        if (entry.suggested_fix) {
            console.log(`   💡 Suggested fix: ${entry.suggested_fix}`);
        }
        console.log('');
    });
}

program
    .name('log-friction')
    .description('Log friction points and ideas during work')
    .version('1.0.0');

program
    .command('log')
    .description('Log a friction point or idea')
    .argument('<description>', 'Description of the friction or idea')
    .option('--type <type>', 'Entry type: friction or idea', 'friction')
    .option('--impact <level>', 'Impact level: high, medium, or low', 'medium')
    .option('--category <category>', 'Category: ux, performance, workflow, or other', 'other')
    .option('--fix <suggestion>', 'Optional suggested fix')
    .action(logEntry);

program
    .command('list')
    .description('List recent entries')
    .option('--days <n>', 'Number of days to look back', '7')
    .option('--type <type>', 'Filter by type: friction or idea')
    .action(listEntries);

program
    .command('stats')
    .description('Show statistics')
    .option('--days <n>', 'Number of days to analyze', '30')
    .action((options) => {
        const days = parseInt(options.days) || 30;
        const entries = [];
        const now = new Date();
        
        for (let i = 0; i < days; i++) {
            const date = new Date(now);
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            const filePath = path.join(frictionDir, `${dateStr}.json`);
            
            if (fs.existsSync(filePath)) {
                try {
                    const content = fs.readFileSync(filePath, 'utf8');
                    const dayEntries = JSON.parse(content);
                    entries.push(...dayEntries);
                } catch (error) {
                    console.error(`Error reading ${filePath}:`, error.message);
                }
            }
        }
        
        if (entries.length === 0) {
            console.log(`No entries found in the last ${days} days.`);
            return;
        }
        
        // Calculate stats
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
        
        // Category breakdown
        entries.forEach(entry => {
            stats.byCategory[entry.category] = (stats.byCategory[entry.category] || 0) + 1;
        });
        
        console.log(`\n📊 Stats for the last ${days} days:\n`);
        console.log(`📝 Total entries: ${stats.total}`);
        console.log(`⚠️  Friction points: ${stats.friction}`);
        console.log(`💡 Ideas: ${stats.ideas}`);
        console.log('');
        console.log('📈 By Impact:');
        console.log(`  🔴 High: ${stats.byImpact.high}`);
        console.log(`  🟡 Medium: ${stats.byImpact.medium}`);
        console.log(`  🟢 Low: ${stats.byImpact.low}`);
        console.log('');
        console.log('🗂️  By Category:');
        Object.entries(stats.byCategory).forEach(([category, count]) => {
            console.log(`  ${category}: ${count}`);
        });
    });

// Default action for backwards compatibility
if (process.argv.length > 2 && !['log', 'list', 'stats', '--help', '-h', 'help'].includes(process.argv[2])) {
    // Treat first argument as description and parse options
    const description = process.argv[2];
    const options = {
        type: 'friction',
        impact: 'medium',
        category: 'other'
    };
    
    // Parse basic options
    for (let i = 3; i < process.argv.length; i++) {
        const arg = process.argv[i];
        if (arg.startsWith('--impact=')) {
            options.impact = arg.split('=')[1];
        } else if (arg === '--impact' && i + 1 < process.argv.length) {
            options.impact = process.argv[++i];
        } else if (arg.startsWith('--category=')) {
            options.category = arg.split('=')[1];
        } else if (arg === '--category' && i + 1 < process.argv.length) {
            options.category = process.argv[++i];
        } else if (arg.startsWith('--type=')) {
            options.type = arg.split('=')[1];
        } else if (arg === '--type' && i + 1 < process.argv.length) {
            options.type = process.argv[++i];
        } else if (arg.startsWith('--fix=')) {
            options.fix = arg.split('=')[1];
        } else if (arg === '--fix' && i + 1 < process.argv.length) {
            options.fix = process.argv[++i];
        }
    }
    
    logEntry(description, options);
} else {
    program.parse();
}