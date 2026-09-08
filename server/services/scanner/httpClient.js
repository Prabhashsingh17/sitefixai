/**
 * httpClient.js
 * ---------------------------------------------------------------------------
 * Low-level, security-conscious HTTP(S) fetching for the scanner.
 *
 * - DNS is resolved and validated ourselves (urlSafety.resolveAndPin), then
 *   the actual TCP connection is pinned to that exact address via a custom
 *   `lookup` option — the OS resolver is never consulted again for this
 *   request, which closes the gap where a hostname could resolve to a safe
 *   IP during validation and an unsafe one at connect time.
 * - Redirects are followed manually (never automatically) so every hop is
 *   re-validated against the same SSRF rules as the original URL.
 * - Every request has a hard timeout and a hard response-size cap; a
 *   response that exceeds the cap is aborted mid-stream, not truncated and
 *   silently accepted.
 * - Nothing here executes any script found in a response — this only ever
 *   reads raw bytes over the wire and hands back a string.
 * ---------------------------------------------------------------------------
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const { validateUrlInput, resolveAndPin } = require('./urlSafety');
const {
  ScanTimeoutError,
  ResponseTooLargeError,
  FetchFailedError,
  TooManyRedirectsError,
} = require('./errors');

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_MAX_RESPONSE_BYTES = 3 * 1024 * 1024; // 3 MB
const USER_AGENT = 'SiteFixAI-Scanner/1.0 (+website audit bot)';
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

/**
 * Builds a `lookup` function for http(s).request that always resolves to a
 * single pre-validated address, regardless of which calling convention
 * Node's client uses.
 *
 * Node's HTTP client calls this differently depending on internal version/
 * settings: sometimes `callback(err, address, family)`, and — when Node's
 * Happy Eyeballs (dual-stack) logic is active — `options.all` is true and
 * it instead expects `callback(err, [{ address, family }])`. Both shapes
 * are handled here so the pin holds either way.
 */
function pinnedLookup(address, family) {
  return (_hostname, options, callback) => {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    if (options && options.all) {
      callback(null, [{ address, family }]);
    } else {
      callback(null, address, family);
    }
  };
}

function singleRequest(urlObj, { address, family }, { method, timeoutMs, maxBytes }) {
  return new Promise((resolve, reject) => {
    const isHttps = urlObj.protocol === 'https:';
    const lib = isHttps ? https : http;

    const options = {
      method,
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
      },
      lookup: pinnedLookup(address, family),
      timeout: timeoutMs,
    };
    if (isHttps) options.servername = urlObj.hostname;

    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardDeadline);
      fn(value);
    };

    // The `timeout` option above only fires on INACTIVITY -- Node resets it
    // on every byte received, so a server that trickles a byte every few
    // seconds forever never trips it, keeping the connection open well past
    // the intended timeout. This separate, unconditional timer is the real
    // deadline: it fires timeoutMs after the request started no matter what
    // the server does in response.
    const hardDeadline = setTimeout(() => {
      req.destroy();
      finish(reject, new ScanTimeoutError());
    }, timeoutMs);

    const req = lib.request(options, (res) => {
      let received = 0;
      const chunks = [];

      res.on('data', (chunk) => {
        if (settled) return;
        received += chunk.length;
        if (received > maxBytes) {
          res.destroy();
          req.destroy();
          finish(reject, new ResponseTooLargeError());
          return;
        }
        chunks.push(chunk);
      });

      res.on('end', () => {
        finish(resolve, {
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });

      res.on('error', () => {
        finish(reject, new FetchFailedError('The connection to this website was interrupted.'));
      });
    });

    req.on('timeout', () => {
      req.destroy();
      finish(reject, new ScanTimeoutError());
    });

    req.on('error', () => {
      finish(reject, new FetchFailedError());
    });

    req.end();
  });
}

/**
 * Safely fetch a URL: validates it, resolves + pins DNS, follows redirects
 * (re-validating each hop), enforces a timeout and response size cap.
 *
 * The timeout applies to the ENTIRE call, not each hop individually: without
 * an overall budget, a malicious redirect chain (each hop stalling just
 * under the per-hop timeout) could take timeoutMs * (maxRedirects + 1) in
 * the worst case -- up to a minute with the defaults -- despite the
 * documented timeout being 10 seconds. Each hop gets whatever of the
 * overall budget remains, capped at timeoutMs.
 *
 * @param {string|URL} target
 * @param {Object} [opts]
 * @param {string} [opts.method='GET']
 * @param {number} [opts.maxRedirects=5]
 * @param {number} [opts.timeoutMs=10000] Per-hop timeout AND the basis for the overall budget (2x this).
 * @param {number} [opts.maxBytes=3145728] Response size cap in bytes.
 * @returns {Promise<{ statusCode: number, headers: object, body: string, finalUrl: string }>}
 */
async function fetchSafely(target, opts = {}) {
  const method = opts.method || 'GET';
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_RESPONSE_BYTES;

  // Overall wall-clock budget across every redirect hop combined.
  const overallDeadline = Date.now() + timeoutMs * 2;

  let currentUrl = target instanceof URL ? target : validateUrlInput(String(target));
  let redirectsLeft = maxRedirects;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const remainingMs = overallDeadline - Date.now();
    if (remainingMs <= 0) {
      throw new ScanTimeoutError();
    }

    // Re-validate on every hop (covers redirects to a different host/scheme).
    currentUrl = validateUrlInput(currentUrl.toString());
    const pin = await resolveAndPin(currentUrl.hostname);

    const hopTimeoutMs = Math.min(timeoutMs, remainingMs);
    const response = await singleRequest(currentUrl, pin, { method, timeoutMs: hopTimeoutMs, maxBytes });

    if (REDIRECT_STATUS_CODES.has(response.statusCode) && response.headers.location) {
      if (redirectsLeft <= 0) {
        throw new TooManyRedirectsError();
      }
      redirectsLeft -= 1;
      currentUrl = new URL(response.headers.location, currentUrl);
      continue;
    }

    return { ...response, finalUrl: currentUrl.toString() };
  }
}

module.exports = { fetchSafely };
