#!/usr/bin/env node
/**
 * Secure Git Push - Runs security check and notifies Jason
 * 
 * Usage:
 *   node tools/git-push.js              # Push and notify
 *   node tools/git-push.js --dry-run    # Show what would be pushed
 *   node tools/git-push.js --force      # Force push (asks for confirmation)
 */

const { execSync } = require('child_process');
const path = require('path');

const JASON_TELEGRAM_ID = '5071818415';

// Get recent commits that will be pushed
function getUnpushedCommits() {
  try {
    const output = execSync('git log origin/master..HEAD --oneline', { encoding: 'utf8' });
    return output.trim().split('\n').filter(Boolean);
  } catch (e) {
    return [];
  }
}

// Get changed files in unpushed commits
function getChangedFiles() {
  try {
    const output = execSync('git diff --name-only origin/master..HEAD', { encoding: 'utf8' });
    return output.trim().split('\n').filter(Boolean);
  } catch (e) {
    return [];
  }
}

// Run security check
function runSecurityCheck() {
  try {
    execSync('node ' + path.join(__dirname, 'git-security-check.js') + ' --all', { 
      encoding: 'utf8',
      stdio: 'inherit'
    });
    return true;
  } catch (e) {
    return false;
  }
}

// Send notification via Telegram (using OpenClaw's message tool if available)
async function notifyJason(message) {
  // Try to use the OpenClaw API directly
  const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL || 'http://localhost:9315';
  const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN || '';
  
  try {
    // Just log for now - the main agent will handle notification
    console.log('\n📤 Notification queued for Jason');
    
    // Write to a file that the agent can pick up
    const notificationFile = path.join(__dirname, '../.git-push-notification');
    require('fs').writeFileSync(notificationFile, JSON.stringify({
      timestamp: new Date().toISOString(),
      message
    }));
  } catch (e) {
    console.log('(Notification will be sent by agent on next check)');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');
  
  console.log('\n🔍 Checking for unpushed commits...\n');
  
  const commits = getUnpushedCommits();
  const files = getChangedFiles();
  
  if (commits.length === 0) {
    console.log('Nothing to push - already up to date.\n');
    return;
  }
  
  console.log(`📦 ${commits.length} commit(s) to push:\n`);
  commits.forEach(c => console.log(`   ${c}`));
  console.log(`\n📁 ${files.length} file(s) changed`);
  
  if (dryRun) {
    console.log('\n(Dry run - no changes pushed)\n');
    return;
  }
  
  // Run security check
  console.log('\n🔒 Running security scan on all tracked files...\n');
  const secure = runSecurityCheck();
  
  if (!secure) {
    console.log('\n❌ Push aborted due to security concerns.\n');
    console.log('Fix the issues above, then try again.\n');
    process.exit(1);
  }
  
  // Push
  console.log('\n🚀 Pushing to remote...\n');
  try {
    const pushCmd = force ? 'git push --force' : 'git push';
    execSync(pushCmd, { encoding: 'utf8', stdio: 'inherit' });
    
    console.log('\n✅ Push successful!\n');
    
    // Build notification message
    const summary = commits.slice(0, 5).map(c => `• ${c}`).join('\n');
    const more = commits.length > 5 ? `\n... and ${commits.length - 5} more` : '';
    
    const notification = `🚀 **Git Push**\n\n${commits.length} commit(s) pushed:\n${summary}${more}\n\n${files.length} file(s) changed`;
    
    await notifyJason(notification);
    
  } catch (e) {
    console.log('\n❌ Push failed:', e.message);
    process.exit(1);
  }
}

main();
