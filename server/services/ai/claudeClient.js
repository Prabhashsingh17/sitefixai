/**
 * claudeClient.js
 * ---------------------------------------------------------------------------
 * The single, shared, low-level function that actually calls the Claude API.
 * Both aiAnalyzer.js (full-audit recommendations) and fixGenerator.js
 * (single-field "Fix with AI" suggestions) call this instead of touching
 * `fetch` directly, so the request shape, timeout handling, and error
 * mapping only exist in one place.
 *
 * This is the ONLY function in the codebase that sends a network request to
 * Anthropic. It runs exclusively server-side; the API key is read from
 * process.env and never appears in any value returned to a caller.
 * ---------------------------------------------------------------------------
 */

const { AIConfigError, AIRequestError, AITimeoutError, AIParseError } = require('./errors');

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-sonnet-5';
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TIMEOUT_MS = 45000;

function resolveApiKey() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new AIConfigError();
  }
  return apiKey.trim();
}

function resolveModel() {
  return (process.env.ANTHROPIC_MODEL || DEFAULT_MODEL).trim();
}

function resolveMaxTokens(override) {
  if (typeof override === 'number' && override > 0) return override;
  const fromEnv = Number(process.env.ANTHROPIC_MAX_TOKENS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_MAX_TOKENS;
}

// Hard ceiling on the text we'll accept from a single Claude response,
// independent of the configured max_tokens. This is defense-in-depth, not
// a response to a currently-known issue: Claude is a trusted, paid,
// first-party API reached over TLS, but a buggy proxy, misconfiguration,
// or unexpected upstream behavior should never be able to hand this
// process an unbounded string to JSON.parse() downstream. Real responses
// at our max_tokens settings (<=4096) are at most a few tens of KB.
const MAX_RESPONSE_TEXT_CHARS = 200000;

function extractTextFromClaudeResponse(data) {
  if (!data || !Array.isArray(data.content)) {
    throw new AIParseError('The AI service returned an unexpected response format.');
  }
  const textBlock = data.content.find((block) => block && block.type === 'text' && typeof block.text === 'string');
  if (!textBlock) {
    throw new AIParseError('The AI service did not return any text content.');
  }
  if (textBlock.text.length > MAX_RESPONSE_TEXT_CHARS) {
    throw new AIParseError('The AI service returned an unexpectedly large response.');
  }
  return textBlock.text;
}

/**
 * Call the Claude API with a system/user prompt and return the raw text of
 * its reply.
 *
 * @param {object} params
 * @param {string} params.system
 * @param {string} params.user
 * @param {number} [params.maxTokens] Overrides ANTHROPIC_MAX_TOKENS/default.
 * @param {number} [params.timeoutMs=45000]
 * @returns {Promise<{ text: string, model: string }>}
 * @throws {AIConfigError|AIRequestError|AITimeoutError|AIParseError}
 */
async function callClaude({ system, user, maxTokens, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const apiKey = resolveApiKey();
  const model = resolveModel();
  const tokens = resolveMaxTokens(maxTokens);

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: tokens,
        system,
        messages: [{ role: 'user', content: user }],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new AITimeoutError();
    }
    throw new AIRequestError();
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
    console.error(`Claude API returned ${response.status}:`, bodyText);

    if (response.status === 401 || response.status === 403) {
      throw new AIConfigError('AI analysis is not configured correctly on this server.');
    }
    if (response.status === 429) {
      throw new AIRequestError('The AI service is currently busy. Please try again shortly.');
    }
    throw new AIRequestError();
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    throw new AIParseError('The AI service returned an unreadable response.');
  }

  const text = extractTextFromClaudeResponse(data);
  return { text, model };
}

module.exports = { callClaude, DEFAULT_MODEL };
