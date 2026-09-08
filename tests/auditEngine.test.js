const test = require('node:test');
const assert = require('node:assert/strict');
const { baseScan, perfectScan } = require('./fixtures');
const { runAudit, CATEGORY_ORDER } = require('../server/services/auditEngine');
const { CATEGORY_WEIGHTS } = require('../server/services/audit/scoring');

test('runAudit is deterministic: identical input always produces identical output', () => {
  const scan = perfectScan();
  const result1 = runAudit(scan);
  const result2 = runAudit(scan);
  assert.deepEqual(result1, result2);
});

test('runAudit throws a clear error for missing/invalid input rather than guessing', () => {
  assert.throws(() => runAudit(null), TypeError);
  assert.throws(() => runAudit(undefined), TypeError);
  assert.throws(() => runAudit('not an object'), TypeError);
});

test('a well-optimized page scores 100 overall with no critical/warning findings', () => {
  const result = runAudit(perfectScan());
  assert.equal(result.overallScore, 100);
  CATEGORY_ORDER.forEach((cat) => {
    assert.equal(result.categoryScores[cat], 100, `expected ${cat} to be 100`);
  });
  assert.equal(result.summary.bySeverity.critical, 0);
  assert.equal(result.summary.bySeverity.warning, 0);
  assert.equal(result.summary.topIssues.length, 0);
});

test('a bare/broken page scores low overall and surfaces critical findings', () => {
  const result = runAudit(baseScan({ technical: { https: false, redirected: false, scanDurationMs: 4000 } }));
  assert.ok(result.overallScore < 40, `expected a low score, got ${result.overallScore}`);
  assert.ok(result.summary.bySeverity.critical > 0);
  assert.ok(result.summary.topIssues.length > 0);
  // Every top issue must actually be critical or warning severity.
  result.summary.topIssues.forEach((f) => {
    assert.ok(['critical', 'warning'].includes(f.severity));
  });
});

test('categories with nothing to evaluate (no images/forms) are not penalized as failures', () => {
  // A page with solid fundamentals but genuinely no images and no forms.
  const scan = baseScan({
    title: 'A Perfectly Fine Page About Widgets and Gadgets',
    metaDescription: 'A solid, complete description of this page that falls in the ideal length range for search snippets.',
    headings: { h1: { count: 1, text: ['Widgets and Gadgets'] }, h2: { count: 2, text: ['Section A', 'Section B'] } },
    images: { count: 0, missingAlt: { count: 0, samples: [] } },
    forms: [],
    content: { wordCount: 400, ctaElements: { count: 0, samples: [] } },
    technical: { https: true, redirected: false, scanDurationMs: 200 },
  });
  const result = runAudit(scan);
  // Accessibility's image-alt and form-label checks should both be "good"
  // (nothing to evaluate), not critical, even though the page has 0 of each.
  const accessibilityFindings = result.findings.filter((f) => f.category === 'accessibility');
  const imageFinding = accessibilityFindings.find((f) => f.title === 'No images to evaluate');
  const formFinding = accessibilityFindings.find((f) => f.title === 'No form inputs to evaluate');
  assert.equal(imageFinding.severity, 'good');
  assert.equal(formFinding.severity, 'good');
});

test('overallScore matches the documented fixed weighted average of category scores', () => {
  const scan = perfectScan({ technical: { https: true, redirected: true, scanDurationMs: 2000 } });
  const result = runAudit(scan);
  const expected = Math.round(
    CATEGORY_ORDER.reduce((sum, cat) => sum + result.categoryScores[cat] * CATEGORY_WEIGHTS[cat], 0)
  );
  assert.equal(result.overallScore, expected);
});

test('summary reports totalChecks equal to the number of findings, and severities sum to that total', () => {
  const result = runAudit(perfectScan());
  assert.equal(result.summary.totalChecks, result.findings.length);
  const severitySum = Object.values(result.summary.bySeverity).reduce((a, b) => a + b, 0);
  assert.equal(severitySum, result.findings.length);
});

test('summary identifies the weakest and strongest category correctly', () => {
  const scan = perfectScan();
  // Deliberately tank SEO by removing everything it checks.
  scan.title = null;
  scan.metaDescription = null;
  scan.seo = { canonicalUrl: null, robotsMeta: null, openGraph: {}, structuredData: { present: false, types: [] } };
  scan.headings = { h1: { count: 0, text: [] }, h2: { count: scan.headings.h2.count, text: scan.headings.h2.text } };

  const result = runAudit(scan);
  assert.equal(result.summary.weakestCategory, 'seo');
});

test('every category score and the overall score are always within 0-100', () => {
  const scans = [baseScan({}), perfectScan(), baseScan({ technical: { https: true, redirected: false, scanDurationMs: 100000 } })];
  scans.forEach((scan) => {
    const result = runAudit(scan);
    assert.ok(result.overallScore >= 0 && result.overallScore <= 100);
    CATEGORY_ORDER.forEach((cat) => {
      const score = result.categoryScores[cat];
      assert.ok(score >= 0 && score <= 100, `${cat} score ${score} out of range`);
    });
  });
});

test('findings only ever use the four documented severities', () => {
  const result = runAudit(perfectScan());
  const combined = runAudit(baseScan({}));
  [...result.findings, ...combined.findings].forEach((f) => {
    assert.ok(['critical', 'warning', 'info', 'good'].includes(f.severity));
  });
});

test('runAudit never mutates the scan result it was given', () => {
  const scan = perfectScan();
  const snapshot = JSON.parse(JSON.stringify(scan));
  runAudit(scan);
  assert.deepEqual(scan, snapshot);
});
