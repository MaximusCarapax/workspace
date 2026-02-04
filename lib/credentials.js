/**
 * Unified Credentials Manager
 * 
 * Single source of truth for all API keys and secrets.
 * 
 * Priority:
 * 1. Environment variables (.env)
 * 2. credentials.json (nested or flat)
 * 3. Specific secret files (openrouter.json, gmail-token.json, etc.)
 * 
 * Usage:
 *   const { get, getRequired, has } = require('./lib/credentials');
 *   
 *   const key = get('gemini');           // Returns null if missing
 *   const key = getRequired('gemini');   // Throws if missing
 *   if (has('openrouter')) { ... }
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');

const SECRETS_DIR = path.join(process.env.HOME, '.openclaw/secrets');
const CREDENTIALS_PATH = path.join(SECRETS_DIR, 'credentials.json');

// Mapping from simple names to env vars and credential paths
const KEY_MAP = {
  // AI Models
  gemini: { env: 'GEMINI_API_KEY', path: 'gemini.apiKey' },
  gemini2: { env: 'GEMINI_API_KEY_2', path: null },
  deepseek: { env: 'DEEPSEEK_API_KEY', path: 'deepseek.apiKey' },
  openai: { env: 'OPENAI_API_KEY', path: 'openai.apiKey' },
  xai: { env: 'XAI_API_KEY', path: 'xai.apiKey' },
  openrouter: { env: 'OPENROUTER_API_KEY', file: 'openrouter.json', filePath: 'api_key' },
  elevenlabs: { env: 'ELEVENLABS_API_KEY', path: 'elevenlabs.apiKey' },
  
  // Dev Tools
  github: { env: 'GITHUB_TOKEN', path: 'github.token' },
  github_maximus: { env: null, path: 'github_maximus.token' },
  linear: { env: 'LINEAR_API_KEY', path: 'linear.apiKey' },
  
  // Google
  google_client_id: { env: 'GOOGLE_CLIENT_ID', path: 'google_client_id' },
  google_client_secret: { env: 'GOOGLE_CLIENT_SECRET', path: 'google_client_secret' },
  gmail_refresh_token: { env: null, path: 'gmail_refresh_token', file: 'gmail-token.json', filePath: 'refresh_token' },
  gmail_access_token: { env: null, path: 'gmail_access_token', file: 'gmail-token.json', filePath: 'access_token' },
  
  // Social
  x_api_key: { env: null, path: 'x.apiKey' },
  x_api_secret: { env: null, path: 'x.apiSecret' },
  x_access_token: { env: null, path: 'x.accessToken' },
  x_access_token_secret: { env: null, path: 'x.accessTokenSecret' },
  x_bearer: { env: null, path: 'x.bearerToken' },
  bird_auth_token: { env: 'AUTH_TOKEN', path: null },
  bird_ct0: { env: 'CT0', path: null },
  linkedin_email: { env: null, path: 'linkedin.email' },
  linkedin_password: { env: null, path: 'linkedin.password' },
  
  // Services
  twilio_account_sid: { env: 'TWILIO_ACCOUNT_SID', path: 'twilio.accountSid' },
  twilio_auth_token: { env: 'TWILIO_AUTH_TOKEN', path: 'twilio.authToken' },
  twilio_phone: { env: 'TWILIO_PHONE_NUMBER', path: 'twilio.phoneNumber' },
  twocaptcha: { env: 'TWOCAPTCHA_API_KEY', path: '2captcha.apiKey' },
  voipline: { env: null, path: 'voipline.apiKey' },
};

// Cache for credentials.json
let credsCache = null;
let credsCacheTime = 0;
const CACHE_TTL = 60000; // 1 minute

function loadCredentials() {
  const now = Date.now();
  if (credsCache && now - credsCacheTime < CACHE_TTL) {
    return credsCache;
  }
  
  try {
    if (fs.existsSync(CREDENTIALS_PATH)) {
      credsCache = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
      credsCacheTime = now;
      return credsCache;
    }
  } catch (e) {
    console.warn(`Warning: Could not load credentials.json: ${e.message}`);
  }
  
  return {};
}

function loadSecretFile(filename, jsonPath) {
  try {
    const filePath = path.join(SECRETS_DIR, filename);
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return getNestedValue(data, jsonPath);
    }
  } catch (e) {
    // Silent fail
  }
  return null;
}

function getNestedValue(obj, path) {
  if (!path) return null;
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return null;
    current = current[part];
  }
  return current;
}

/**
 * Get a credential by name
 * @param {string} name - Credential name (e.g., 'gemini', 'github', 'x_api_key')
 * @returns {string|null} - The credential value or null if not found
 */
function get(name) {
  const mapping = KEY_MAP[name.toLowerCase()];
  
  if (mapping) {
    // 1. Check environment variable
    if (mapping.env && process.env[mapping.env]) {
      return process.env[mapping.env];
    }
    
    // 2. Check credentials.json
    if (mapping.path) {
      const creds = loadCredentials();
      const value = getNestedValue(creds, mapping.path);
      if (value) return value;
    }
    
    // 3. Check specific secret file
    if (mapping.file && mapping.filePath) {
      const value = loadSecretFile(mapping.file, mapping.filePath);
      if (value) return value;
    }
  }
  
  // Fallback: Try common patterns
  // 1. Direct env var (NAME_API_KEY, NAME_KEY, NAME)
  const envNames = [
    `${name.toUpperCase()}_API_KEY`,
    `${name.toUpperCase()}_KEY`,
    name.toUpperCase(),
  ];
  for (const envName of envNames) {
    if (process.env[envName]) return process.env[envName];
  }
  
  // 2. Direct lookup in credentials.json
  const creds = loadCredentials();
  if (creds[name]) {
    // Could be a string or an object with apiKey
    if (typeof creds[name] === 'string') return creds[name];
    if (creds[name].apiKey) return creds[name].apiKey;
    if (creds[name].token) return creds[name].token;
    if (creds[name].key) return creds[name].key;
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
 * Get all credentials for a service (e.g., all 'x' credentials)
 * @param {string} prefix - Service prefix (e.g., 'x', 'twilio')
 * @returns {Object} - Object with all matching credentials
 */
function getAll(prefix) {
  const result = {};
  const lowerPrefix = prefix.toLowerCase();
  
  for (const [key, mapping] of Object.entries(KEY_MAP)) {
    if (key.startsWith(lowerPrefix)) {
      const value = get(key);
      if (value) {
        // Convert x_api_key to apiKey
        const shortKey = key.replace(`${lowerPrefix}_`, '').replace(/_([a-z])/g, (_, c) => c.toUpperCase());
        result[shortKey || 'key'] = value;
      }
    }
  }
  
  return result;
}

/**
 * List all available credential names
 * @returns {string[]}
 */
function list() {
  return Object.keys(KEY_MAP);
}

/**
 * Invalidate the cache (useful after updating credentials)
 */
function clearCache() {
  credsCache = null;
  credsCacheTime = 0;
}

module.exports = {
  get,
  getRequired,
  has,
  getAll,
  list,
  clearCache,
  SECRETS_DIR,
  CREDENTIALS_PATH,
};
