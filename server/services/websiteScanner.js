/**
 * websiteScanner.js
 * ---------------------------------------------------------------------------
 * The website scanning service for SiteFix AI.
 *
 * scanWebsite(url) safely fetches a publicly accessible webpage and returns
 * a structured object describing its SEO, mobile, accessibility, content
 * and technical characteristics. No AI analysis happens here — this is
 * pure, deterministic extraction from the page's own HTML.
 *
 * Security posture (see ./scanner/urlSafety.js and ./scanner/httpClient.js
 * for the actual mechanics):
 *   - Only http:// and https:// URLs are accepted.
 *   - DNS is resolved and validated before connecting; localhost, loopback,
 *     private (RFC1918), link-local (incl. cloud metadata 169.254.169.254),
 *     and other reserved IP ranges are rejected — for the original URL AND
 *     every redirect hop.
 *   - The actual TCP connection is pinned to the validated IP, so DNS can't
 *     "change its mind" between the check and the request.
 *   - Every request has a hard timeout and a hard response-size cap.
 *   - The response body is only ever parsed as text/HTML via cheerio, which
 *     does not execute scripts or load subresources.
 *   - Errors thrown here are safe, user-facing messages — see
 *     ./scanner/errors.js. Anything unexpected should be caught and
 *     re-logged (not re-shown) by the caller.
 * ---------------------------------------------------------------------------
 */

const { URL } = require('url');
const { fetchSafely } = require('./scanner/httpClient');
const { analyzeHtml } = require('./scanner/htmlAnalyzer');
const { UnsupportedContentTypeError } = require('./scanner/errors');
const errors = require('./scanner/errors');

/**
 * The stages a full audit conceptually passes through. Shown in the
 * frontend's scan-progress UI (public/js/scan.js) — keep both in sync.
 * @type {ReadonlyArray<{ id: string, label: string }>}
 */
const SCAN_STAGES = Object.freeze([
  { id: 'connect', label: 'Connecting to website' },
  { id: 'structure', label: 'Analyzing page structure' },
  { id: 'seo', label: 'Checking SEO' },
  { id: 'performance', label: 'Checking performance' },
  { id: 'mobile', label: 'Checking mobile experience' },
  { id: 'accessibility', label: 'Checking accessibility' },
  { id: 'content', label: 'Analyzing content' },
  { id: 'conversion', label: 'Checking conversion elements' },
  { id: 'ai_recommendations', label: 'Preparing AI recommendations' },
]);

const FAVICON_CHECK_TIMEOUT_MS = 4000;

/**
 * @typedef {'critical' | 'warning' | 'passed'} FindingSeverity
 *
 * @typedef {Object} ScanResult
 * @property {string} url               The originally requested URL.
 * @property {string} finalUrl          URL after following redirects.
 * @property {string|null} title
 * @property {string|null} metaDescription
 * @property {Object} headings          { h1: {count, text[]}, h2: {count, text[]} }
 * @property {Object} images            { count, missingAlt: {count, samples[]} }
 * @property {Object} links             { total, internal: {...}, external: {...} }
 * @property {Array}  buttons           [{ type, text }]
 * @property {Array}  forms             [{ action, method, inputCount }]
 * @property {Object} seo               canonicalUrl, robotsMeta, openGraph, structuredData
 * @property {Object} mobile            viewport {present, content}
 * @property {Object} accessibility     imagesMissingAlt {count, percentage}
 * @property {Object} content           wordCount, ctaElements {count, samples[]}
 * @property {Object} contact           hasEmailLink, hasPhoneLink, emailLinks[], phoneLinks[]
 * @property {Object} technical         https, statusCode, redirected, contentType,
 *                                      faviconPresent, faviconUrl, scanDurationMs
 */

/**
 * Best-effort check for a favicon at /favicon.ico when none was declared in
 * markup. Uses the same safe-fetch path (SSRF protection, timeout, size cap)
 * as everything else, and never lets a failure here break the whole scan.
 *
 * @param {URL} pageUrlObj
 * @returns {Promise<{ present: boolean, url: string|null }>}
 */
async function checkFaviconFallback(pageUrlObj) {
  try {
    const faviconUrl = new URL('/favicon.ico', pageUrlObj);
    const response = await fetchSafely(faviconUrl, {
      method: 'GET',
      maxRedirects: 2,
      timeoutMs: FAVICON_CHECK_TIMEOUT_MS,
      maxBytes: 256 * 1024,
    });
    const ok = response.statusCode >= 200 && response.statusCode < 400;
    return { present: ok, url: ok ? faviconUrl.toString() : null };
  } catch (err) {
    return { present: false, url: null };
  }
}

/**
 * Scan a single publicly accessible URL and return structured page data.
 *
 * @param {string} rawUrl
 * @returns {Promise<ScanResult>}
 * @throws {import('./scanner/errors').ScanError} Safe, user-facing error.
 */
async function scanWebsite(rawUrl) {
  const startedAt = Date.now();

  // fetchSafely() runs validateUrlInput() + resolveAndPin() internally for
  // the initial request AND every redirect hop it follows.
  const response = await fetchSafely(rawUrl);

  const contentType = (response.headers['content-type'] || '').toLowerCase();
  const isHtml = contentType.includes('text/html') || contentType.includes('application/xhtml+xml');
  if (!isHtml) {
    throw new UnsupportedContentTypeError();
  }

  const finalUrlObj = new URL(response.finalUrl);
  const analysis = analyzeHtml(response.body, finalUrlObj);

  let faviconPresent = Boolean(analysis.faviconFromMarkup);
  let faviconUrl = analysis.faviconFromMarkup;
  if (!faviconPresent) {
    const fallback = await checkFaviconFallback(finalUrlObj);
    faviconPresent = fallback.present;
    faviconUrl = fallback.url;
  }

  return {
    url: rawUrl,
    finalUrl: response.finalUrl,
    title: analysis.title,
    metaDescription: analysis.metaDescription,
    headings: analysis.headings,
    images: analysis.images,
    links: analysis.links,
    buttons: analysis.buttons,
    forms: analysis.forms,
    seo: analysis.seo,
    mobile: analysis.mobile,
    accessibility: analysis.accessibility,
    content: analysis.content,
    contact: analysis.contact,
    technical: {
      https: finalUrlObj.protocol === 'https:',
      statusCode: response.statusCode,
      redirected: response.finalUrl !== rawUrl,
      contentType: response.headers['content-type'] || null,
      faviconPresent,
      faviconUrl,
      scanDurationMs: Date.now() - startedAt,
    },
  };
}

module.exports = {
  scanWebsite,
  SCAN_STAGES,
  errors,
};
