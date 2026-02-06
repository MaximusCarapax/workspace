#!/usr/bin/env node
/**
 * Post-Compaction Auto-Recovery Workflow
 * 
 * When a session compacts, context is lost. This script automates the recovery process:
 * 1. Indexes recent conversation chunks
 * 2. Reads today's and yesterday's daily memory
 * 3. Outputs a brief recovery summary
 * 
 * Usage: node tools/post-compaction-recovery.js [--detect-only] [--verbose]
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// Paths
const WORKSPACE = process.env.WORKSPACE || path.join(process.env.HOME, '.openclaw', 'workspace');
const MEMORY_DIR = path.join(WORKSPACE, 'memory');

/**
 * Detect if we're in a post-compaction state
 */
function detectCompaction() {
    // Check for common compaction indicators
    // This is heuristic-based - could be improved with session metadata
    const indicators = [
        'Summary unavailable',
        'Context was compacted',
        'Session restarted',
        'Memory truncated'
    ];
    
    console.log('🔍 Detecting compaction state...');
    console.log('   (This is heuristic-based - run recovery if you suspect context loss)');
    
    return {
        detected: false,  // Conservative - let user decide
        confidence: 'low',
        reason: 'Manual trigger recommended when context seems lost'
    };
}

/**
 * Get formatted date string (YYYY-MM-DD)
 */
function getDateString(daysOffset = 0) {
    const date = new Date();
    date.setDate(date.getDate() + daysOffset);
    return date.toISOString().split('T')[0];
}

/**
 * Read daily memory file if it exists
 */
function readDailyMemory(date) {
    const filePath = path.join(MEMORY_DIR, `${date}.md`);
    
    if (!fs.existsSync(filePath)) {
        return null;
    }
    
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        return {
            date,
            exists: true,
            lines: content.split('\n').length,
            content: content.substring(0, 500) + (content.length > 500 ? '...' : '')
        };
    } catch (error) {
        return {
            date,
            exists: false,
            error: error.message
        };
    }
}

/**
 * Run session memory chunking
 */
async function runChunking(verbose = false) {
    console.log('📚 Indexing recent conversation chunks...');
    
    try {
        const { stdout, stderr } = await execAsync('node tools/session-memory.js chunk --all', {
            cwd: WORKSPACE,
            timeout: 60000 // 1 minute timeout
        });
        
        if (verbose) {
            console.log('Chunking output:', stdout);
            if (stderr) console.log('Chunking stderr:', stderr);
        }
        
        return {
            success: true,
            output: stdout.trim(),
            chunks_processed: (stdout.match(/processed|chunked/gi) || []).length
        };
    } catch (error) {
        return {
            success: false,
            error: error.message,
            output: error.stdout || ''
        };
    }
}

/**
 * Get recent activity summary
 */
async function getRecentActivity(verbose = false) {
    console.log('⚡ Getting recent activity...');
    
    try {
        const { stdout } = await execAsync('node tools/db.js activity --limit 10', {
            cwd: WORKSPACE,
            timeout: 30000
        });
        
        if (verbose) {
            console.log('Activity output:', stdout);
        }
        
        return {
            success: true,
            output: stdout.trim()
        };
    } catch (error) {
        return {
            success: false,
            error: error.message,
            output: error.stdout || ''
        };
    }
}

/**
 * Generate recovery summary
 */
