#!/usr/bin/env node
/**
 * Git Security Check - Scans staged files for secrets before commit
 * 
 * Usage:
 *   node git-security-check.js          # Check staged files
 *   node git-security-check.js --all    # Check all tracked files
 *   node git-security-check.js --fix    # Auto-redact secrets in staged files
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Patterns that indicate secrets (with descriptive names)
const SECRET_PATTERNS = [
  { name: 'Google API Key', pattern: /AIzaSy[a-zA-Z0-9_-]{33}/g },
  { name: 'AWS Access Key', pattern: /AKIA[0-9A-Z]{16}/g },
  { name: 'AWS Secret Key', pattern: /(?<![a-zA-Z0-9])[a-zA-Z0-9/+=]{40}(?![a-zA-Z0-9])/g, context: 'aws' },
  { name: 'GitHub Token', pattern: /gh[pousr]_[a-zA-Z0-9]{36,}/g },
  { name: 'Slack Token', pattern: /xox[baprs]-[a-zA-Z0-9-]+/g },
  { name: 'Stripe Key', pattern: /sk_live_[a-zA-Z0-9]{24,}/g },
  { name: 'Twilio Auth Token', pattern: /(?<![a-zA-Z0-9])[a-f0-9]{32}(?![a-zA-Z0-9])/g, context: 'twilio' },
  { name: 'OpenAI Key', pattern: /sk-[a-zA-Z0-9]{48}/g },
  { name: 'Anthropic Key', pattern: /sk-ant-[a-zA-Z0-9-]{90,}/g },
  { name: 'Generic API Key', pattern: /(?:api[_-]?key|apikey|api_secret|secret_key)\s*[=:]\s*["']?([a-zA-Z0-9_-]{20,})["']?/gi },
  { name: 'Private Key Block', pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g },
  { name: 'Password in URL', pattern: /:\/\/[^:]+:([^@]+)@/g },
  { name: 'Bearer Token', pattern: /Bearer\s+[a-zA-Z0-9_-]{20,}/g },
  { name: 'ElevenLabs Key', pattern: /sk_[a-f0-9]{48}/g },
  { name: 'Telegram Bot Token', pattern: /[0-9]{8,10}:[a-zA-Z0-9_-]{35}/g },
  { name: 'Discord Token', pattern: /[MN][a-zA-Z0-9_-]{23,}\.[a-zA-Z0-9_-]{6}\.[a-zA-Z0-9_-]{27,}/g },
  { name: 'Linear API Key', pattern: /lin_api_[a-zA-Z0-9]{40,}/g },
  { name: 'DeepSeek Key', pattern: /sk-[a-f0-9]{32}/g },
];

// Files/paths to always skip
const SKIP_PATHS = [
  /node_modules/,
  /\.git\//,
  /\.next\//,
  /package-lock\.json$/,
  /\.env\.example$/,
  /\.png$/,
  /\.jpg$/,
  /\.jpeg$/,
  /\.gif$/,
  /\.mp3$/,
  /\.mp4$/,
  /\.tar\.gz$/,
  /\.zip$/,
  /vendor-chunks/,
];

// Files where some patterns are expected (e.g., .env.example showing format)
const EXAMPLE_FILES = [
  /\.example$/,
  /CONFIGURATION\.md$/,
  /template/i,
];

function getStagedFiles() {
  try {
    const output = execSync('git diff --cached --name-only --diff-filter=ACMR', { encoding: 'utf8' });
    return output.trim().split('\n').filter(Boolean);
  } catch (e) {
    return [];
  }
}

function getAllTrackedFiles() {
  try {
    const output = execSync('git ls-files', { encoding: 'utf8' });
    return output.trim().split('\n').filter(Boolean);
  } catch (e) {
    return [];
  }
}

function shouldSkipFile(filePath) {
  return SKIP_PATHS.some(pattern => pattern.test(filePath));
}

function isExampleFile(filePath) {
  return EXAMPLE_FILES.some(pattern => pattern.test(filePath));
}

function scanFile(filePath) {
  if (shouldSkipFile(filePath)) return [];
  if (!fs.existsSync(filePath)) return [];
  
  const isExample = isExampleFile(filePath);
  const findings = [];
  
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    
    lines.forEach((line, lineNum) => {
      // Skip lines that look like they're already redacted
      if (/\[REDACTED\]|XXXXXX|your[_-]?api[_-]?key|<your|example/i.test(line)) return;
      
      SECRET_PATTERNS.forEach(({ name, pattern, context }) => {
        const matches = line.match(pattern);
        if (matches) {
          matches.forEach(match => {
            // Skip short matches that are likely false positives
            if (match.length < 16) return;
            
            // For context-specific patterns, check if context exists
            if (context && !line.toLowerCase().includes(context)) return;
            
            // In example files, only flag if it looks like a real key (not placeholder)
            if (isExample && /xxx|example|your|placeholder/i.test(match)) return;
            
            findings.push({
              file: filePath,
              line: lineNum + 1,
              type: name,
              match: match,
              preview: line.trim().substring(0, 100)
            });
          });
        }
      });
    });
  } catch (e) {
    // Binary file or read error, skip
  }
  
  return findings;
}

function redactInFile(filePath, findings) {
  if (!fs.existsSync(filePath)) return false;
  
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;
  
  findings.forEach(finding => {
    if (content.includes(finding.match)) {
      // Redact the secret, keeping first 8 and last 4 chars for identification
      const redacted = finding.match.length > 16 
        ? finding.match.substring(0, 8) + '[REDACTED]' + finding.match.slice(-4)
        : '[REDACTED]';
      content = content.replace(finding.match, redacted);
      modified = true;
    }
  });
  
  if (modified) {
    fs.writeFileSync(filePath, content);
  }
  
  return modified;
}

function main() {
  const args = process.argv.slice(2);
  const checkAll = args.includes('--all');
  const autoFix = args.includes('--fix');
  const quiet = args.includes('--quiet');
  
  const files = checkAll ? getAllTrackedFiles() : getStagedFiles();
  
  if (files.length === 0) {
    if (!quiet) console.log('No files to check.');
    process.exit(0);
  }
  
  if (!quiet) {
    console.log(`\n🔍 Scanning ${files.length} files for secrets...\n`);
  }
  
  let allFindings = [];
  
  files.forEach(file => {
    const findings = scanFile(file);
    if (findings.length > 0) {
      allFindings.push(...findings);
    }
  });
  
  if (allFindings.length === 0) {
    if (!quiet) console.log('✅ No secrets detected.\n');
    process.exit(0);
  }
  
  // Group by file
  const byFile = {};
  allFindings.forEach(f => {
    if (!byFile[f.file]) byFile[f.file] = [];
    byFile[f.file].push(f);
  });
  
  console.log('⚠️  SECRETS DETECTED:\n');
  
  Object.entries(byFile).forEach(([file, findings]) => {
    console.log(`📄 ${file}`);
    findings.forEach(f => {
      const masked = f.match.substring(0, 8) + '...' + f.match.slice(-4);
      console.log(`   Line ${f.line}: ${f.type}`);
      console.log(`   └─ ${masked}`);
    });
    console.log();
  });
  
  if (autoFix) {
    console.log('🔧 Auto-redacting secrets...\n');
    Object.entries(byFile).forEach(([file, findings]) => {
      const fixed = redactInFile(file, findings);
      if (fixed) {
        console.log(`   ✓ Redacted secrets in ${file}`);
        // Re-stage the file
        try {
          execSync(`git add "${file}"`, { encoding: 'utf8' });
        } catch (e) {}
      }
    });
    console.log('\n✅ Secrets redacted. Review changes and commit again.\n');
    process.exit(0);
  }
  
  console.log('─'.repeat(50));
  console.log('Options:');
  console.log('  1. Run with --fix to auto-redact');
  console.log('  2. Manually fix the files');
  console.log('  3. Use git commit --no-verify to bypass (NOT RECOMMENDED)');
  console.log();
  
  process.exit(1);
}

main();
