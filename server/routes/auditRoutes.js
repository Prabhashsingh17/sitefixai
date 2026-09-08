/**
 * auditRoutes.js
 * ---------------------------------------------------------------------------
 * POST /api/audit/scan
 *
 * Synchronous audit endpoint: validates the URL, runs the real website
 * scanner, and returns the full structured result in one response.
 *
 * Request:
 *   { "url": "https://example.com" }
 *
 * Response (success):
 *   { "success": true, "scanId": "...", "data": { ...ScanResult }, "audit": { ...AuditResult } }
 *
 * Response (failure):
 *   { "success": false, "scanId": "...", "error": "<code>", "message": "<safe message>" }
 *
 * Every scan is also recorded in scanStore under its scanId, so it can
 * later be looked up via GET /api/scan/:scanId as well.
 *
 * POST /api/audit/analyze
 *
 * Takes a scanId for an already-completed scan and generates AI-powered
 * recommendations from its real scan + audit data via aiAnalyzer.js. The
 * Claude API key lives only in this server process (server/services/
 * aiAnalyzer.js reads it from process.env) — it is never sent to or
 * readable by the browser.
 *
 * Request:
 *   { "scanId": "..." }
 *
 * Response (success):
 *   { "success": true, "scanId": "...", "analysis": { ...AIAnalysis } }
 *
 * Response (failure):
 *   { "success": false, "scanId": "...", "error": "<code>", "message": "<safe message>" }
 *
 * GET /api/audit/history?limit=20
 *
 * Lists recent audits (newest first) for the "Recent Audits" dashboard
 * section -- URL, status, timestamps, and overall score only, not the full
 * scan/audit/AI payload (fetch a specific scanId for that).
 *
 * Response:
 *   { "success": true, "history": [ { scanId, url, status, createdAt, completedAt, overallScore, error } ] }
 *
 * GET /api/audit/:scanId
 *
 * Full detail for one historical audit -- equivalent to GET /api/scan/:scanId
 * but under the /api/audit namespace, with field names matching this
 * namespace's other responses (data/audit/analysis).
 *
 * Response (success):
 *   { "success": true, "scanId", "url", "status", "createdAt", "completedAt", "data", "audit", "analysis", "error" }
 * Response (failure):
 *   { "success": false, "error": "not_found", "message": "..." }
 * ---------------------------------------------------------------------------
 */

const express = require('express');
const router = express.Router();
const scanStore = require('../services/scanStore');
const websiteScanner = require('../services/websiteScanner');
const { runAudit } = require('../services/auditEngine');
const aiAnalyzer = require('../services/aiAnalyzer');
const { createRateLimiter, scanRateLimiter } = require('../middleware/rateLimit');

const { ScanError } = websiteScanner.errors;
const { AIError } = aiAnalyzer.errors;

const URL_PATTERN = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;
// A scanId is always a crypto.randomUUID() value (see scanStore.js).
const SCAN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Shared with scanRoutes.js's POST /api/scan -- both trigger the same real
// outbound scan, so they share one budget rather than each getting their
// own (see middleware/rateLimit.js).

// This endpoint calls the real, billed Claude API -- a stricter cap here
// protects against runaway API cost, not just server load.
const analyzeRateLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,
  max: 15,
  message: 'Too many AI analysis requests. Please wait a few minutes and try again.',
});

// Maps ScanError codes to HTTP status codes. Anything not listed here (i.e.
// an unexpected, non-ScanError bug) falls back to 500.
const ERROR_STATUS_MAP = {
  invalid_url: 400,
  blocked_target: 400,
  timeout: 504,
  response_too_large: 422,
  unsupported_content_type: 422,
  fetch_failed: 502,
  too_many_redirects: 400,
};

// Maps AIError codes to HTTP status codes.
const AI_ERROR_STATUS_MAP = {
  ai_not_configured: 503,
  audit_not_ready: 409,
  ai_request_failed: 502,
  ai_timeout: 504,
  ai_invalid_response: 502,
};

