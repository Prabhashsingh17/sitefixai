/**
 * adminRoutes.js
 * ---------------------------------------------------------------------------
 * GET /api/admin/key-status
 *
 * Read-only diagnostic: reports whether the server's configured Anthropic
 * API key (ANTHROPIC_API_KEY_ID) is active, via the Anthropic Admin API.
 * Useful for confirming the AI features are backed by a live, working key
 * without pasting secrets into a terminal.
 *
 * Requires ANTHROPIC_ADMIN_KEY and ANTHROPIC_API_KEY_ID to be configured
 * (see .env.example) -- this is a separate credential from ANTHROPIC_API_KEY
 * and is never sent to, or readable by, the browser.
 *
 * Response (success):
 *   { "success": true, "keyStatus": { id, name, status, workspaceId, createdAt } }
 *
 * Response (failure):
 *   { "success": false, "error": "<code>", "message": "<safe message>" }
 * ---------------------------------------------------------------------------
 */

const express = require('express');
const router = express.Router();
const adminClient = require('../services/admin/adminClient');
const { AdminError } = require('../services/admin/errors');
const { createRateLimiter } = require('../middleware/rateLimit');

// A diagnostic endpoint, not an expensive one -- but still capped so it
// can't be hammered as a way to probe the Admin API via this server.
const keyStatusRateLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,
  max: 30,
  message: 'Too many key status requests. Please wait a few minutes and try again.',
});

const ERROR_STATUS_MAP = {
  admin_not_configured: 503,
  admin_key_not_found: 404,
  admin_request_failed: 502,
  admin_timeout: 504,
  admin_invalid_response: 502,
};

// GET /api/admin/key-status
router.get('/key-status', keyStatusRateLimiter, async (req, res) => {
  try {
    const keyStatus = await adminClient.getApiKeyStatus();
    return res.status(200).json({ success: true, keyStatus });
  } catch (err) {
    const isAdminError = err instanceof AdminError;
    const code = isAdminError ? err.code : 'internal_error';
    const status = ERROR_STATUS_MAP[code] || 500;
    const message = isAdminError ? err.message : 'Something went wrong while checking the API key status.';

    if (!isAdminError) {
      console.error('Unexpected error in GET /api/admin/key-status:', err);
    }

    return res.status(status).json({ success: false, error: code, message });
  }
});

module.exports = router;
