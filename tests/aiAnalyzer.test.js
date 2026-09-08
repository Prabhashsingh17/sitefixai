const test = require('node:test');
const assert = require('node:assert/strict');
const { perfectScan, baseScan } = require('./fixtures');
const { runAudit } = require('../server/services/auditEngine');

// aiAnalyzer.js is required fresh inside each test (via delete require.cache)
// so that changes to process.env.ANTHROPIC_API_KEY between tests take effect
// -- the module doesn't cache the key anywhere at require time.
function freshAiAnalyzer() {
  delete require.cache[require.resolve('../server/services/aiAnalyzer')];
  return require('../server/services/aiAnalyzer');
}

function validClaudeResponseBody(recommendationCount = 1) {
  const recommendations = Array.from({ length: recommendationCount }, (_, i) => ({
    category: 'seo',
    priority: 'high',
    problem: `Problem ${i}`,
    whyItMatters: 'It matters because of reasons.',
    recommendedFix: 'Fix it like this.',
    example: 'Example text.',
    expectedImpact: 'This can help improve things.',
  }));
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          executiveSummary: 'Overall the page has a few fixable issues.',
          recommendations,
          topImprovementIndexes: recommendations.map((_, i) => i).slice(0, 5),
          quickWinIndexes: [],
          longTermIndexes: [],
        }),
      },
    ],
  };
}

let originalFetch;
let originalApiKey;

test.beforeEach(() => {
  originalFetch = global.fetch;
  originalApiKey = process.env.ANTHROPIC_API_KEY;
});

test.afterEach(() => {
  global.fetch = originalFetch;
  if (originalApiKey === undefined) {
    delete process.env.ANTHROPIC_API_KEY;
  } else {
    process.env.ANTHROPIC_API_KEY = originalApiKey;
  }
});

test('throws AIConfigError immediately when no API key is configured, without calling fetch', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
    throw new Error('should not be called');
  };

  const { generateRecommendations, errors } = freshAiAnalyzer();
  const scan = perfectScan();
  const audit = runAudit(scan);

  await assert.rejects(() => generateRecommendations(scan, audit), errors.AIConfigError);
  assert.equal(fetchCalled, false);
});

test('throws AINotReadyError if scan or audit data is missing', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  const { generateRecommendations, errors } = freshAiAnalyzer();

  await assert.rejects(() => generateRecommendations(null, {}), errors.AINotReadyError);
  await assert.rejects(() => generateRecommendations({}, null), errors.AINotReadyError);
});

test('a successful Claude response produces a fully-shaped analysis, with facts clearly separated from AI output', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  let capturedRequest = null;

  global.fetch = async (url, options) => {
    capturedRequest = { url, options };
    return {
      ok: true,
      status: 200,
      json: async () => validClaudeResponseBody(2),
    };
  };

  const { generateRecommendations } = freshAiAnalyzer();
  const scan = baseScan({ technical: { https: false, redirected: false, scanDurationMs: 5000 } });
  const audit = runAudit(scan);

  const analysis = await generateRecommendations(scan, audit);

  // Request correctness
  assert.equal(capturedRequest.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(capturedRequest.options.headers['x-api-key'], 'test-key');
  assert.ok(capturedRequest.options.headers['anthropic-version']);
  const sentBody = JSON.parse(capturedRequest.options.body);
  assert.ok(sentBody.model);
  assert.ok(sentBody.system.length > 0);
  assert.ok(Array.isArray(sentBody.messages));

  // Response shape: facts ("basedOn") vs AI output are clearly separate keys
  assert.ok(analysis.basedOn);
  assert.equal(analysis.basedOn.overallScore, audit.overallScore);
  assert.deepEqual(analysis.basedOn.categoryScores, audit.categoryScores);
  assert.equal(typeof analysis.executiveSummary, 'string');
  assert.equal(analysis.recommendations.length, 2);
  assert.ok(Array.isArray(analysis.topImprovements));
  assert.ok(Array.isArray(analysis.quickWins));
  assert.ok(Array.isArray(analysis.longTermImprovements));
  assert.ok(analysis.disclaimer.toLowerCase().includes('not guarantees'));
  assert.ok(analysis.generatedAt);
});

