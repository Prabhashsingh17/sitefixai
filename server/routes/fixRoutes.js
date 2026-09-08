/**
 * fixRoutes.js
 * ---------------------------------------------------------------------------
 * POST /api/fix/generate
 *
 * Generates a single AI-suggested content fix for one finding from a
 * completed scan. Never modifies the customer's live website -- this only
 * ever returns a suggestion for the user to copy/apply themselves.
 *
 * Request:
 *   {
 *     "scanId": "...",
 *     "fixType": "title | meta_description | headline | cta | alt_text |
 *                 seo_content | faq_content | landing_copy | html_snippet",
 *     "finding": { category, severity, title, description, evidence, recommendation },
 *     "imageSrc": "..."   // optional, only used for fixType "alt_text"
 *   }
 *
 * Response (success):
 *   { "success": true, "scanId": "...", "fix": { ...FixResult } }
 *
 * Response (failure):
 *   { "success": false, "scanId": "...", "error": "<code>", "message": "<safe message>" }
 *
 * Trust boundary: the client's "finding" and "imageSrc" are NEVER passed to
 * the AI as-is. Both are checked against the scan's own stored, real data
 * first -- a finding that doesn't exactly match one of the scan's actual
 * audit findings, or an imageSrc that isn't one of its actual detected
 * missing-alt images, is rejected before any AI call is made. This closes
 * the gap where a client could otherwise submit fabricated "detected data"
 * for the AI to reason from.
 * ---------------------------------------------------------------------------
 */

const express = require('express');
const router = express.Router();
const scanStore = require('../services/scanStore');
const fixGenerator = require('../services/fixGenerator');
const { createRateLimiter } = require('../middleware/rateLimit');

const { AIError, FixInputError } = fixGenerator.errors;

// This endpoint calls the real, billed Claude API for every request.
const fixRateLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,
  max: 30,
  message: 'Too many fix requests. Please wait a few minutes and try again.',
});

// A scanId is always a crypto.randomUUID() value (see scanStore.js).
const SCAN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FINDING_FIELDS = ['category', 'severity', 'title', 'description', 'evidence', 'recommendation'];

const ERROR_STATUS_MAP = {
  invalid_scan_id: 400,
  invalid_fix_type: 400,
  invalid_fix_request: 400,
  finding_mismatch: 400,
  not_found: 404,
  audit_not_ready: 409,
  ai_not_configured: 503,
  ai_request_failed: 502,
  ai_timeout: 504,
  ai_invalid_response: 502,
};

/**
 * Returns the matching stored finding if `submitted` exactly matches one of
 * `storedFindings` on every field, or null otherwise.
 */
function findMatchingFinding(submitted, storedFindings) {
  if (!submitted || typeof submitted !== 'object' || !Array.isArray(storedFindings)) return null;
  return (
    storedFindings.find((stored) => FINDING_FIELDS.every((field) => stored[field] === submitted[field])) || null
  );
}

// POST /api/fix/generate
router.post('/generate', fixRateLimiter, async (req, res) => {
  const { scanId, fixType, finding, imageSrc } = req.body || {};
  const trimmedScanId = typeof scanId === 'string' ? scanId.trim() : '';

  if (!SCAN_ID_PATTERN.test(trimmedScanId)) {
    return res.status(400).json({
      success: false,
      error: 'invalid_scan_id',
      message: 'Please provide a valid scanId.',
    });
  }

  if (typeof fixType !== 'string' || !fixGenerator.FIX_TYPES.includes(fixType)) {
    return res.status(400).json({
      success: false,
      scanId: trimmedScanId,
      error: 'invalid_fix_type',
      message: 'Please provide a supported fix type.',
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
          ? 'This scan did not complete successfully, so no fixes can be generated for it.'
          : 'This scan is still in progress. Please wait for it to complete first.',
    });
  }

  const matchedFinding = findMatchingFinding(finding, record.audit.findings);
  if (!matchedFinding) {
    return res.status(400).json({
      success: false,
      scanId: trimmedScanId,
      error: 'finding_mismatch',
      message: 'This finding does not match the stored audit results for this scan.',
    });
  }

  // For alt_text, only accept an imageSrc that's actually one of this
  // scan's real detected missing-alt images -- never trust it blindly.
  let validatedImageSrc = null;
  if (fixType === 'alt_text' && typeof imageSrc === 'string') {
    const realSamples = record.result.images?.missingAlt?.samples || [];
    if (realSamples.includes(imageSrc)) {
      validatedImageSrc = imageSrc;
    }
  }

  try {
    const fix = await fixGenerator.generateFix({
      scanResult: record.result,
      finding: matchedFinding,
      fixType,
      imageSrc: validatedImageSrc,
    });

    return res.status(200).json({
      success: true,
      scanId: trimmedScanId,
      fix,
    });
  } catch (err) {
    const isKnownError = err instanceof AIError || err instanceof FixInputError;
    const code = isKnownError ? err.code : 'internal_error';
    const status = ERROR_STATUS_MAP[code] || 500;
    const message = isKnownError ? err.message : 'Something went wrong while generating this fix.';

    if (!isKnownError) {
      console.error('Unexpected error in POST /api/fix/generate:', err);
    }

    return res.status(status).json({
      success: false,
      scanId: trimmedScanId,
      error: code,
      message,
    });
  }
});

module.exports = router;
