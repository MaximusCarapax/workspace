#!/usr/bin/env node
/**
 * Credentials CLI
 * 
 * Usage:
 *   node tools/creds.js list              # List all known credential names
 *   node tools/creds.js check             # Check which credentials are available
 *   node tools/creds.js get <name>        # Get a specific credential (masked)
 *   node tools/creds.js get <name> --raw  # Get unmasked value
 */

const creds = require('../lib/credentials');

const args = process.argv.slice(2);
const command = args[0];

function mask(value) {
  if (!value) return '(not set)';
  if (typeof value !== 'string') value = String(value);
  if (value.length <= 8) return '***';
  return value.slice(0, 6) + '...' + value.slice(-4);
}

switch (command) {
  case 'list':
    console.log('📋 Known credential names:\n');
    const names = creds.list().sort();
    for (const name of names) {
      console.log(`  ${name}`);
    }
    console.log(`\nTotal: ${names.length} credentials`);
    break;

  case 'check':
    console.log('🔐 Credential Status\n');
    const all = creds.list().sort();
    let found = 0;
    let missing = 0;
    
    for (const name of all) {
      const value = creds.get(name);
      if (value) {
        console.log(`  ✓ ${name.padEnd(25)} ${mask(value)}`);
        found++;
      } else {
        console.log(`  ✗ ${name.padEnd(25)} (missing)`);
        missing++;
      }
    }
    
    console.log(`\n✓ Found: ${found} | ✗ Missing: ${missing}`);
    break;

  case 'get':
    const name = args[1];
    if (!name) {
      console.error('Usage: creds.js get <name> [--raw]');
      process.exit(1);
    }
    
    const value = creds.get(name);
    if (!value) {
      console.error(`❌ Credential not found: ${name}`);
      process.exit(1);
    }
    
    if (args.includes('--raw')) {
      console.log(value);
    } else {
      console.log(`${name}: ${mask(value)}`);
    }
    break;

  case 'help':
  case '--help':
  case '-h':
  default:
    console.log(`🔐 Credentials CLI

Usage:
  node tools/creds.js list              List all known credential names
  node tools/creds.js check             Check which credentials are available
  node tools/creds.js get <name>        Get a specific credential (masked)
  node tools/creds.js get <name> --raw  Get unmasked value

Examples:
  creds.js check                        See what's configured
  creds.js get gemini                   Check if Gemini key exists
  creds.js get openrouter --raw         Get raw OpenRouter key (for scripts)
`);
    break;
}
