/**
 * Unified Activity Logging Service
 * 
 * Provides both simple and full APIs for logging and querying activities
 * across the system, leveraging the existing database layer.
 * 
 * @module activity
 */

const db = require('./db');

/**
 * Simple API: Log an activity with minimal parameters
 * 
 * @param {string} action - The action performed (e.g., 'task_created', 'user_login')
 * @param {string} description - Human-readable description of the activity
 * @param {string} [category] - Optional category for grouping activities
 * @param {Object} [options] - Optional additional parameters
 * @param {string} [options.source] - Source of the activity: "main", "subagent", "cron", "heartbeat"
 * @param {string} [options.relatedId] - Related entity ID, format: "pipeline:8", "task:15", "content:3"
 * @returns {Object} Result from the database operation
 * 
 * @example
 * activity.log('task_created', 'Created new task: Implement feature X', 'tasks');
 * activity.log('build_started', 'Building feature', 'build', { source: 'subagent', relatedId: 'pipeline:8' });
 */
function log(action, description, category, options = {}) {
  return db.logActivity({
    action,
    category: category || null,
    description,
    metadata: null,
    sessionId: null,
    source: options.source || null,
    relatedId: options.relatedId || null
  });
}

/**
 * Full API: Log an activity with complete metadata
 * 
 * @param {Object} params - Activity parameters
 * @param {string} params.action - The action performed
 * @param {string} [params.category] - Category for grouping
 * @param {string} params.description - Human-readable description
 * @param {Object} [params.metadata] - Additional structured data
 * @param {string} [params.sessionId] - Session identifier for tracking
 * @param {string} [params.source] - Source of the activity: "main", "subagent", "cron", "heartbeat"
 * @param {string} [params.relatedId] - Related entity ID, format: "pipeline:8", "task:15", "content:3"
 * @returns {Object} Result from the database operation
 * 
 * @example
 * activity.logFull({
 *   action: 'pipeline_updated',
 *   category: 'pipeline',
 *   description: 'Pipeline stage changed to build',
 *   metadata: { pipelineId: 123, from: 'spec', to: 'build' },
 *   sessionId: 'session_abc123',
 *   source: 'subagent',
 *   relatedId: 'pipeline:123'
 * });
 */
function logFull({ action, category, description, metadata, sessionId, source, relatedId }) {
  return db.logActivity({
    action,
    category: category || null,
    description,
    metadata: metadata || null,
    sessionId: sessionId || null,
    source: source || null,
    relatedId: relatedId || null
  });
}

/**
 * Get recent activities with optional limit
 * 
 * @param {number} [limit=20] - Maximum number of activities to return
 * @returns {Array<Object>} List of activity records
 * 
 * @example
 * const recent = activity.getRecent(50);
 */
function getRecent(limit = 20) {
  return db.getRecentActivity(limit);
}

/**
 * Get activities by date range
 * 
 * @param {string} startDate - Start date in ISO format (YYYY-MM-DD)
 * @param {string} endDate - End date in ISO format (YYYY-MM-DD)
 * @param {number} [limit=100] - Maximum number of activities to return
 * @returns {Array<Object>} List of activity records within the date range
 * 
 * @example
 * const todayActivities = activity.getActivitiesByDate('2024-01-15', '2024-01-15');
 */
function getActivitiesByDate(startDate, endDate, limit = 100) {
  const sql = `
    SELECT * FROM activity 
    WHERE date(created_at) BETWEEN date(?) AND date(?)
    ORDER BY created_at DESC
    LIMIT ?
  `;
  return db.db.prepare(sql).all(startDate, endDate, limit);
}

/**
 * Get activities by action type
 * 
 * @param {string} action - The action to filter by
 * @param {number} [limit=50] - Maximum number of activities to return
 * @returns {Array<Object>} List of activity records with the specified action
 * 
 * @example
 * const loginActivities = activity.getActivitiesByAction('user_login');
 */
function getActivitiesByAction(action, limit = 50) {
  const sql = `
    SELECT * FROM activity 
    WHERE action = ?
    ORDER BY created_at DESC
    LIMIT ?
  `;
  return db.db.prepare(sql).all(action, limit);
}

/**
 * Get activities by category
 * 
 * @param {string} category - The category to filter by
 * @param {number} [limit=50] - Maximum number of activities to return
 * @returns {Array<Object>} List of activity records in the specified category
 * 
 * @example
 * const pipelineActivities = activity.getActivitiesByCategory('pipeline');
 */
function getActivitiesByCategory(category, limit = 50) {
  const sql = `
    SELECT * FROM activity 
    WHERE category = ?
    ORDER BY created_at DESC
    LIMIT ?
  `;
  return db.db.prepare(sql).all(category, limit);
}

/**
 * Get activity statistics for a given period
 * 
 * @param {string} [period='day'] - Period to analyze: 'day', 'week', or 'month'
 * @returns {Object} Statistics including count by action and category
 * 
 * @example
 * const stats = activity.getStats('week');
 */
function getStats(period = 'day') {
  let interval;
  switch (period) {
    case 'day':
      interval = '1 day';
      break;
    case 'week':
      interval = '7 days';
      break;
    case 'month':
      interval = '30 days';
      break;
    default:
      interval = '1 day';
  }
  
  const sql = `
    WITH recent_activities AS (
      SELECT * FROM activity 
      WHERE created_at > datetime('now', '-' || ?)
    )
    SELECT 
      COUNT(*) as total,
      COUNT(DISTINCT action) as unique_actions,
      COUNT(DISTINCT category) as unique_categories,
      (
        SELECT action 
        FROM recent_activities 
        GROUP BY action 
        ORDER BY COUNT(*) DESC 
        LIMIT 1
      ) as most_common_action,
      (
        SELECT category 
        FROM recent_activities 
        WHERE category IS NOT NULL
        GROUP BY category 
        ORDER BY COUNT(*) DESC 
        LIMIT 1
      ) as most_common_category
    FROM recent_activities
  `;
  
  return db.db.prepare(sql).get(interval);
}

/**
 * Get activity digest for integration with other systems
 * 
 * @param {Object} options - Digest options
 * @param {string} [options.period='day'] - Time period
 * @param {number} [options.limit=20] - Maximum number of activities to include
 * @returns {Object} Digest containing statistics and recent activities
 * 
 * @example
 * const digest = activity.getDigest({ period: 'day', limit: 10 });
 */
function getDigest({ period = 'day', limit = 20 } = {}) {
  const stats = getStats(period);
  const recent = getRecent(limit);
  
  return {
    period,
    generated_at: new Date().toISOString(),
    stats,
    recent_activities: recent
  };
}

// Export a clean interface
module.exports = {
  /**
   * Simple logging API
   * @function
   */
  log,
  
  /**
   * Full logging API with metadata
   * @function
   */
  logFull,
  
  /**
   * Get recent activities
   * @function
   */
  getRecent,
  
  /**
   * Get activities by date range
   * @function
   */
  getActivitiesByDate,
  
  /**
   * Get activities by action type
   * @function
   */
  getActivitiesByAction,
  
  /**
   * Get activities by category
   * @function
   */
  getActivitiesByCategory,
  
  /**
   * Get activity statistics
   * @function
   */
  getStats,
  
  /**
   * Get activity digest for integration
   * @function
   */
  getDigest,
  
  // Alias for backward compatibility and convenience
  logActivity: logFull
};
