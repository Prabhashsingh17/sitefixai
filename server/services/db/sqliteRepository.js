/**
 * sqliteRepository.js
 * ---------------------------------------------------------------------------
 * SQLite implementation of the scan repository. Stores exactly the fields
 * requested for audit history -- scan ID, URL, timestamp, overall score,
 * category scores, scan data, findings, and AI recommendations -- and
 * nothing else. No API keys or other secrets are ever written here; there
 * is no column for one.
 *
 * Every function returns/accepts the same plain-JS "ScanRecord" shape the
 * rest of the app already uses (see server/services/scanStore.js), so
 * swapping this file for a Postgres or MongoDB implementation later is a
 * matter of matching that same shape -- nothing above this module needs to
 * change. See server/services/db/index.js for the swap point.
 * ---------------------------------------------------------------------------
 */

const crypto = require('crypto');
const { getDb } = require('./connection');

/** Converts a raw SQLite row into the ScanRecord shape used elsewhere. */
function rowToRecord(row) {
  if (!row) return null;

  const hasAudit = row.overall_score !== null || row.findings !== null;

  return {
    scanId: row.scan_id,
    url: row.url,
    status: row.status,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    result: row.scan_data ? JSON.parse(row.scan_data) : null,
    audit: hasAudit
      ? {
          overallScore: row.overall_score,
          categoryScores: row.category_scores ? JSON.parse(row.category_scores) : {},
          findings: row.findings ? JSON.parse(row.findings) : [],
          summary: row.audit_summary ? JSON.parse(row.audit_summary) : {},
        }
      : null,
    analysis: row.ai_recommendations ? JSON.parse(row.ai_recommendations) : null,
    error: row.error,
  };
}

function createScan(url) {
  const db = getDb();
  const scanId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  db.prepare(
    `INSERT INTO scans (scan_id, url, status, created_at)
     VALUES (@scanId, @url, 'pending', @createdAt)`
  ).run({ scanId, url, createdAt });

  return getScan(scanId);
}

function getScan(scanId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM scans WHERE scan_id = ?').get(scanId);
  return rowToRecord(row);
}

/**
 * Merges `updates` into the stored record and persists the result. Mirrors
 * the in-memory store's old semantics: a shallow merge of top-level fields
 * (status, completedAt, result, audit, analysis, error).
 */
function updateScan(scanId, updates) {
  const existing = getScan(scanId);
  if (!existing) return null;

  const merged = { ...existing, ...updates };
  const db = getDb();

  db.prepare(
    `UPDATE scans SET
       status = @status,
       completed_at = @completedAt,
       overall_score = @overallScore,
       category_scores = @categoryScores,
       scan_data = @scanData,
       findings = @findings,
       audit_summary = @auditSummary,
       ai_recommendations = @aiRecommendations,
       error = @error
     WHERE scan_id = @scanId`
  ).run({
    scanId,
    status: merged.status,
    completedAt: merged.completedAt || null,
    overallScore: merged.audit ? merged.audit.overallScore : null,
    categoryScores: merged.audit ? JSON.stringify(merged.audit.categoryScores) : null,
    scanData: merged.result ? JSON.stringify(merged.result) : null,
    findings: merged.audit ? JSON.stringify(merged.audit.findings) : null,
    auditSummary: merged.audit ? JSON.stringify(merged.audit.summary) : null,
    aiRecommendations: merged.analysis ? JSON.stringify(merged.analysis) : null,
    error: merged.error || null,
  });

  return getScan(scanId);
}

const MAX_HISTORY_LIMIT = 100;
const DEFAULT_HISTORY_LIMIT = 20;

/**
 * Lightweight history listing -- does not include the (potentially large)
 * scan_data/findings/ai_recommendations JSON blobs, just enough to render
 * a "Recent Audits" list. Fetch a single scan's full detail via getScan().
 */
function listRecent(limit = DEFAULT_HISTORY_LIMIT) {
  const db = getDb();
  const safeLimit = Math.max(1, Math.min(MAX_HISTORY_LIMIT, Number(limit) || DEFAULT_HISTORY_LIMIT));

  const rows = db
    .prepare(
      `SELECT scan_id, url, status, created_at, completed_at, overall_score, error
       FROM scans
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(safeLimit);

  return rows.map((row) => ({
    scanId: row.scan_id,
    url: row.url,
    status: row.status,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    overallScore: row.overall_score,
    error: row.error,
  }));
}

module.exports = { createScan, getScan, updateScan, listRecent };