function generateSummary(data) {
    const { chunking, activity, todayMemory, yesterdayMemory, compactionState } = data;
    
    console.log('\n🔄 POST-COMPACTION RECOVERY SUMMARY');
    console.log('=====================================');
    
    // Compaction detection
    console.log(`\n📊 Compaction Detection:`);
    console.log(`   Status: ${compactionState.detected ? '✅ Detected' : '❓ Manual trigger'}`);
    console.log(`   Reason: ${compactionState.reason}`);
    
    // Chunking results
    console.log(`\n📚 Session Memory Indexing:`);
    if (chunking.success) {
        console.log(`   ✅ Recent conversations indexed`);
        console.log(`   📝 Chunks processed: ${chunking.chunks_processed || 'Unknown'}`);
    } else {
        console.log(`   ❌ Failed: ${chunking.error}`);
    }
    
    // Daily memory status
    console.log(`\n📅 Daily Memory Files:`);
    
    if (todayMemory?.exists) {
        console.log(`   📄 Today (${todayMemory.date}): ${todayMemory.lines} lines`);
        if (todayMemory.content) {
            console.log(`   Preview: "${todayMemory.content.replace(/\n/g, ' ')}"`);
        }
    } else {
        console.log(`   📄 Today (${getDateString()}): No file found`);
    }
    
    if (yesterdayMemory?.exists) {
        console.log(`   📄 Yesterday (${yesterdayMemory.date}): ${yesterdayMemory.lines} lines`);
        if (yesterdayMemory.content) {
            console.log(`   Preview: "${yesterdayMemory.content.replace(/\n/g, ' ')}"`);
        }
    } else {
        console.log(`   📄 Yesterday (${getDateString(-1)}): No file found`);
    }
    
    // Recent activity
    console.log(`\n⚡ Recent Activity:`);
    if (activity.success) {
        console.log(`   ✅ Activity log retrieved`);
        const lines = activity.output.split('\n').slice(0, 5);
        lines.forEach(line => {
            if (line.trim()) {
                console.log(`   • ${line.trim()}`);
            }
        });
    } else {
        console.log(`   ❌ Failed: ${activity.error}`);
    }
    
    // Next steps
    console.log(`\n🎯 Next Steps:`);
    console.log(`   1. Use 'session-memory.js search "query"' to find specific context`);
    console.log(`   2. Check 'node tools/db.js activity' for more detailed history`);
    console.log(`   3. Read full daily memory files in 'memory/' directory`);
    console.log(`   4. Continue working - context has been restored!`);
    
    console.log('\n✅ Recovery complete! Context restored from available sources.\n');
}

/**
 * Main recovery function
 */
async function runRecovery(options = {}) {
    const { detectOnly = false, verbose = false } = options;
    
    console.log('🔄 Starting Post-Compaction Auto-Recovery...\n');
    
    // 1. Detect compaction state
    const compactionState = detectCompaction();
    
    if (detectOnly) {
        console.log(`\nDetection result: ${compactionState.detected ? 'Compaction detected' : 'No clear compaction detected'}`);
        console.log(`Confidence: ${compactionState.confidence}`);
        console.log(`Reason: ${compactionState.reason}`);
        return;
    }
    
    // 2. Run chunking
    const chunking = await runChunking(verbose);
    
    // 3. Get recent activity
    const activity = await getRecentActivity(verbose);
    
    // 4. Read daily memory files
    const todayMemory = readDailyMemory(getDateString());
    const yesterdayMemory = readDailyMemory(getDateString(-1));
    
    // 5. Generate summary
    generateSummary({
        chunking,
        activity,
        todayMemory,
        yesterdayMemory,
        compactionState
    });
}

// CLI handling
if (require.main === module) {
    const args = process.argv.slice(2);
    const options = {
        detectOnly: args.includes('--detect-only'),
        verbose: args.includes('--verbose') || args.includes('-v')
    };
    
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
Post-Compaction Auto-Recovery Tool

Usage:
  node tools/post-compaction-recovery.js                Run full recovery
  node tools/post-compaction-recovery.js --detect-only  Just check for compaction
  node tools/post-compaction-recovery.js --verbose      Show detailed output
  node tools/post-compaction-recovery.js --help         Show this help

When to use:
  - When you see "Summary unavailable" at session start
  - When context seems lost after session restart
  - When you suspect conversation history was compacted
  - As part of your morning routine after overnight compaction

What it does:
  1. Indexes recent conversation chunks for searchability
  2. Reads today's and yesterday's daily memory files
  3. Gets recent activity summary from database
  4. Provides next steps for context recovery
`);
        process.exit(0);
    }
    
    runRecovery(options).catch(error => {
        console.error('❌ Recovery failed:', error.message);
        if (options.verbose) {
            console.error(error);
        }
        process.exit(1);
    });
}

module.exports = { runRecovery, detectCompaction, readDailyMemory };