// POST /api/audit/scan  { url: "https://example.com" }
router.post('/scan', scanRateLimiter, async (req, res) => {
  const { url } = req.body || {};
  const trimmedUrl = typeof url === 'string' ? url.trim() : '';

  if (!URL_PATTERN.test(trimmedUrl)) {
    return res.status(400).json({
      success: false,
      error: 'invalid_url',
      message: 'Please provide a valid http:// or https:// URL.',
    });
  }

  const record = scanStore.createScan(trimmedUrl, req.user ? req.user.userId : null);
  scanStore.updateScan(record.scanId, { status: 'in_progress' });

  try {
    const data = await websiteScanner.scanWebsite(trimmedUrl);
    const audit = runAudit(data);

    scanStore.updateScan(record.scanId, {
      status: 'complete',
      completedAt: new Date().toISOString(),
      result: data,
      audit,
    });

    return res.status(200).json({
      success: true,
      scanId: record.scanId,
      data,
      audit,
    });
  } catch (err) {
    const isScanError = err instanceof ScanError;
    const code = isScanError ? err.code : 'internal_error';
    const status = ERROR_STATUS_MAP[code] || 500;
    const message = isScanError ? err.message : 'Something went wrong while scanning this website.';

    // Never leak stack traces, internals, or resolved IPs to the client —
    // only log the raw error server-side.
    if (!isScanError) {
      console.error('Unexpected error in POST /api/audit/scan:', err);
    }

    scanStore.updateScan(record.scanId, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      error: message,
    });

    return res.status(status).json({
      success: false,
      scanId: record.scanId,
      error: code,
      message,
    });
  }
});

// POST /api/audit/analyze  { scanId: "..." }
router.post('/analyze', analyzeRateLimiter, async (req, res) => {
  const { scanId } = req.body || {};
  const trimmedScanId = typeof scanId === 'string' ? scanId.trim() : '';

  if (!SCAN_ID_PATTERN.test(trimmedScanId)) {
    return res.status(400).json({
      success: false,
      error: 'invalid_scan_id',
      message: 'Please provide a valid scanId.',
    });
  }

  const record = scanStore.getScan(trimmedScanId);
  if (!record) {
    return res.status(404).json({
      success: false,
      error: 'not_found',
      message: 'No scan found with that ID.',
    });
  }

  if (record.status !== 'complete' || !record.result || !record.audit) {
    return res.status(409).json({
      success: false,
      scanId: trimmedScanId,
      error: 'audit_not_ready',
      message:
        record.status === 'failed'
          ? 'This scan did not complete successfully, so it cannot be analyzed.'
          : 'This scan is still in progress. Please wait for it to complete before requesting AI analysis.',
    });
  }

  try {
    const analysis = await aiAnalyzer.generateRecommendations(record.result, record.audit);

    scanStore.updateScan(trimmedScanId, { analysis });

    return res.status(200).json({
      success: true,
      scanId: trimmedScanId,
      analysis,
    });
  } catch (err) {
    const isAiError = err instanceof AIError;
    const code = isAiError ? err.code : 'internal_error';
    const status = AI_ERROR_STATUS_MAP[code] || 500;
    const message = isAiError ? err.message : 'Something went wrong while generating AI recommendations.';

    // Never leak provider error bodies, stack traces, or the API key to the
    // client -- only log full detail server-side.
    if (!isAiError) {
      console.error('Unexpected error in POST /api/audit/analyze:', err);
    }

    return res.status(status).json({
      success: false,
      scanId: trimmedScanId,
      error: code,
      message,
    });
  }
});

// GET /api/audit/history?limit=20
// IMPORTANT: this must be declared before GET /:scanId below, or Express
// would match "/history" as if "history" were a scanId.
router.get('/history', (req, res) => {
  const rawLimit = Number(req.query.limit);
  const limit = Number.isFinite(rawLimit) ? rawLimit : undefined;

  // Logged-in visitors see their own saved history; anonymous visitors get
  // an empty list rather than everyone else's scans (their scans were never
  // tied to an account, so there's nothing "theirs" to show).
  const history = req.user ? scanStore.listRecentForUser(req.user.userId, limit) : [];

  return res.status(200).json({
    success: true,
    history,
  });
});

// GET /api/audit/:scanId
router.get('/:scanId', (req, res) => {
  const trimmedScanId = typeof req.params.scanId === 'string' ? req.params.scanId.trim() : '';

  if (!SCAN_ID_PATTERN.test(trimmedScanId)) {
    return res.status(400).json({
      success: false,
      error: 'invalid_scan_id',
      message: 'Please provide a valid scanId.',
    });
  }

  const record = scanStore.getScan(trimmedScanId);
  if (!record) {
    return res.status(404).json({
      success: false,
      error: 'not_found',
      message: 'No scan found with that ID.',
    });
  }

  return res.status(200).json({
    success: true,
    scanId: record.scanId,
    url: record.url,
    status: record.status,
    createdAt: record.createdAt,
    completedAt: record.completedAt,
    data: record.result,
    audit: record.audit,
    analysis: record.analysis,
    error: record.error,
  });
});

module.exports = router;
