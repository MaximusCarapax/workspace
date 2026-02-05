/**
 * Unified Credentials Manager
 * 
 * Single source of truth: .env file
 * Fallback: specific JSON files for OAuth tokens
 * 
 * Usage:
 *   const creds = require('./lib/credentials');
 *   const key = creds.get('gemini');           // Returns null if missing
 *   const key = creds.getRequired('gemini');   // Throws if missing
 *   if (creds.has('openrouter')) { ... }
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');

const SECRETS_DIR = path.join(process.env.HOME, '.openclaw/secrets');

// Mapping from simple names to env vars
// Format: name -> ENV_VAR_NAME or [ENV_VAR_NAME, ...fallbacks]
const KEY_MAP = {
  // AI Models
  gemini: 'GEMINI_API_KEY',
  gemini2: 'GEMINI_API_KEY_2',
  deepseek: 'DEEPSEEK_API_KEY',
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  xai: 'XAI_API_KEY',
  elevenlabs: 'ELEVENLABS_API_KEY',
  
  // Google
  google_client_id: 'GOOGLE_CLIENT_ID',
  google_client_secret: 'GOOGLE_CLIENT_SECRET',
  
  // X/Twitter
  x_api_key: 'X_API_KEY',
  x_api_secret: 'X_API_SECRET',
  x_access_token: 'X_ACCESS_TOKEN',
  x_access_token_secret: 'X_ACCESS_TOKEN_SECRET',
  bird_auth_token: 'AUTH_TOKEN',
  bird_ct0: 'CT0',
  
  // LinkedIn
  linkedin_email: 'LINKEDIN_EMAIL',
  linkedin_password: 'LINKEDIN_PASSWORD',
  
  // Twilio
  twilio_account_sid: 'TWILIO_ACCOUNT_SID',
  twilio_auth_token: 'TWILIO_AUTH_TOKEN',
  twilio_phone: 'TWILIO_PHONE_NUMBER',
  
  // Dev Tools
  github: 'GITHUB_TOKEN',
  github_maximus: 'GITHUB_MAXIMUS_TOKEN',
  
  // Other
  twocaptcha: 'TWOCAPTCHA_API_KEY',
  voipline: 'VOIPLINE_API_KEY',
};

// Special files for OAuth tokens (these have expiry, need JSON)
const TOKEN_FILES = {
  gmail_access_token: { file: 'gmail-token.json', key: 'access_token' },
  gmail_refresh_token: { file: 'gmail-token.json', key: 'refresh_token' },
  gmail_token_expiry: { file: 'gmail-token.json', key: 'expiry_date' },
};

function loadJsonFile(filename, key) {
  try {
    const filePath = path.join(SECRETS_DIR, filename);
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return data[key];
    }
  } catch (e) {
    // Silent fail
  }
  return null;
}

/**
 * Get a credential by name
 * @param {string} name - Credential name (e.g., 'gemini', 'github', 'x_api_key')
 * @returns {string|null} - The credential value or null if not found
 */
function get(name) {
  const lowerName = name.toLowerCase();
  
  // Check if it's a token file credential
  if (TOKEN_FILES[lowerName]) {
    const { file, key } = TOKEN_FILES[lowerName];
    return loadJsonFile(file, key);
  }
  
  // Check KEY_MAP
  const envVar = KEY_MAP[lowerName];
  if (envVar && process.env[envVar]) {
    return process.env[envVar];
  }
  
  // Fallback: try common env var patterns
  const patterns = [
    name.toUpperCase(),
    `${name.toUpperCase()}_API_KEY`,
    `${name.toUpperCase()}_KEY`,
    `${name.toUpperCase()}_TOKEN`,
  ];
  
  for (const pattern of patterns) {
    if (process.env[pattern]) {
      return process.env[pattern];
    }
  }
  
  return null;
}

/**
 * Get a credential, throw if missing
 * @param {string} name - Credential name
 * @returns {string} - The credential value
 * @throws {Error} - If credential is not found
 */
function getRequired(name) {
  const value = get(name);
  if (!value) {
    throw new Error(`Missing required credential: ${name}`);
  }
  return value;
}

/**
 * Check if a credential exists
 * @param {string} name - Credential name
 * @returns {boolean}
 */
function has(name) {
  return get(name) !== null;
}

/**
 * Get all credentials for a service prefix
 * @param {string} prefix - Service prefix (e.g., 'x', 'twilio')
 * @returns {Object}
 */
function getAll(prefix) {
  const result = {};
  const lowerPrefix = prefix.toLowerCase();
  
  for (const [key] of Object.entries(KEY_MAP)) {
    if (key.startsWith(lowerPrefix + '_') || key === lowerPrefix) {
      const value = get(key);
      if (value) {
        const shortKey = key === lowerPrefix ? 'key' : key.replace(`${lowerPrefix}_`, '');
        result[shortKey] = value;
      }
    }
  }
  
  return result;
}

/**
 * List all known credential names
 * @returns {string[]}
 */
function list() {
  return [...Object.keys(KEY_MAP), ...Object.keys(TOKEN_FILES)].sort();
}

module.exports = {
  get,
  getRequired,
  has,
  getAll,
  list,
  SECRETS_DIR,
};
