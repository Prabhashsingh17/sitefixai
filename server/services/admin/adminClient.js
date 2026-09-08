/**
 * adminClient.js
 * ---------------------------------------------------------------------------
 * Looks up metadata (name, status, etc.) for the server's own configured
 * Anthropic API key via the Anthropic Admin API. This is a read-only
 * diagnostic -- it never creates, rotates, or deletes anything.
 *
 * This requires an Anthropic *Admin* API key (ANTHROPIC_ADMIN_KEY), which is
 * a distinct credential from the regular ANTHROPIC_API_KEY used by
 * claudeClient.js -- an Admin key can read/manage organization resources
 * (API keys, workspaces, members) and must never be sent to, or readable
 * by, the browser.
 *
 * Configuration (see .env.example):
 *   ANTHROPIC_ADMIN_KEY   required -- an Admin API key (sk-ant-admin...).
 *   ANTHROPIC_API_KEY_ID  required -- the apikey_... ID to look up.
 * ---------------------------------------------------------------------------
 */

const {
  AdminConfigError,
  AdminNotFoundError,
  AdminRequestError,
  AdminTimeoutError,
  AdminParseError,
} = require('./errors');

const ANTHROPIC_ADMIN_API_URL = 'https://api.anthropic.com/v1/organizations/api_keys';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_TIMEOUT_MS = 15000;

function resolveAdminKey() {
  const adminKey = process.env.ANTHROPIC_ADMIN_KEY;
  if (!adminKey || !adminKey.trim()) {
    throw new AdminConfigError();
  }
  return adminKey.trim();
}

function resolveApiKeyId() {
  const apiKeyId = process.env.ANTHROPIC_API_KEY_ID;
  if (!apiKeyId || !apiKeyId.trim()) {
    throw new AdminConfigError();
  }
  return apiKeyId.trim();
}

/**
 * Fetch status metadata for the API key ID configured in
 * ANTHROPIC_API_KEY_ID, using the Admin key configured in
 * ANTHROPIC_ADMIN_KEY.
 *
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=15000]
 * @returns {Promise<{ id: string, name: string, status: string, workspaceId: string|null, createdAt: string }>}
 * @throws {import('./errors').AdminError}
 */
async function getApiKeyStatus({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const adminKey = resolveAdminKey();
  const apiKeyId = resolveApiKeyId();

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(`${ANTHROPIC_ADMIN_API_URL}/${encodeURIComponent(apiKeyId)}`, {
      method: 'GET',
      headers: {
        'anthropic-version': ANTHROPIC_VERSION,
        'X-Api-Key': adminKey,
      },
      signal: controller.signal,
    });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new AdminTimeoutError();
    }
    throw new AdminRequestError();
  } finally {
    clearTimeout(timeoutHandle);
  }

  if (!response.ok) {
    // Log the real provider error server-side only -- never forward
    // provider error bodies (which can include request diagnostics) to
    // the client.
    let bodyText = '';
    try {
      bodyText = await response.text();
    } catch (err) {
      bodyText = '(unreadable error body)';
    }
    console.error(`Anthropic Admin API returned ${response.status}:`, bodyText);

    if (response.status === 401 || response.status === 403) {
      throw new AdminConfigError('API key lookup is not configured correctly on this server.');
    }
    if (response.status === 404) {
      throw new AdminNotFoundError();
    }
    throw new AdminRequestError();
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    throw new AdminParseError();
  }

  if (!data || typeof data.id !== 'string' || typeof data.status !== 'string') {
    throw new AdminParseError();
  }

  return {
    id: data.id,
    name: typeof data.name === 'string' ? data.name : null,
    status: data.status,
    workspaceId: typeof data.workspace_id === 'string' ? data.workspace_id : null,
    createdAt: typeof data.created_at === 'string' ? data.created_at : null,
  };
}

module.exports = { getApiKeyStatus };
