/**
 * rateLimit.js
 * ---------------------------------------------------------------------------
 * Minimal, dependency-free rate limiting for the endpoints that trigger
 * real work: outbound SSRF-guarded network scans and paid Claude API calls.
 * Without this, any client could call these endpoints as fast as the
 * network allows, running up API costs and/or using this server as a
 * platform for scanning arbitrary third-party sites at volume.
 *
 * This is a fixed-window counter per client IP, held in memory. It is
 * intentionally simple:
 *   - Good enough for a single-process MVP; if this app is ever run behind
 *     a load balancer with multiple instances, replace with a shared store
 *     (Redis, etc.) -- the limits chosen here are generous enough that no
 *     normal, legitimate single-user session should ever hit them.
 *   - Resets are lazy (checked on request), with an interval sweep to
 *     evict stale entries so memory doesn't grow unbounded from a long
 *     tail of one-off IPs.
 * ---------------------------------------------------------------------------
 */

const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * @param {object} opts
 * @param {number} opts.windowMs Window size in milliseconds.
 * @param {number} opts.max Max requests allowed per window per client.
 * @param {string} opts.message Safe, user-facing message for a 429 response.
 */
function createRateLimiter({ windowMs, max, message }) {
  /** @type {Map<string, { count: number, resetAt: number }>} */
  const hits = new Map();

  const sweepHandle = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits.entries()) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, SWEEP_INTERVAL_MS);
  // Don't let this background sweep keep the process alive by itself
  // (relevant for tests / short-lived scripts that require this module).
  if (typeof sweepHandle.unref === 'function') sweepHandle.unref();

  return function rateLimit(req, res, next) {
    const key = req.ip || req.connection?.remoteAddress || 'unknown';
    const now = Date.now();

    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }

    entry.count += 1;

    if (entry.count > max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.set('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({
        success: false,
        error: 'rate_limited',
        message: message || 'Too many requests. Please try again shortly.',
      });
    }

    return next();
  };
}

module.exports = { createRateLimiter };

// Shared singleton: POST /api/scan (scanRoutes.js) and POST /api/audit/scan
// (auditRoutes.js) both trigger the exact same expensive operation (a real,
// SSRF-guarded outbound scan of a third-party site). If each route created
// its own limiter instance, a client could get `max` requests through EACH
// endpoint independently -- e.g. 20 + 20 = 40 real scans per window instead
// of the intended 20 -- since the limit is meant to cap that underlying
// work, not each URL path separately. Both route files import this same
// instance so the budget is actually shared.
module.exports.scanRateLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,
  max: 20,
  message: 'Too many scan requests. Please wait a few minutes and try again.',
});
