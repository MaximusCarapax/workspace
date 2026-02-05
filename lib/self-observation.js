/**
 * Self-Observation System
 * 
 * Passive behavioral signal capture for tracking patterns over time.
 * Uses existing activity logging - no extra API calls required.
 * 
 * Activity Types:
 * - self_obs_task_preference: What tasks I gravitate toward or avoid
 * - self_obs_communication: How I communicate (tone, length, frequency)
 * - self_obs_decision: Decisions made (asked permission vs acted autonomously)
 * - self_obs_error: Errors made, corrections, learnings
 */

const { logActivity } = require('./db');

// ============================================================
// CONSTANTS
// ============================================================

const OBS_CATEGORIES = {
  TASK_PREFERENCE: 'self_obs_task_preference',
  COMMUNICATION: 'self_obs_communication',
  DECISION: 'self_obs_decision',
  ERROR: 'self_obs_error'
};

// ============================================================
// TASK PREFERENCE OBSERVATIONS
// ============================================================

/**
 * Log task completion/preference signals
 * @param {Object} params
 * @param {string} params.taskType - Type of task (coding, research, writing, etc.)
 * @param {string} params.outcome - completed, deferred, delegated, avoided
 * @param {number} params.durationMs - How long task took (optional)
 * @param {string} params.notes - Additional context
 * @param {string} params.sessionId - Session ID
 * @param {string} params.source - Source (main, subagent, etc.)
 * @param {string} params.relatedId - Related pipeline/task ID
 */
function logTaskPreference({ taskType, outcome, durationMs, notes, sessionId, source, relatedId }) {
  return logActivity({
    action: `task_${outcome}`,
    category: OBS_CATEGORIES.TASK_PREFERENCE,
    description: `${taskType}: ${outcome}${notes ? ` - ${notes}` : ''}`,
    metadata: {
      taskType,
      outcome,
      durationMs: durationMs || null,
      notes: notes || null
    },
    sessionId,
    source: source || 'self_observation',
    relatedId
  });
}

/**
 * Log when I start a task (to track duration later)
 */
function logTaskStart({ taskType, taskId, sessionId, source }) {
  return logActivity({
    action: 'task_started',
    category: OBS_CATEGORIES.TASK_PREFERENCE,
    description: `Started: ${taskType}`,
    metadata: { taskType, taskId },
    sessionId,
    source: source || 'self_observation'
  });
}

/**
 * Log when I delegate a task to a sub-agent or tool
 */
function logTaskDelegated({ taskType, delegatedTo, reason, sessionId, source }) {
  return logActivity({
    action: 'task_delegated',
    category: OBS_CATEGORIES.TASK_PREFERENCE,
    description: `Delegated ${taskType} to ${delegatedTo}`,
    metadata: { taskType, delegatedTo, reason },
    sessionId,
    source: source || 'self_observation'
  });
}

// ============================================================
// COMMUNICATION OBSERVATIONS
// ============================================================

/**
 * Log communication pattern signals
 * @param {Object} params
 * @param {string} params.channel - telegram, discord, email, etc.
 * @param {string} params.messageType - response, proactive, clarification, etc.
 * @param {number} params.responseTimeMs - Time to respond (optional)
 * @param {number} params.messageLength - Character count
 * @param {string} params.tone - detected tone (helpful, terse, friendly, formal)
 * @param {string} params.sessionId
 * @param {string} params.source
 */
function logCommunication({ channel, messageType, responseTimeMs, messageLength, tone, sessionId, source }) {
  return logActivity({
    action: `comm_${messageType}`,
    category: OBS_CATEGORIES.COMMUNICATION,
    description: `${channel}: ${messageType} (${messageLength} chars${tone ? `, ${tone}` : ''})`,
    metadata: {
      channel,
      messageType,
      responseTimeMs: responseTimeMs || null,
      messageLength,
      tone: tone || null
    },
    sessionId,
    source: source || 'self_observation'
  });
}

/**
 * Log when I chose to stay silent (HEARTBEAT_OK, group chat, etc.)
 */
function logSilence({ channel, reason, sessionId, source }) {
  return logActivity({
    action: 'comm_silence',
    category: OBS_CATEGORIES.COMMUNICATION,
    description: `Chose silence: ${reason}`,
    metadata: { channel, reason },
    sessionId,
    source: source || 'self_observation'
  });
}

// ============================================================
// DECISION OBSERVATIONS
// ============================================================

/**
 * Log decision signals - when I acted autonomously vs asked permission
 * @param {Object} params
 * @param {string} params.decisionType - autonomous, asked_permission, deferred, escalated
 * @param {string} params.action - What action was taken/considered
 * @param {string} params.reason - Why this decision style was chosen
 * @param {string} params.riskLevel - low, medium, high
 * @param {string} params.outcome - success, failure, pending (optional)
 * @param {string} params.sessionId
 * @param {string} params.source
 * @param {string} params.relatedId
 */
