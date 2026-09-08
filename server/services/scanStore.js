/**
 * scanStore.js
 * ---------------------------------------------------------------------------
 * Public API the rest of the app uses for scan persistence. This file is
 * intentionally a thin pass-through to a swappable repository (see
 * server/services/db/) -- currently backed by SQLite
 * (server/services/db/sqliteRepository.js) so audits survive a server
 * restart, without any other file in the project needing to know that.
 *
 * ScanRecord shape (unchanged from the original in-memory version):
 *   {
 *     scanId:      string,
 *     userId:      string | null (the account that ran this scan, if any -- see server/services/userStore.js),
 *     url:         string,
 *     status:      'pending' | 'in_progress' | 'complete' | 'failed',
 *     createdAt:   string (ISO timestamp),
 *     completedAt: string (ISO timestamp) | null,
 *     result:      ScanResult | null   (see websiteScanner.js for the shape)
 *     audit:       AuditResult | null  (see auditEngine.js for the shape)
 *     analysis:    AIAnalysis | null   (see aiAnalyzer.js for the shape)
 *     error:       string | null
 *   }
 *
 * HistoryEntry shape (returned by listRecent(), used for "Recent Audits"):
 *   { scanId, url, status, createdAt, completedAt, overallScore, error }
 *
 * No API keys or other secrets are ever stored here -- only scan results,
 * audit findings, and AI recommendations for this app's own audits.
 * ---------------------------------------------------------------------------
 */

const repository = require('./db');

function createScan(url, userId = null) {
  return repository.createScan(url, userId);
}

function getScan(scanId) {
  return repository.getScan(scanId);
}

function updateScan(scanId, updates) {
  return repository.updateScan(scanId, updates);
}

/**
 * @param {number} [limit=20] Max entries to return (capped at 100).
 * @returns {Array<{scanId, url, status, createdAt, completedAt, overallScore, error}>}
 */
function listRecent(limit) {
  return repository.listRecent(limit);
}

/**
 * @param {string} userId
 * @param {number} [limit=20]
 * @returns {Array<{scanId, url, status, createdAt, completedAt, overallScore, error}>}
 */
function listRecentForUser(userId, limit) {
  return repository.listRecentForUser(userId, limit);
}

module.exports = {
  createScan,
  getScan,
  updateScan,
  listRecent,
  listRecentForUser,
};
