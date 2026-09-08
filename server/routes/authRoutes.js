/**
 * authRoutes.js
 * ---------------------------------------------------------------------------
 * POST /api/auth/signup   { email, password } -> creates an account, logs in
 * POST /api/auth/login    { email, password } -> starts a session
 * POST /api/auth/logout   -> ends the current session (idempotent)
 * GET  /api/auth/me       -> { user: {...} | null }, never errors
 *
 * Response shapes match every other route file's convention:
 *   success: { success: true, ... }
 *   failure: { success: false, error: '<code>', message: '<safe message>' }
 * ---------------------------------------------------------------------------
 */

const express = require('express');
const router = express.Router();
const authService = require('../services/authService');
const { AuthError } = authService.errors;
const { setSessionCookie, clearSessionCookie, getSessionTokenFromRequest } = require('../middleware/session');
const { createRateLimiter } = require('../middleware/rateLimit');

// Brute-force/spam protection on the two credential-checking endpoints.
const signupRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many signup attempts. Please wait a few minutes and try again.',
});
const loginRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many login attempts. Please wait a few minutes and try again.',
});

const ERROR_STATUS_MAP = {
  invalid_input: 400,
  weak_password: 400,
  email_taken: 409,
  invalid_credentials: 401,
  session_invalid: 401,
};

function handleAuthError(err, res) {
  const isAuthError = err instanceof AuthError;
  const code = isAuthError ? err.code : 'internal_error';
  const status = ERROR_STATUS_MAP[code] || 500;
  const message = isAuthError ? err.message : 'Something went wrong. Please try again.';

  if (!isAuthError) {
    console.error('Unexpected error in auth route:', err);
  }

  return res.status(status).json({ success: false, error: code, message });
}

// POST /api/auth/signup
router.post('/signup', signupRateLimiter, async (req, res) => {
  const { email, password } = req.body || {};

  try {
    const { user, sessionToken } = await authService.signup({ email, password });
    setSessionCookie(res, sessionToken);
    return res.status(200).json({ success: true, user });
  } catch (err) {
    return handleAuthError(err, res);
  }
});

// POST /api/auth/login
router.post('/login', loginRateLimiter, async (req, res) => {
  const { email, password } = req.body || {};

  try {
    const { user, sessionToken } = await authService.login({ email, password });
    setSessionCookie(res, sessionToken);
    return res.status(200).json({ success: true, user });
  } catch (err) {
    return handleAuthError(err, res);
  }
});

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  const token = getSessionTokenFromRequest(req);
  try {
    await authService.logout(token);
  } catch (err) {
    console.error('Unexpected error during logout:', err);
    // Still clear the cookie client-side even if the DB delete failed --
    // the user asked to log out, and the client shouldn't stay "stuck" logged in.
  }
  clearSessionCookie(res);
  return res.status(200).json({ success: true });
});

// GET /api/auth/me -- a status check, not a protected resource; always 200.
router.get('/me', (req, res) => {
  return res.status(200).json({ success: true, user: req.user || null });
});

module.exports = router;
