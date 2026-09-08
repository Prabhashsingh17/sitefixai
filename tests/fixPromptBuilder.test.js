const test = require('node:test');
const assert = require('node:assert/strict');
const { baseScan, perfectScan } = require('./fixtures');
const {
  FIX_TYPES,
  FIX_TYPE_LABELS,
  extractFixContext,
  resolveCurrentValue,
  buildFixPrompt,
} = require('../server/services/fix/promptBuilder');

test('FIX_TYPES contains exactly the 9 documented fix types', () => {
  assert.deepEqual(
    [...FIX_TYPES].sort(),
    [
      'title', 'meta_description', 'headline', 'cta', 'alt_text',
      'seo_content', 'faq_content', 'landing_copy', 'html_snippet',
    ].sort()
  );
});

test('every fix type has a human-readable label', () => {
  FIX_TYPES.forEach((type) => {
    assert.ok(typeof FIX_TYPE_LABELS[type] === 'string' && FIX_TYPE_LABELS[type].length > 0, `missing label for ${type}`);
  });
});

test('extractFixContext pulls only real, present page-identity fields', () => {
  const scan = perfectScan();
  const context = extractFixContext(scan);
  assert.equal(context.url, scan.url);
  assert.equal(context.pageTitle, scan.title);
  assert.equal(context.metaDescription, scan.metaDescription);
  assert.equal(context.h1, scan.headings.h1.text[0]);
});

test('extractFixContext handles a scan with no title/H1 gracefully (nulls, not crashes)', () => {
  const scan = baseScan({});
  const context = extractFixContext(scan);
  assert.equal(context.pageTitle, null);
  assert.equal(context.h1, null);
  assert.deepEqual(context.h2Samples, []);
});

// =============================================================================
// resolveCurrentValue -- server-authoritative, per fix type
// =============================================================================
test('resolveCurrentValue returns the real title for fixType "title"', () => {
  const scan = perfectScan();
  assert.equal(resolveCurrentValue(scan, 'title', null), scan.title);
});

test('resolveCurrentValue returns the real meta description for fixType "meta_description"', () => {
  const scan = perfectScan();
  assert.equal(resolveCurrentValue(scan, 'meta_description', null), scan.metaDescription);
});

test('resolveCurrentValue returns the real H1 text for fixType "headline"', () => {
  const scan = perfectScan();
  assert.equal(resolveCurrentValue(scan, 'headline', null), scan.headings.h1.text[0]);
});

test('resolveCurrentValue returns the first real CTA sample for fixType "cta"', () => {
  const scan = perfectScan();
  assert.equal(resolveCurrentValue(scan, 'cta', null), scan.content.ctaElements.samples[0]);
});

test('resolveCurrentValue prefers a validated imageSrc for fixType "alt_text", falling back to the first sample', () => {
  const scan = baseScan({
    images: { count: 2, missingAlt: { count: 2, samples: ['/a.jpg', '/b.jpg'] } },
  });
  assert.equal(resolveCurrentValue(scan, 'alt_text', '/b.jpg'), '/b.jpg');
  assert.equal(resolveCurrentValue(scan, 'alt_text', null), '/a.jpg');
});

test('resolveCurrentValue returns empty string for missing data rather than null/undefined', () => {
  const scan = baseScan({});
  assert.equal(resolveCurrentValue(scan, 'title', null), '');
  assert.equal(resolveCurrentValue(scan, 'cta', null), '');
});

test('resolveCurrentValue returns empty string for fix types with no single current field (seo_content, faq_content, landing_copy, html_snippet)', () => {
  const scan = perfectScan();
  ['seo_content', 'faq_content', 'landing_copy', 'html_snippet'].forEach((type) => {
    assert.equal(resolveCurrentValue(scan, type, null), '');
  });
});

// =============================================================================
// buildFixPrompt
// =============================================================================
test('buildFixPrompt embeds the fix type, context, finding, and current value', () => {
  const scan = perfectScan();
  const context = extractFixContext(scan);
  const finding = {
    category: 'seo', severity: 'critical', title: 'Missing page title',
    description: 'No title tag found.', evidence: 'No <title> element detected.',
    recommendation: 'Add a title tag.',
  };
  const { system, user } = buildFixPrompt({ fixType: 'title', context, finding, currentValue: '' });

  assert.ok(system.toLowerCase().includes('must not invent'));
  assert.ok(system.toLowerCase().includes('never guarantee'));
  assert.ok(user.includes('FIX TYPE: title'));
  assert.ok(user.includes(JSON.stringify(context.url)));
  assert.ok(user.includes('Missing page title'));
  assert.ok(user.toLowerCase().includes('do not wrap it in'));
});

test('buildFixPrompt does not leak recommendation/severity-unrelated stored fields the AI does not need', () => {
  // The finding's own "recommendation" field (our deterministic advice) is
  // intentionally excluded from what's sent -- the AI should generate its
  // own reasoning, not just parrot ours.
  const scan = perfectScan();
  const context = extractFixContext(scan);
  const finding = {
    category: 'seo', severity: 'warning', title: 'Some title',
    description: 'desc', evidence: 'evidence',
    recommendation: 'UNIQUE_MARKER_SHOULD_NOT_APPEAR',
  };
  const { user } = buildFixPrompt({ fixType: 'title', context, finding, currentValue: '' });
  assert.ok(!user.includes('UNIQUE_MARKER_SHOULD_NOT_APPEAR'));
});
