/**
 * Logged exec wrapper - automatically logs command execution to activity
 * 
 * Usage:
 *   const { execLogged, execSyncLogged } = require('./exec-logged');
 *   
 *   // Sync version
 *   const output = execSyncLogged('npm test', { cwd: '/path' });
 *   
 *   // Async version
 *   const result = await execLogged('npm install');
 */

const { exec, execSync } = require('child_process');
const { logTool } = require('./auto-log');

/**
 * Truncate command for logging (hide sensitive info, limit length)
 * @param {string} cmd - Command to truncate
 * @returns {string} Truncated command
 */
function sanitizeCommand(cmd) {
  // Remove potential secrets
  let sanitized = cmd
    .replace(/--password[=\s]+\S+/gi, '--password=***')
    .replace(/--token[=\s]+\S+/gi, '--token=***')
    .replace(/--key[=\s]+\S+/gi, '--key=***')
    .replace(/API_KEY[=]\S+/gi, 'API_KEY=***')
    .replace(/Bearer\s+\S+/gi, 'Bearer ***');
  
  // Truncate if too long
  if (sanitized.length > 200) {
    sanitized = sanitized.substring(0, 200) + '...';
  }
  
  return sanitized;
}

/**
 * Synchronous logged exec
 * @param {string} command - Command to execute
 * @param {Object} [options] - exec options
 * @returns {string|Buffer} Command output
 */
function execSyncLogged(command, options = {}) {
  const start = Date.now();
  let output;
  let exitCode = 0;
  let error = null;
  
  try {
    output = execSync(command, { encoding: 'utf8', ...options });
  } catch (e) {
    error = e;
    exitCode = e.status || 1;
    output = e.stdout || '';
  }
  
  const duration = Date.now() - start;
  
  // Log to activity
  try {
    const sanitized = sanitizeCommand(command);
    logTool('exec', `Ran: ${sanitized.substring(0, 80)}${sanitized.length > 80 ? '...' : ''}`, {
      command: sanitized,
      exit_code: exitCode,
      duration_ms: duration,
      success: exitCode === 0,
      cwd: options.cwd || process.cwd()
    });
  } catch (e) {
    // Silent fail
  }
  
  if (error) throw error;
  return output;
}

/**
 * Async logged exec
 * @param {string} command - Command to execute
 * @param {Object} [options] - exec options
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
function execLogged(command, options = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    
    exec(command, { encoding: 'utf8', ...options }, (error, stdout, stderr) => {
      const duration = Date.now() - start;
      const exitCode = error ? error.code || 1 : 0;
      
      // Log to activity
      try {
        const sanitized = sanitizeCommand(command);
        logTool('exec', `Ran: ${sanitized.substring(0, 80)}${sanitized.length > 80 ? '...' : ''}`, {
          command: sanitized,
          exit_code: exitCode,
          duration_ms: duration,
          success: !error,
          cwd: options.cwd || process.cwd()
        });
      } catch (e) {
        // Silent fail
      }
      
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

module.exports = {
  execLogged,
  execSyncLogged,
  sanitizeCommand
};
