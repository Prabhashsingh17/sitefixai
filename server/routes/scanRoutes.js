/**
 * scanRoutes.js
 * ---------------------------------------------------------------------------
 * Real backend routes for scans (async/polling flow used by scan.html).
 *
 * POST /api/scan
 *   Validates the URL, creates a real scan record (scanStore), and kicks off
 *   the real scanner (websiteScanner.scanWebsite) in the background. Returns
 *   a real scanId immediately so the frontend can move to the progress
 *   screen without waiting for the scan to finish.
 *
 * GET /api/scan/:scanId
 *   Returns the current status of a scan record — 'pending' | 'in_progress'
 *   | 'complete' | 'failed', plus the real result or a safe error message.
 *   Never a fabricated result.
 * ---------------------------------------------------------------------------
 */

const express = require('express');
const router = express.Router();
const scanStore = require('../services/scanStore');
const websiteScanner = require('../services/websiteScanner');
const { runAudit } = require('../services/auditEngine');
const { scanRateLimiter } = require('../middleware/rateLimit');

const { ScanError } = websiteScanner.errors;

const URL_PATTERN = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;

// POST /api/scan  { url: "https://example.com" }
router.post('/scan', scanRateLimiter, (req, res) => {
  const { url } = req.body || {};
  const trimmedUrl = typeof url === 'string' ? url.trim() : '';

  if (!URL_PATTERN.test(trimmedUrl)) {
    return res.status(400).json({
      error: 'invalid_url',
      message: 'Please provide a valid http:// or https:// URL.',
    });
  }

  const record = scanStore.createScan(trimmedUrl);

  // Fire off the scan. This does not block the response — the frontend
  // polls GET /api/scan/:scanId (or just shows its own progress UI) rather
  // than waiting on this request to resolve.
  scanStore.updateScan(record.scanId, { status: 'in_progress' });

  websiteScanner
    .scanWebsite(trimmedUrl)
    .then((result) => {
      const audit = runAudit(result);
      scanStore.updateScan(record.scanId, {
        status: 'complete',
        completedAt: new Date().toISOString(),
        result,
        audit,
      });
    })
    .catch((err) => {
      // ScanError messages are already written to be safe to show; anything
      // else is an unexpected bug and must not leak to the client.
      const safeMessage =
        err instanceof ScanError ? err.message : 'Something went wrong while scanning this website.';
      if (!(err instanceof ScanError)) {
        console.error('Unexpected error during background scan:', err);
      }
      scanStore.updateScan(record.scanId, {
        status: 'failed',
        completedAt: new Date().toISOString(),
        error: safeMessage,
      });
    });

  return res.status(202).json({
    scanId: record.scanId,
    status: 'in_progress',
    stages: websiteScanner.SCAN_STAGES,
  });
});

// A scanId is always a crypto.randomUUID() value (see scanStore.js).
const SCAN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/scan/:scanId
router.get('/scan/:scanId', (req, res) => {
  const trimmedScanId = typeof req.params.scanId === 'string' ? req.params.scanId.trim() : '';

  if (!SCAN_ID_PATTERN.test(trimmedScanId)) {
    return res.status(400).json({
      error: 'invalid_scan_id',
      message: 'Please provide a valid scanId.',
    });
  }

  const record = scanStore.getScan(trimmedScanId);

  if (!record) {
    return res.status(404).json({
      error: 'not_found',
      message: 'No scan found with that ID.',
    });
  }

  return res.json(record);
});

module.exports = router;
