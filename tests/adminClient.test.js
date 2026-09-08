const test = require('node:test');
const assert = require('node:assert/strict');

// adminClient.js is required fresh inside each test (via delete require.cache)
// so that changes to process.env between tests take effect -- the module
// doesn't cache any config at require time.
function freshAdminClient() {
  delete require.cache[require.resolve('../server/services/admin/adminClient')];
  return require('../server/services/admin/adminClient');
}

let originalFetch;
let originalAdminKey;
let originalApiKeyId;

test.beforeEach(() => {
  originalFetch = global.fetch;
  originalAdminKey = process.env.ANTHROPIC_ADMIN_KEY;
  originalApiKeyId = process.env.ANTHROPIC_API_KEY_ID;
});

test.afterEach(() => {
  global.fetch = originalFetch;
  if (originalAdminKey === undefined) {
    delete process.env.ANTHROPIC_ADMIN_KEY;
  } else {
    process.env.ANTHROPIC_ADMIN_KEY = originalAdminKey;
  }
  if (originalApiKeyId === undefined) {
    delete process.env.ANTHROPIC_API_KEY_ID;
  } else {
    process.env.ANTHROPIC_API_KEY_ID = originalApiKeyId;
  }
});

test('throws AdminConfigError immediately when no admin key is configured, without calling fetch', async () => {
  delete process.env.ANTHROPIC_ADMIN_KEY;
  process.env.ANTHROPIC_API_KEY_ID = 'apikey_test';
  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
    throw new Error('should not be called');
  };

  const { getApiKeyStatus } = freshAdminClient();
  const { AdminConfigError } = require('../server/services/admin/errors');

  await assert.rejects(() => getApiKeyStatus(), AdminConfigError);
  assert.equal(fetchCalled, false);
});

test('throws AdminConfigError immediately when no API key ID is configured, without calling fetch', async () => {
  process.env.ANTHROPIC_ADMIN_KEY = 'sk-ant-admin-test';
  delete process.env.ANTHROPIC_API_KEY_ID;
  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
    throw new Error('should not be called');
  };

  const { getApiKeyStatus } = freshAdminClient();
  const { AdminConfigError } = require('../server/services/admin/errors');

  await assert.rejects(() => getApiKeyStatus(), AdminConfigError);
  assert.equal(fetchCalled, false);
});

test('a successful lookup returns the key status, hitting the correct URL with the admin key header', async () => {
  process.env.ANTHROPIC_ADMIN_KEY = 'sk-ant-admin-test';
  process.env.ANTHROPIC_API_KEY_ID = 'apikey_01abc';
  let capturedUrl = null;
  let capturedHeaders = null;

  global.fetch = async (url, options) => {
    capturedUrl = url;
    capturedHeaders = options.headers;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: 'apikey_01abc',
        name: 'Production key',
        status: 'active',
        workspace_id: null,
        created_at: '2025-01-01T00:00:00Z',
      }),
    };
  };

  const { getApiKeyStatus } = freshAdminClient();
  const result = await getApiKeyStatus();

  assert.equal(capturedUrl, 'https://api.anthropic.com/v1/organizations/api_keys/apikey_01abc');
  assert.equal(capturedHeaders['X-Api-Key'], 'sk-ant-admin-test');
  assert.ok(capturedHeaders['anthropic-version']);

  assert.deepEqual(result, {
    id: 'apikey_01abc',
    name: 'Production key',
    status: 'active',
    workspaceId: null,
    createdAt: '2025-01-01T00:00:00Z',
  });
});

test('the admin key is never present anywhere in the returned result', async () => {
  process.env.ANTHROPIC_ADMIN_KEY = 'super-secret-admin-key-should-not-leak';
  process.env.ANTHROPIC_API_KEY_ID = 'apikey_01abc';
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ id: 'apikey_01abc', status: 'active' }),
  });

  const { getApiKeyStatus } = freshAdminClient();
  const result = await getApiKeyStatus();

  assert.ok(!JSON.stringify(result).includes('super-secret-admin-key-should-not-leak'));
});

test('a 401 from the Admin API is surfaced as AdminConfigError, not the raw provider response', async () => {
  process.env.ANTHROPIC_ADMIN_KEY = 'bad-admin-key';
  process.env.ANTHROPIC_API_KEY_ID = 'apikey_01abc';
  global.fetch = async () => ({
    ok: false,
    status: 401,
    text: async () => '{"error": {"message": "invalid x-api-key: super-secret-details"}}',
  });

  const { getApiKeyStatus } = freshAdminClient();
  const { AdminConfigError } = require('../server/services/admin/errors');

  await assert.rejects(async () => {
    try {
      await getApiKeyStatus();
    } catch (err) {
      assert.ok(err instanceof AdminConfigError);
      assert.ok(!err.message.includes('super-secret-details'));
      throw err;
    }
  });
});

test('a 404 from the Admin API is surfaced as AdminNotFoundError', async () => {
  process.env.ANTHROPIC_ADMIN_KEY = 'sk-ant-admin-test';
  process.env.ANTHROPIC_API_KEY_ID = 'apikey_does_not_exist';
  global.fetch = async () => ({ ok: false, status: 404, text: async () => 'not found' });

  const { getApiKeyStatus } = freshAdminClient();
  const { AdminNotFoundError } = require('../server/services/admin/errors');

  await assert.rejects(() => getApiKeyStatus(), AdminNotFoundError);
});

test('a network-level fetch failure is surfaced as AdminRequestError', async () => {
  process.env.ANTHROPIC_ADMIN_KEY = 'sk-ant-admin-test';
  process.env.ANTHROPIC_API_KEY_ID = 'apikey_01abc';
  global.fetch = async () => {
    throw new TypeError('fetch failed');
  };

  const { getApiKeyStatus } = freshAdminClient();
  const { AdminRequestError } = require('../server/services/admin/errors');

  await assert.rejects(() => getApiKeyStatus(), AdminRequestError);
});

test('an AbortError (timeout) is surfaced as AdminTimeoutError', async () => {
  process.env.ANTHROPIC_ADMIN_KEY = 'sk-ant-admin-test';
  process.env.ANTHROPIC_API_KEY_ID = 'apikey_01abc';
  global.fetch = async () => {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    throw err;
  };

  const { getApiKeyStatus } = freshAdminClient();
  const { AdminTimeoutError } = require('../server/services/admin/errors');

  await assert.rejects(() => getApiKeyStatus(), AdminTimeoutError);
});

test('a malformed (non-JSON) response body is surfaced as AdminParseError', async () => {
  process.env.ANTHROPIC_ADMIN_KEY = 'sk-ant-admin-test';
  process.env.ANTHROPIC_API_KEY_ID = 'apikey_01abc';
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError('Unexpected token');
    },
  });

  const { getApiKeyStatus } = freshAdminClient();
  const { AdminParseError } = require('../server/services/admin/errors');

  await assert.rejects(() => getApiKeyStatus(), AdminParseError);
});

test('a response missing required fields is surfaced as AdminParseError, not a crash', async () => {
  process.env.ANTHROPIC_ADMIN_KEY = 'sk-ant-admin-test';
  process.env.ANTHROPIC_API_KEY_ID = 'apikey_01abc';
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ unrelated: 'shape' }) });

  const { getApiKeyStatus } = freshAdminClient();
  const { AdminParseError } = require('../server/services/admin/errors');

  await assert.rejects(() => getApiKeyStatus(), AdminParseError);
});