test('the API key is never present anywhere in the returned analysis object', async () => {
  process.env.ANTHROPIC_API_KEY = 'super-secret-key-should-not-leak';
  global.fetch = async () => ({ ok: true, status: 200, json: async () => validClaudeResponseBody(1) });

  const { generateRecommendations } = freshAiAnalyzer();
  const scan = perfectScan();
  const audit = runAudit(scan);
  const analysis = await generateRecommendations(scan, audit);

  const serialized = JSON.stringify(analysis);
  assert.ok(!serialized.includes('super-secret-key-should-not-leak'));
});

test('a 401 from the Claude API is surfaced as AIConfigError, not the raw provider response', async () => {
  process.env.ANTHROPIC_API_KEY = 'bad-key';
  global.fetch = async () => ({
    ok: false,
    status: 401,
    text: async () => '{"error": {"message": "invalid x-api-key: super-secret-details"}}',
  });

  const { generateRecommendations, errors } = freshAiAnalyzer();
  const scan = perfectScan();
  const audit = runAudit(scan);

  await assert.rejects(async () => {
    try {
      await generateRecommendations(scan, audit);
    } catch (err) {
      assert.ok(err instanceof errors.AIConfigError);
      assert.ok(!err.message.includes('super-secret-details'));
      throw err;
    }
  });
});

test('a 429 from the Claude API is surfaced as a friendly "busy" AIRequestError', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  global.fetch = async () => ({ ok: false, status: 429, text: async () => 'rate limited' });

  const { generateRecommendations, errors } = freshAiAnalyzer();
  const scan = perfectScan();
  const audit = runAudit(scan);

  await assert.rejects(() => generateRecommendations(scan, audit), errors.AIRequestError);
});

test('a network-level fetch failure is surfaced as AIRequestError', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  global.fetch = async () => {
    throw new TypeError('fetch failed');
  };

  const { generateRecommendations, errors } = freshAiAnalyzer();
  const scan = perfectScan();
  const audit = runAudit(scan);

  await assert.rejects(() => generateRecommendations(scan, audit), errors.AIRequestError);
});

test('an AbortError (timeout) is surfaced as AITimeoutError', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  global.fetch = async () => {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    throw err;
  };

  const { generateRecommendations, errors } = freshAiAnalyzer();
  const scan = perfectScan();
  const audit = runAudit(scan);

  await assert.rejects(() => generateRecommendations(scan, audit), errors.AITimeoutError);
});

test('a response.json() failure is surfaced as AIParseError, not a raw crash', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError('Unexpected token');
    },
  });

  const { generateRecommendations, errors } = freshAiAnalyzer();
  const scan = perfectScan();
  const audit = runAudit(scan);

  await assert.rejects(() => generateRecommendations(scan, audit), errors.AIParseError);
});

test('Claude returning malformed inner JSON text is handled safely as AIParseError', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ content: [{ type: 'text', text: '{not valid json at all' }] }),
  });

  const { generateRecommendations, errors } = freshAiAnalyzer();
  const scan = perfectScan();
  const audit = runAudit(scan);

  await assert.rejects(() => generateRecommendations(scan, audit), errors.AIParseError);
});

test('a Claude response with no text content block is handled safely, not a crash', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ content: [{ type: 'tool_use', input: {} }] }),
  });

  const { generateRecommendations, errors } = freshAiAnalyzer();
  const scan = perfectScan();
  const audit = runAudit(scan);

  await assert.rejects(() => generateRecommendations(scan, audit), errors.AIParseError);
});

test('the outgoing request payload never includes the full raw scan (input is bounded)', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  let capturedBody = null;
  global.fetch = async (url, options) => {
    capturedBody = options.body;
    return { ok: true, status: 200, json: async () => validClaudeResponseBody(1) };
  };

  const { generateRecommendations } = freshAiAnalyzer();
  // A scan with large sample arrays -- these should NOT appear verbatim in the request.
  const scan = baseScan({
    links: {
      total: 50,
      internal: { count: 50, samples: Array.from({ length: 15 }, (_, i) => `https://example.com/page-${i}-with-a-very-long-descriptive-slug-for-padding`) },
      external: { count: 0, samples: [] },
    },
  });
  const audit = runAudit(scan);
  await generateRecommendations(scan, audit);

  // The full link sample list should not be forwarded -- only counts.
  assert.ok(!capturedBody.includes('page-14-with-a-very-long-descriptive-slug-for-padding'));
  // Reasonable overall size bound on the request body.
  assert.ok(capturedBody.length < 20000, `request body was ${capturedBody.length} chars`);
});