function logDecision({ decisionType, action, reason, riskLevel, outcome, sessionId, source, relatedId }) {
  return logActivity({
    action: `decision_${decisionType}`,
    category: OBS_CATEGORIES.DECISION,
    description: `${decisionType}: ${action}`,
    metadata: {
      decisionType,
      action,
      reason: reason || null,
      riskLevel: riskLevel || 'low',
      outcome: outcome || null
    },
    sessionId,
    source: source || 'self_observation',
    relatedId
  });
}

/**
 * Convenience: Log autonomous action taken without asking
 */
function logAutonomousAction({ action, reason, riskLevel, sessionId, source, relatedId }) {
  return logDecision({
    decisionType: 'autonomous',
    action,
    reason,
    riskLevel,
    sessionId,
    source,
    relatedId
  });
}

/**
 * Convenience: Log when I asked for permission/clarification
 */
function logAskedPermission({ action, reason, sessionId, source, relatedId }) {
  return logDecision({
    decisionType: 'asked_permission',
    action,
    reason,
    sessionId,
    source,
    relatedId
  });
}

// ============================================================
// ERROR OBSERVATIONS
// ============================================================

/**
 * Log error signals - mistakes made, corrections, learnings
 * @param {Object} params
 * @param {string} params.errorType - misunderstanding, wrong_tool, bad_output, timeout, etc.
 * @param {string} params.description - What went wrong
 * @param {string} params.correction - How it was corrected (optional)
 * @param {string} params.learning - What was learned (optional)
 * @param {boolean} params.userCorrected - Did user point out the error?
 * @param {string} params.severity - minor, moderate, major
 * @param {string} params.sessionId
 * @param {string} params.source
 * @param {string} params.relatedId
 */
function logObservedError({ errorType, description, correction, learning, userCorrected, severity, sessionId, source, relatedId }) {
  return logActivity({
    action: `error_${errorType}`,
    category: OBS_CATEGORIES.ERROR,
    description: `${errorType}: ${description}`,
    metadata: {
      errorType,
      description,
      correction: correction || null,
      learning: learning || null,
      userCorrected: userCorrected || false,
      severity: severity || 'minor'
    },
    sessionId,
    source: source || 'self_observation',
    relatedId
  });
}

/**
 * Log self-correction (noticed and fixed own mistake)
 */
function logSelfCorrection({ originalError, correction, learning, sessionId, source }) {
  return logActivity({
    action: 'error_self_corrected',
    category: OBS_CATEGORIES.ERROR,
    description: `Self-corrected: ${originalError}`,
    metadata: {
      originalError,
      correction,
      learning: learning || null,
      userCorrected: false
    },
    sessionId,
    source: source || 'self_observation'
  });
}

/**
 * Log when user corrected me (valuable feedback signal)
 */
function logUserCorrection({ whatWasWrong, userFeedback, learning, sessionId, source }) {
  return logActivity({
    action: 'error_user_corrected',
    category: OBS_CATEGORIES.ERROR,
    description: `User correction: ${whatWasWrong}`,
    metadata: {
      whatWasWrong,
      userFeedback,
      learning: learning || null,
      userCorrected: true
    },
    sessionId,
    source: source || 'self_observation'
  });
}

// ============================================================
// QUERY HELPERS
// ============================================================

/**
 * Get recent observations by category
 * @param {string} category - One of OBS_CATEGORIES values
 * @param {number} limit - Max results
 * @returns {Array} Activity records
 */
function getObservations(category, limit = 50) {
  const { db } = require('./db');
  return db.prepare(`
    SELECT * FROM activity 
    WHERE category = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(category, limit);
}

/**
 * Get observation stats by category
 * @param {string} category 
 * @param {number} days - Lookback period
 * @returns {Object} Aggregated stats
 */
function getObservationStats(category, days = 7) {
  const { db } = require('./db');
  
  const stats = db.prepare(`
    SELECT 
      action,
      COUNT(*) as count
    FROM activity 
    WHERE category = ?
      AND created_at > datetime('now', '-' || ? || ' days')
    GROUP BY action
    ORDER BY count DESC
  `).all(category, days);
  
  return stats;
}

/**
 * Get all self-observation stats summary
 * @param {number} days - Lookback period
 * @returns {Object} Summary across all observation types
 */
function getSelfObservationSummary(days = 7) {
  const { db } = require('./db');
  
  const summary = {};
  for (const [name, category] of Object.entries(OBS_CATEGORIES)) {
    summary[name] = db.prepare(`
      SELECT 
        COUNT(*) as total,
        COUNT(DISTINCT action) as unique_actions
      FROM activity 
      WHERE category = ?
        AND created_at > datetime('now', '-' || ? || ' days')
    `).get(category, days);
  }
  
  return summary;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  // Constants
  OBS_CATEGORIES,
  
  // Task preference
  logTaskPreference,
  logTaskStart,
  logTaskDelegated,
  
  // Communication
  logCommunication,
  logSilence,
  
  // Decision
  logDecision,
  logAutonomousAction,
  logAskedPermission,
  
  // Error
  logObservedError,
  logSelfCorrection,
  logUserCorrection,
  
  // Query helpers
  getObservations,
  getObservationStats,
  getSelfObservationSummary
};
