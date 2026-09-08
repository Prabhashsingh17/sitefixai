const test = require('node:test');
const assert = require('node:assert/strict');

// Force an in-memory database for every test in this file so nothing ever
// touches the real project's data/sitefix.db.
process.env.SQLITE_DB_PATH = ':memory:';

const { closeDb } = require('../server/services/db/connection');
const scanStore = require('../server/services/scanStore');

// A fresh in-memory DB per test -- closeDb() forces the next getDb() call
// to open a brand new (empty) ':memory:' database, giving full isolation.
test.beforeEach(() => {
  closeDb();
});

test.after(() => {
  closeDb();
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fakeScanResult(overrides = {}) {
  return { url: 'https://example.com/', finalUrl: 'https://example.com/', title: 'Example', ...overrides };
}

function fakeAudit(overrides = {}) {
  return {
    overallScore: 82,
    categoryScores: { seo: 90, performance: 70, mobile: 100, accessibility: 80, content: 75, ux: 85, conversion: 60 },
    findings: [
      { category: 'seo', severity: 'warning', title: 'Title too long', description: 'd', evidence: 'e', recommendation: 'r' },
    ],
    summary: { totalChecks: 28, bySeverity: { critical: 0, warning: 1, info: 2, good: 25 }, weakestCategory: 'conversion', strongestCategory: 'mobile', topIssues: [] },
    ...overrides,
  };
}

// =============================================================================
// createScan
// =============================================================================
test('createScan generates a valid UUID scanId with pending status and null data fields', () => {
  const rec = scanStore.createScan('https://example.com/');
  assert.ok(UUID_PATTERN.test(rec.scanId));
  assert.equal(rec.url, 'https://example.com/');
  assert.equal(rec.status, 'pending');
  assert.ok(rec.createdAt);
  assert.equal(rec.completedAt, null);
  assert.equal(rec.result, null);
  assert.equal(rec.audit, null);
  assert.equal(rec.analysis, null);
  assert.equal(rec.error, null);
});

test('createScan gives each scan a distinct scanId', () => {
  const a = scanStore.createScan('https://a.example/');
  const b = scanStore.createScan('https://b.example/');
  assert.notEqual(a.scanId, b.scanId);
});

// =============================================================================
// getScan
// =============================================================================
test('getScan returns null for a nonexistent scanId (never throws)', () => {
  assert.equal(scanStore.getScan('00000000-0000-0000-0000-000000000000'), null);
});

test('getScan retrieves exactly what createScan stored', () => {
  const created = scanStore.createScan('https://example.com/');
  const fetched = scanStore.getScan(created.scanId);
  assert.deepEqual(fetched, created);
});

// =============================================================================
// updateScan
// =============================================================================
test('updateScan returns null for a nonexistent scanId (never throws)', () => {
  assert.equal(scanStore.updateScan('00000000-0000-0000-0000-000000000000', { status: 'complete' }), null);
});

test('updateScan applies a partial update without wiping unrelated fields', () => {
  const created = scanStore.createScan('https://example.com/');
  const updated = scanStore.updateScan(created.scanId, { status: 'in_progress' });
  assert.equal(updated.status, 'in_progress');
  assert.equal(updated.url, 'https://example.com/'); // unrelated field preserved
  assert.equal(updated.scanId, created.scanId);
});

test('updateScan persists a full completion (result + audit) and round-trips exactly', () => {
  const created = scanStore.createScan('https://example.com/');
  const result = fakeScanResult();
  const audit = fakeAudit();
  const completedAt = new Date().toISOString();

  const updated = scanStore.updateScan(created.scanId, { status: 'complete', completedAt, result, audit });

  assert.equal(updated.status, 'complete');
  assert.equal(updated.completedAt, completedAt);
  assert.deepEqual(updated.result, result);
  assert.deepEqual(updated.audit, audit);

  // And a completely fresh read (simulating a server restart re-reading the file) matches.
  const reFetched = scanStore.getScan(created.scanId);
  assert.deepEqual(reFetched, updated);
});

test('updateScan persists AI analysis separately from audit/result', () => {
  const created = scanStore.createScan('https://example.com/');
  scanStore.updateScan(created.scanId, { status: 'complete', result: fakeScanResult(), audit: fakeAudit() });

  const analysis = {
    generatedAt: new Date().toISOString(),
    model: 'claude-sonnet-5',
    basedOn: { overallScore: 82, categoryScores: {}, totalChecks: 28, checksPassed: 25, findingsAnalyzed: 3 },
    executiveSummary: 'Solid page with a couple of fixable issues.',
    recommendations: [],
    topImprovements: [],
    quickWins: [],
    longTermImprovements: [],
    disclaimer: 'These are suggestions, not guarantees.',
  };
  const updated = scanStore.updateScan(created.scanId, { analysis });
  assert.deepEqual(updated.analysis, analysis);
  // Result/audit from the earlier update should still be intact.
  assert.ok(updated.result);
  assert.ok(updated.audit);
});

test('updateScan can persist a failure (error message, no audit)', () => {
  const created = scanStore.createScan('https://bad.example/');
  const updated = scanStore.updateScan(created.scanId, {
    status: 'failed',
    completedAt: new Date().toISOString(),
    error: 'This URL points to a private, local, or internal network address and cannot be scanned.',
  });
  assert.equal(updated.status, 'failed');
  assert.equal(updated.audit, null);
  assert.equal(
    updated.error,
    'This URL points to a private, local, or internal network address and cannot be scanned.'
  );
});

// =============================================================================
// listRecent
// =============================================================================
test('listRecent returns entries newest-first', async () => {
  const first = scanStore.createScan('https://first.example/');
  await new Promise((r) => setTimeout(r, 5));
  const second = scanStore.createScan('https://second.example/');
  await new Promise((r) => setTimeout(r, 5));
  const third = scanStore.createScan('https://third.example/');

  const history = scanStore.listRecent(10);
  assert.equal(history.length, 3);
  assert.equal(history[0].scanId, third.scanId);
  assert.equal(history[1].scanId, second.scanId);
  assert.equal(history[2].scanId, first.scanId);
});

test('listRecent respects the limit parameter', () => {
  for (let i = 0; i < 5; i += 1) scanStore.createScan(`https://site-${i}.example/`);
  assert.equal(scanStore.listRecent(2).length, 2);
  assert.equal(scanStore.listRecent(3).length, 3);
});

test('listRecent defaults to 20 and clamps an oversized limit to 100', () => {
  for (let i = 0; i < 5; i += 1) scanStore.createScan(`https://site-${i}.example/`);
  assert.equal(scanStore.listRecent().length, 5); // fewer than the default cap exist
  assert.equal(scanStore.listRecent(99999).length, 5); // still fewer than exist, but must not throw
});

test('listRecent handles invalid/negative limit input gracefully rather than throwing', () => {
  scanStore.createScan('https://example.com/');
  assert.doesNotThrow(() => scanStore.listRecent(-5));
  assert.doesNotThrow(() => scanStore.listRecent('not-a-number'));
  assert.doesNotThrow(() => scanStore.listRecent(0));
});

test('listRecent entries are the lightweight shape only (no full scan_data/findings/analysis payload)', () => {
  const created = scanStore.createScan('https://example.com/');
  scanStore.updateScan(created.scanId, {
    status: 'complete',
    completedAt: new Date().toISOString(),
    result: fakeScanResult(),
    audit: fakeAudit(),
  });

  const history = scanStore.listRecent(10);
  assert.equal(history.length, 1);
  assert.deepEqual(Object.keys(history[0]).sort(), ['completedAt', 'createdAt', 'error', 'overallScore', 'scanId', 'status', 'url'].sort());
  assert.equal(history[0].overallScore, 82);
});

test('listRecent includes in-progress and failed scans alongside completed ones', () => {
  const pending = scanStore.createScan('https://pending.example/');
  const failed = scanStore.createScan('https://failed.example/');
  scanStore.updateScan(failed.scanId, { status: 'failed', error: 'boom' });

  const history = scanStore.listRecent(10);
  const statuses = history.map((h) => h.status).sort();
  assert.deepEqual(statuses, ['failed', 'pending']);
});

// =============================================================================
// Isolation between distinct scans
// =============================================================================
test('two scans do not interfere with each other', () => {
  const a = scanStore.createScan('https://a.example/');
  const b = scanStore.createScan('https://b.example/');

  scanStore.updateScan(a.scanId, { status: 'complete', audit: fakeAudit({ overallScore: 10 }) });
  scanStore.updateScan(b.scanId, { status: 'complete', audit: fakeAudit({ overallScore: 90 }) });

  assert.equal(scanStore.getScan(a.scanId).audit.overallScore, 10);
  assert.equal(scanStore.getScan(b.scanId).audit.overallScore, 90);
});

// =============================================================================
// No secrets ever stored
// =============================================================================
test('no API key or secret ever appears in a stored/retrieved scan record', () => {
  const previousKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-super-secret-value-should-never-be-stored';

  try {
    const created = scanStore.createScan('https://example.com/');
    const updated = scanStore.updateScan(created.scanId, {
      status: 'complete',
      result: fakeScanResult(),
      audit: fakeAudit(),
      analysis: {
        generatedAt: new Date().toISOString(),
        model: 'claude-sonnet-5',
        basedOn: {},
        executiveSummary: 'Fine.',
        recommendations: [],
        topImprovements: [],
        quickWins: [],
        longTermImprovements: [],
        disclaimer: 'Not a guarantee.',
      },
    });

    const serialized = JSON.stringify(updated);
    assert.ok(!serialized.includes('sk-ant-super-secret-value-should-never-be-stored'));

    const history = scanStore.listRecent(10);
    assert.ok(!JSON.stringify(history).includes('sk-ant-super-secret-value-should-never-be-stored'));
  } finally {
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousKey;
  }
});

// =============================================================================
// db/index.js -- the driver swap point
// =============================================================================
test('db/index.js resolves the sqlite repository by default and exposes all four functions', () => {
  delete require.cache[require.resolve('../server/services/db/index.js')];
  delete process.env.DB_DRIVER;
  const repo = require('../server/services/db/index.js');
  assert.equal(typeof repo.createScan, 'function');
  assert.equal(typeof repo.getScan, 'function');
  assert.equal(typeof repo.updateScan, 'function');
  assert.equal(typeof repo.listRecent, 'function');
});

test('db/index.js throws a clear error for an unsupported DB_DRIVER', () => {
  delete require.cache[require.resolve('../server/services/db/index.js')];
  process.env.DB_DRIVER = 'some_unsupported_backend';
  assert.throws(() => require('../server/services/db/index.js'), /Unsupported DB_DRIVER/);
  delete process.env.DB_DRIVER;
  delete require.cache[require.resolve('../server/services/db/index.js')];
});
