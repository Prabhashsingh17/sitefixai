/**
 * session.js
 * ---------------------------------------------------------------------------
 * Populates req.user from the session cookie on every request. This is
 * fail-open by design: a missing, invalid, or expired session just means
 * req.user is null (an anonymous visitor), exactly like not sending the
 * cookie at all -- it never blocks or errors the request. Anonymous
 * scanning must keep working regardless of auth state, so nothing here is
 * allowed to short-circuit the request pipeline.
 *
 * Also exports the cookie set/clear helpers used by server/routes/
 * authRoutes.js, so the cookie name/attributes only ever live in one place.
 * ---------------------------------------------------------------------------
 */

const cookie = require('cookie');
const authService = require('../services/authService');

const COOKIE_NAME = 'sfx_session';
const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days, matches authService's SESSION_TTL_MS

function baseCookieOptions() {
  return {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    // Secure requires HTTPS -- must stay off for local http://localhost dev,
    // or the browser silently refuses to send the cookie back at all.
    secure: process.env.NODE_ENV === 'production',
  };
}

function setSessionCookie(res, sessionToken) {
  res.setHeader(
    'Set-Cookie',
    cookie.serialize(COOKIE_NAME, sessionToken, { ...baseCookieOptions(), maxAge: COOKIE_MAX_AGE_SECONDS })
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', cookie.serialize(COOKIE_NAME, '', { ...baseCookieOptions(), maxAge: 0 }));
}

function getSessionTokenFromRequest(req) {
  const header = req.headers.cookie;
  if (!header) return null;
  const parsed = cookie.parse(header);
  return parsed[COOKIE_NAME] || null;
}

/** Express middleware -- always calls next(), never throws. */
async function sessionMiddleware(req, res, next) {
  const token = getSessionTokenFromRequest(req);
  if (!token) {
    req.user = null;
    return next();
  }

  try {
    req.user = await authService.getUserForSession(token);
  } catch (err) {
    // A DB hiccup here must not take down every request on the site --
    // treat it the same as "no session" rather than failing closed.
    console.error('Session lookup failed:', err);
    req.user = null;
  }

  return next();
}

module.exports = { sessionMiddleware, setSessionCookie, clearSessionCookie, getSessionTokenFromRequest, COOKIE_NAME };
