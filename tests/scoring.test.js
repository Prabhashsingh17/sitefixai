const test = require('node:test');
const assert = require('node:assert/strict');

const { clampScore, makeFinding, evaluateCategory, CATEGORY_WEIGHTS } = require('../server/services/audit/scoring');

test('clampScore keeps values within 0-100 and rounds', () => {
  assert.equal(clampScore(50), 50);
  assert.equal(clampScore(-10), 0);
  assert.equal(clampScore(150), 100);
  assert.equal(clampScore(49.4), 49);
  assert.equal(clampScore(49.5), 50);
  assert.equal(clampScore(NaN), 0);
  assert.equal(clampScore(undefined), 0);
});

test('makeFinding builds a finding with exactly the required shape', () => {
  const finding = makeFinding('seo', 'good', 'Title', 'Description', 'Evidence', 'Recommendation');
  assert.deepEqual(Object.keys(finding).sort(), [
    'category', 'description', 'evidence', 'recommendation', 'severity', 'title',
  ].sort());
  assert.equal(finding.category, 'seo');
  assert.equal(finding.severity, 'good');
});

test('makeFinding rejects an invalid severity', () => {
  assert.throws(() => makeFinding('seo', 'nonsense', 't', 'd', 'e', 'r'), /Invalid finding severity/);
});

test('evaluateCategory computes a proportional score from points/maxPoints', () => {
  const checkResults = [
    { points: 10, maxPoints: 20, finding: makeFinding('seo', 'warning', 't1', 'd1', 'e1', 'r1') },
    { points: 30, maxPoints: 30, finding: makeFinding('seo', 'good', 't2', 'd2', 'e2', 'r2') },
    { points: 0, maxPoints: 50, finding: makeFinding('seo', 'critical', 't3', 'd3', 'e3', 'r3') },
  ];
  // (10 + 30 + 0) / (20 + 30 + 50) = 40/100 = 40
  const { score, findings } = evaluateCategory(checkResults);
  assert.equal(score, 40);
  assert.equal(findings.length, 3);
});

test('evaluateCategory returns 100 when there are no checks (nothing to penalize)', () => {
  const { score, findings } = evaluateCategory([]);
  assert.equal(score, 100);
  assert.deepEqual(findings, []);
});

test('evaluateCategory clamps a full-marks category at exactly 100', () => {
  const checkResults = [
    { points: 100, maxPoints: 100, finding: makeFinding('seo', 'good', 't', 'd', 'e', 'r') },
  ];
  const { score } = evaluateCategory(checkResults);
  assert.equal(score, 100);
});

test('category weights sum to exactly 1 (so overallScore stays 0-100)', () => {
  const total = Object.values(CATEGORY_WEIGHTS).reduce((sum, w) => sum + w, 0);
  // Floating point addition of the exact weights used should land on 1 precisely
  // for the values chosen (0.2, 0.15, 0.15, 0.15, 0.15, 0.1, 0.1).
  assert.ok(Math.abs(total - 1) < 1e-9, `weights summed to ${total}, expected 1`);
});
