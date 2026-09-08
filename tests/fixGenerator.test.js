const test = require('node:test');
const assert = require('node:assert/strict');
const { perfectScan } = require('./fixtures');

function freshFixGenerator() {
  delete require.cache[require.resolve('../server/services/fixGenerator')];
  delete require.cache[require.resolve('../server/services/ai/claudeClient')];
  return require('../server/services/fixGenerator');
}

const sampleFinding = {
  category: 'seo',
  severity: 'critical',
  title: 'Missing page title',
  description: 'No <title> tag was found.',
  evidence: 'No <title> element detected in the page <head>.',
  recommendation: 'Add a concise, descriptive <title> tag.',
};

function validFixResponseBody(overrides = {}) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          fixType: 'title',
          original: '',
          improved: 'Best Widgets Online | Fast Shipping',
          reason: 'This is descriptive and well-sized for search results.',
          alternatives: ['Widgets Direct | Free Shipping Today'],
          ...overrides,
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

test('rejects an unsupported fix type before ever calling fetch', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
    throw new Error('should not be called');
  };

  const { generateFix, errors } = freshFixGenerator();
  await assert.rejects(
    () => generateFix({ scanResult: perfectScan(), finding: sampleFinding, fixType: 'not-a-real-type' }),
    errors.FixInputError
  );
  assert.equal(fetchCalled, false);
});

test('rejects a missing/invalid finding before calling fetch', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
    throw new Error('should not be called');
  };

  const { generateFix, errors } = freshFixGenerator();
  await assert.rejects(
    () => generateFix({ scanResult: perfectScan(), finding: null, fixType: 'title' }),
    errors.FixInputError
  );
  assert.equal(fetchCalled, false);
});

test('rejects missing scan data before calling fetch', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  const { generateFix, errors } = freshFixGenerator();
  await assert.rejects(
    () => generateFix({ scanResult: null, finding: sampleFinding, fixType: 'title' }),
    errors.FixInputError
  );
});

test('throws AIConfigError when no API key is configured', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const { generateFix, errors } = freshFixGenerator();
  await assert.rejects(
    () => generateFix({ scanResult: perfectScan(), finding: sampleFinding, fixType: 'title' }),
    errors.AIConfigError
  );
});

test('a successful fix generation returns the full expected shape', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  let capturedRequest = null;
  global.fetch = async (url, options) => {
    capturedRequest = { url, options };
    return { ok: true, status: 200, json: async () => validFixResponseBody() };
  };

  const { generateFix } = freshFixGenerator();
  const result = await generateFix({ scanResult: perfectScan(), finding: sampleFinding, fixType: 'title' });

  assert.equal(result.fixType, 'title');
  assert.equal(typeof result.improved, 'string');
  assert.equal(typeof result.reason, 'string');
  assert.ok(Array.isArray(result.alternatives));
  assert.ok(result.generatedAt);
  assert.ok(result.disclaimer.toLowerCase().includes('nothing is applied automatically'));

  // Sanity-check the outgoing request used the finding, not client-invented data.
  const sentBody = JSON.parse(capturedRequest.options.body);
  assert.ok(sentBody.messages[0].content.includes('Missing page title'));
});

test('the API key never appears anywhere in the returned fix object', async () => {
  process.env.ANTHROPIC_API_KEY = 'super-secret-should-not-leak';
  global.fetch = async () => ({ ok: true, status: 200, json: async () => validFixResponseBody() });

  const { generateFix } = freshFixGenerator();
  const result = await generateFix({ scanResult: perfectScan(), finding: sampleFinding, fixType: 'title' });
  assert.ok(!JSON.stringify(result).includes('super-secret-should-not-leak'));
});

test('a 429 from Claude surfaces as AIRequestError', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  global.fetch = async () => ({ ok: false, status: 429, text: async () => 'rate limited' });

  const { generateFix, errors } = freshFixGenerator();
  await assert.rejects(
    () => generateFix({ scanResult: perfectScan(), finding: sampleFinding, fixType: 'title' }),
    errors.AIRequestError
  );
});

test('malformed inner JSON from Claude is handled safely as AIParseError', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ content: [{ type: 'text', text: '{not valid json' }] }),
  });

  const { generateFix, errors } = freshFixGenerator();
  await assert.rejects(
    () => generateFix({ scanResult: perfectScan(), finding: sampleFinding, fixType: 'title' }),
    errors.AIParseError
  );
});

test('a fix response with guarantee language is rejected safely as AIValidationError', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => validFixResponseBody({ improved: 'We guarantee this will rank #1.' }),
  });

  const { generateFix, errors } = freshFixGenerator();
  await assert.rejects(
    () => generateFix({ scanResult: perfectScan(), finding: sampleFinding, fixType: 'title' }),
    errors.AIValidationError
  );
});

test('works correctly for the alt_text fix type with an image path', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  let capturedBody = null;
  global.fetch = async (url, options) => {
    capturedBody = options.body;
    return {
      ok: true,
      status: 200,
      json: async () =>
        validFixResponseBody({
          fixType: 'alt_text',
          original: '/images/product-42.jpg',
          improved: 'Product photo (exact contents not visible to AI -- please verify)',
        }),
    };
  };

  const { generateFix } = freshFixGenerator();
  const scan = perfectScan();
  scan.images = { count: 1, missingAlt: { count: 1, samples: ['/images/product-42.jpg'] } };

  const altFinding = {
    category: 'accessibility', severity: 'critical', title: 'Most images are missing alt text',
    description: 'desc', evidence: 'evidence', recommendation: 'rec',
  };

  const result = await generateFix({
    scanResult: scan,
    finding: altFinding,
    fixType: 'alt_text',
    imageSrc: '/images/product-42.jpg',
  });

  assert.equal(result.fixType, 'alt_text');
  assert.ok(capturedBody.includes('/images/product-42.jpg'));
});
