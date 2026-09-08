const test = require('node:test');
const assert = require('node:assert/strict');
const { baseScan, perfectScan } = require('./fixtures');
const { runAudit } = require('../server/services/auditEngine');
const { extractFacts, buildPrompt, truncate, VALID_CATEGORIES } = require('../server/services/ai/promptBuilder');

test('truncate leaves short strings untouched and caps long ones with an ellipsis', () => {
  assert.equal(truncate('short', 20), 'short');
  const long = 'x'.repeat(300);
  const result = truncate(long, 200);
  assert.equal(result.length, 201); // 200 chars + ellipsis char
  assert.ok(result.endsWith('…'));
});

test('truncate passes through non-strings untouched (e.g. null)', () => {
  assert.equal(truncate(null), null);
  assert.equal(truncate(undefined), undefined);
});

test('extractFacts pulls only real, present scan data -- never invents fields', () => {
  const scan = perfectScan();
  const audit = runAudit(scan);
  const facts = extractFacts(scan, audit);

  assert.equal(facts.url, scan.url);
  assert.equal(facts.title, scan.title);
  assert.equal(facts.titleLength, scan.title.length);
  assert.equal(facts.https, true);
  assert.equal(facts.overallScore, audit.overallScore);
  assert.deepEqual(facts.categoryScores, audit.categoryScores);
});

test('extractFacts excludes "good" findings (only non-passing findings are sent to the AI)', () => {
  const scan = perfectScan(); // scores 100 across the board -> all findings are "good"
  const audit = runAudit(scan);
  const facts = extractFacts(scan, audit);
  assert.equal(facts.findings.length, 0);
  assert.ok(audit.findings.length > 0, 'sanity check: the audit itself has findings');
});

test('extractFacts includes non-passing findings with category/severity/title/evidence only', () => {
  const scan = baseScan({}); // worst case -- lots of critical/warning findings
  const audit = runAudit(scan);
  const facts = extractFacts(scan, audit);

  assert.ok(facts.findings.length > 0);
  facts.findings.forEach((f) => {
    assert.deepEqual(Object.keys(f).sort(), ['category', 'evidence', 'severity', 'title']);
    assert.notEqual(f.severity, 'good');
  });
});

test('extractFacts truncates long title/meta description/evidence strings', () => {
  const scan = baseScan({
    title: 'x'.repeat(500),
    metaDescription: 'y'.repeat(500),
  });
  const audit = runAudit(scan);
  const facts = extractFacts(scan, audit);
  assert.ok(facts.title.length <= 201);
  assert.ok(facts.metaDescription.length <= 201);
});

test('extractFacts caps CTA samples and heading text arrays to small numbers', () => {
  const scan = baseScan({
    content: {
      wordCount: 500,
      ctaElements: { count: 20, samples: Array.from({ length: 20 }, (_, i) => `CTA ${i}`) },
    },
    headings: {
      h1: { count: 1, text: ['One', 'Two', 'Three'] }, // audit only reads count, but test extraction too
      h2: { count: 0, text: [] },
    },
  });
  const audit = runAudit(scan);
  const facts = extractFacts(scan, audit);
  assert.ok(facts.ctaSamples.length <= 5);
  assert.ok(facts.h1Text.length <= 2);
});

test('buildPrompt embeds the facts as JSON and includes the required schema/rules instructions', () => {
  const scan = perfectScan();
  const audit = runAudit(scan);
  const facts = extractFacts(scan, audit);
  const { system, user } = buildPrompt(facts);

  assert.ok(system.toLowerCase().includes('must not invent'));
  assert.ok(system.toLowerCase().includes('never guarantee'));
  assert.ok(user.includes(JSON.stringify(facts.url)));
  assert.ok(user.includes('"recommendations"'));
  assert.ok(user.toLowerCase().includes('guarantee'));
  assert.ok(user.toLowerCase().includes('do not wrap it in'));
});

test('VALID_CATEGORIES matches the 7 audit categories exactly', () => {
  assert.deepEqual(
    [...VALID_CATEGORIES].sort(),
    ['accessibility', 'content', 'conversion', 'mobile', 'performance', 'seo', 'ux'].sort()
  );
});
