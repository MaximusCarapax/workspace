#!/usr/bin/env node

/**
 * Sub-Agent Context Builder
 * 
 * Builds lean, role-specific prompts for sub-agents.
 * Replaces the 190k token monster with ~2-5k focused context.
 */

const fs = require('fs');
const path = require('path');

const SUBAGENTS_DIR = __dirname;
const PERSONAS_DIR = path.join(SUBAGENTS_DIR, 'personas');

// Valid roles
const ROLES = ['developer', 'dev', 'qa', 'researcher', 'writer', 'spec'];

// Role aliases
const ROLE_ALIASES = {
  'dev': 'developer',
  'review': 'qa',
  'research': 'researcher',
  'write': 'writer',
  'specification': 'spec'
};

/**
 * Load a persona file
 */
function loadPersona(role) {
  const normalizedRole = ROLE_ALIASES[role] || role;
  const personaPath = path.join(PERSONAS_DIR, `${normalizedRole}.md`);
  
  if (!fs.existsSync(personaPath)) {
    throw new Error(`Unknown role: ${role}. Valid roles: ${ROLES.join(', ')}`);
  }
  
  return fs.readFileSync(personaPath, 'utf-8');
}

/**
 * Load shared guidelines
 */
function loadGuidelines() {
  const guidelinesPath = path.join(SUBAGENTS_DIR, 'guidelines.md');
  return fs.readFileSync(guidelinesPath, 'utf-8');
}

/**
 * Build the full sub-agent context
 * 
 * @param {string} role - The role (developer, qa, researcher, writer, spec)
 * @param {string} task - The task description
 * @param {object} options - Additional options
 * @param {string[]} options.memories - Pre-fetched relevant memories
 * @param {string} options.specContent - Spec file content if referenced
 * @param {object} options.extraContext - Any additional context to inject
 */
function buildContext(role, task, options = {}) {
  const persona = loadPersona(role);
  const guidelines = loadGuidelines();
  
  // Build memory context section
  let memorySection = '';
  if (options.memories && options.memories.length > 0) {
    memorySection = `
## RELEVANT CONTEXT (from memory)
${options.memories.map(m => `- ${m}`).join('\n')}
`;
  }
  
  // Build spec section if provided
  let specSection = '';
  if (options.specContent) {
    specSection = `
## SPECIFICATION
${options.specContent}
`;
  }
  
  // Build extra context if provided
  let extraSection = '';
  if (options.extraContext) {
    extraSection = `
## ADDITIONAL CONTEXT
${typeof options.extraContext === 'string' ? options.extraContext : JSON.stringify(options.extraContext, null, 2)}
`;
  }
  
  // Combine everything
  const fullContext = `${persona}
${memorySection}${specSection}${extraSection}
${guidelines}

## YOUR TASK

${task}

---
Complete this task following your role guidelines. Log your work to activity when done.
`;

  return fullContext;
}

/**
 * Estimate token count (rough approximation)
 */
function estimateTokens(text) {
  // Rough estimate: 1 token ≈ 4 characters
  return Math.ceil(text.length / 4);
}

/**
 * Build context and return with metadata
 */
function build(role, task, options = {}) {
  const context = buildContext(role, task, options);
  const tokens = estimateTokens(context);
  
  return {
    context,
    tokens,
    role: ROLE_ALIASES[role] || role,
    task
  };
}

// Export for programmatic use
module.exports = {
  buildContext,
  build,
  loadPersona,
  loadGuidelines,
  estimateTokens,
  ROLES,
  ROLE_ALIASES
};

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log(`Usage: node context-builder.js <role> "task description"

Roles: ${ROLES.join(', ')}

Options:
  --memories "mem1" "mem2"  Add memory context
  --spec <file>             Include spec file
  --tokens                  Show token estimate

Example:
  node context-builder.js dev "Build the widget feature"
  node context-builder.js qa "Review the auth module" --spec specs/auth.md
`);
    process.exit(1);
  }
  
  const role = args[0];
  const task = args[1];
  
  // Parse options
  const options = {};
  let i = 2;
  while (i < args.length) {
    if (args[i] === '--memories') {
      options.memories = [];
      i++;
      while (i < args.length && !args[i].startsWith('--')) {
        options.memories.push(args[i]);
        i++;
      }
    } else if (args[i] === '--spec' && args[i + 1]) {
      const specPath = args[i + 1];
      if (fs.existsSync(specPath)) {
        options.specContent = fs.readFileSync(specPath, 'utf-8');
      } else {
        console.error(`Spec file not found: ${specPath}`);
        process.exit(1);
      }
      i += 2;
    } else if (args[i] === '--tokens') {
      options.showTokens = true;
      i++;
    } else {
      i++;
    }
  }
  
  try {
    const result = build(role, task, options);
    
    if (options.showTokens) {
      console.log(`\n--- Token Estimate: ~${result.tokens} tokens ---\n`);
    }
    
    console.log(result.context);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}
