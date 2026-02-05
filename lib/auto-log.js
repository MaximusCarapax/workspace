/**
 * Auto-Log: Automatic tool instrumentation for activity logging
 * 
 * Provides lightweight breadcrumb logging for tool usage.
 * Context (source, relatedId) can be set once and inherited by all logTool calls.
 * 
 * Usage:
 *   const { setContext, logTool, wrapAsync } = require('./auto-log');
 *   
 *   // Set context for session (optional)
 *   setContext({ source: 'subagent', relatedId: 'pipeline:84' });
 *   
 *   // Log tool usage
 *   logTool('aider', 'Modified 2 files', { files: ['a.js', 'b.js'] });
 *   
 *   // Or wrap a function to auto-log
 *   const wrappedFn = wrapAsync('myTool', myAsyncFn);
 */

const activity = require('./activity');

// Context inherited by all logTool calls
let context = {
  source: null,
  relatedId: null
};

/**
 * Set context for all subsequent logTool calls
 * @param {Object} ctx - Context object
 * @param {string} [ctx.source] - Source: 'main', 'subagent', 'cron', 'heartbeat'
 * @param {string} [ctx.relatedId] - Related entity: 'pipeline:25', 'task:10'
 */
function setContext(ctx) {
  context = { ...context, ...ctx };
}

/**
 * Get current context
 * @returns {Object} Current context
 */
function getContext() {
  return { ...context };
}

/**
 * Clear context
 */
function clearContext() {
  context = { source: null, relatedId: null };
}

/**
 * Log tool usage to activity table
 * Safe to call - never throws, silently fails
 * 
 * @param {string} tool - Tool name (e.g., 'aider', 'web_search', 'exec')
 * @param {string} description - Human-readable description
 * @param {Object} [metadata] - Additional structured data
 */
function logTool(tool, description, metadata = {}) {
  try {
    const action = `tool:${tool}`;
    const category = 'tool';
    
    // Merge metadata with tool info
    const fullMetadata = {
      tool,
      ...metadata,
      timestamp: new Date().toISOString()
    };
    
    activity.logFull({
      action,
      category,
      description,
      metadata: fullMetadata,
      sessionId: null,
      source: context.source,
      relatedId: context.relatedId
    });
  } catch (e) {
    // Silent fail - never break the actual tool
    if (process.env.DEBUG_AUTO_LOG) {
      console.error('[auto-log] Error logging tool:', e.message);
    }
  }
}

/**
 * Wrap an async function with automatic logging
 * Logs start and completion (with duration)
 * 
 * @param {string} tool - Tool name
 * @param {Function} fn - Async function to wrap
 * @param {Object} [options] - Options
 * @param {Function} [options.describer] - Function to generate description from args
 * @param {Function} [options.metadataExtractor] - Function to extract metadata from result
 * @returns {Function} Wrapped function
 */
function wrapAsync(tool, fn, options = {}) {
  const { describer, metadataExtractor } = options;
  
  return async function(...args) {
    const start = Date.now();
    let result;
    let error;
    
    try {
      result = await fn.apply(this, args);
    } catch (e) {
      error = e;
    }
    
    const duration = Date.now() - start;
    
    try {
      const description = describer ? describer(args, result, error) : `${tool} executed`;
      const metadata = {
        duration_ms: duration,
        success: !error,
        ...(metadataExtractor && result ? metadataExtractor(result) : {})
      };
      
      if (error) {
        metadata.error = error.message;
      }
      
      logTool(tool, description, metadata);
    } catch (e) {
      // Silent fail
    }
    
    if (error) throw error;
    return result;
  };
}

/**
 * Wrap a sync function with automatic logging
 * @param {string} tool - Tool name
 * @param {Function} fn - Sync function to wrap
 * @param {Object} [options] - Options
 * @returns {Function} Wrapped function
 */
function wrapSync(tool, fn, options = {}) {
  const { describer, metadataExtractor } = options;
  
  return function(...args) {
    const start = Date.now();
    let result;
    let error;
    
    try {
      result = fn.apply(this, args);
    } catch (e) {
      error = e;
    }
    
    const duration = Date.now() - start;
    
    try {
      const description = describer ? describer(args, result, error) : `${tool} executed`;
      const metadata = {
        duration_ms: duration,
        success: !error,
        ...(metadataExtractor && result ? metadataExtractor(result) : {})
      };
      
      if (error) {
        metadata.error = error.message;
      }
      
      logTool(tool, description, metadata);
    } catch (e) {
      // Silent fail
    }
    
    if (error) throw error;
    return result;
  };
}

/**
 * Create a scoped logger with preset tool name
 * @param {string} tool - Tool name
 * @returns {Object} Logger with log() method
 */
function createLogger(tool) {
  return {
    log: (description, metadata = {}) => logTool(tool, description, metadata),
    start: (description) => {
      const startTime = Date.now();
      return {
        end: (finalDescription, metadata = {}) => {
          const duration = Date.now() - startTime;
          logTool(tool, finalDescription || description, { ...metadata, duration_ms: duration });
        }
      };
    }
  };
}

module.exports = {
  setContext,
  getContext,
  clearContext,
  logTool,
  wrapAsync,
  wrapSync,
  createLogger
};
