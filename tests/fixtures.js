/**
 * fixtures.js
 * ---------------------------------------------------------------------------
 * Test helper: builds a mock websiteScanner-shaped scan result, with sane
 * "worst case" defaults (no title, no meta description, no images, etc.)
 * that individual tests can override piece by piece. This mirrors the real
 * shape returned by server/services/websiteScanner.js exactly, so tests
 * exercise the audit engine the same way the real API does.
 * ---------------------------------------------------------------------------
 */

function baseScan(overrides = {}) {
  const defaults = {
    url: 'https://example.com/',
    finalUrl: 'https://example.com/',
    title: null,
    metaDescription: null,
    headings: { h1: { count: 0, text: [] }, h2: { count: 0, text: [] } },
    images: { count: 0, missingAlt: { count: 0, samples: [] } },
    links: { total: 0, internal: { count: 0, samples: [] }, external: { count: 0, samples: [] } },
    buttons: [],
    forms: [],
    seo: {
      canonicalUrl: null,
      robotsMeta: null,
      openGraph: {},
      structuredData: { present: false, types: [] },
    },
    mobile: { viewport: { present: false, content: null } },
    accessibility: { imagesMissingAlt: { count: 0, percentage: 0 } },
    content: { wordCount: 0, ctaElements: { count: 0, samples: [] } },
    contact: { hasEmailLink: false, hasPhoneLink: false, emailLinks: [], phoneLinks: [] },
    technical: {
      https: false,
      statusCode: 200,
      redirected: false,
      contentType: 'text/html; charset=utf-8',
      faviconPresent: false,
      faviconUrl: null,
      scanDurationMs: 500,
    },
  };

  // Shallow-merge top level, but allow overrides to deep-merge one level in
  // for the nested objects tests care about most.
  return {
    ...defaults,
    ...overrides,
    headings: { ...defaults.headings, ...(overrides.headings || {}) },
    images: { ...defaults.images, ...(overrides.images || {}) },
    links: { ...defaults.links, ...(overrides.links || {}) },
    seo: { ...defaults.seo, ...(overrides.seo || {}) },
    mobile: { ...defaults.mobile, ...(overrides.mobile || {}) },
    accessibility: { ...defaults.accessibility, ...(overrides.accessibility || {}) },
    content: { ...defaults.content, ...(overrides.content || {}) },
    contact: { ...defaults.contact, ...(overrides.contact || {}) },
    technical: { ...defaults.technical, ...(overrides.technical || {}) },
  };
}

/** A scan representing a well-optimized page — should score at or near 100. */
function perfectScan(overrides = {}) {
  return baseScan({
    title: 'Best Widgets Online | Fast Shipping & Great Prices',
    metaDescription:
      'Shop the best widgets online with fast shipping, competitive prices, and a 30-day money-back guarantee.',
    headings: {
      h1: { count: 1, text: ['Best Widgets Online'] },
      h2: { count: 4, text: ['Why choose us', 'Popular products', 'Customer reviews', 'FAQ'] },
    },
    images: { count: 10, missingAlt: { count: 0, samples: [] } },
    links: { total: 20, internal: { count: 15, samples: [] }, external: { count: 5, samples: [] } },
    forms: [{ action: 'https://example.com/contact', method: 'post', inputCount: 3, unlabeledInputCount: 0, labelableInputCount: 3 }],
    seo: {
      canonicalUrl: 'https://example.com/',
      robotsMeta: 'index, follow',
      openGraph: { title: 'Best Widgets Online', description: 'Shop the best widgets', image: '/og.png' },
      structuredData: { present: true, types: ['Product'] },
    },
    mobile: { viewport: { present: true, content: 'width=device-width, initial-scale=1' } },
    accessibility: { imagesMissingAlt: { count: 0, percentage: 0 } },
    content: { wordCount: 650, ctaElements: { count: 3, samples: ['Buy Now', 'Contact Us', 'Get a Quote'] } },
    contact: { hasEmailLink: true, hasPhoneLink: true, emailLinks: ['sales@example.com'], phoneLinks: ['+15551234567'] },
    technical: {
      https: true,
      statusCode: 200,
      redirected: false,
      contentType: 'text/html; charset=utf-8',
      faviconPresent: true,
      faviconUrl: 'https://example.com/favicon.ico',
      scanDurationMs: 320,
    },
    ...overrides,
  });
}

module.exports = { baseScan, perfectScan };
