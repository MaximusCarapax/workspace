/**
 * Sub-agent template loader
 * Load and interpolate markdown templates for spawning specialized agents
 */

const fs = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates', 'agents');

/**
 * Load a sub-agent template
 * @param {string} role - Template name (researcher, writer, analyst, fact-checker)
 * @param {Object} variables - Variables to interpolate (e.g., {TOPIC: 'AI'})
 * @param {Object} overrides - Additional sections to append/override
 * @returns {string} Interpolated prompt ready for sessions_spawn
 */
function load(role, variables = {}, overrides = {}) {
  const templatePath = path.join(TEMPLATES_DIR, `${role}.md`);
  
  if (!fs.existsSync(templatePath)) {
    const available = listTemplates();
    throw new Error(`Template '${role}' not found. Available: ${available.join(', ')}`);
  }
  
  let content = fs.readFileSync(templatePath, 'utf-8');
  
  // Interpolate {{VARIABLE}} placeholders
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    content = content.replace(regex, value);
  }
  
  // Append overrides as additional sections
  if (overrides.context) {
    content += `\n\n## Context\n${overrides.context}`;
  }
  if (overrides.task) {
    content += `\n\n## Task\n${overrides.task}`;
  }
  if (overrides.custom) {
    content += `\n\n${overrides.custom}`;
  }
  
  return content;
}

/**
 * List available templates
 * @returns {string[]} Array of template names (without .md extension)
 */
function listTemplates() {
  if (!fs.existsSync(TEMPLATES_DIR)) return [];
  return fs.readdirSync(TEMPLATES_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => f.replace('.md', ''));
}

/**
 * Check if a template exists
 * @param {string} role - Template name
 * @returns {boolean}
 */
function exists(role) {
  return fs.existsSync(path.join(TEMPLATES_DIR, `${role}.md`));
}

module.exports = { load, listTemplates, exists };
