/**
 * responseValidator.js (fix)
 * ---------------------------------------------------------------------------
 * Parses and validates Claude's JSON response for a single "Fix with AI"
 * request. Mirrors server/services/ai/responseValidator.js's approach:
 * structural validation, plus a defense-in-depth check against
 * guarantee-style language even though the prompt already forbids it.
 * ---------------------------------------------------------------------------
 */

const { parseJson } = require('../ai/jsonUtils');
const { AIValidationError } = require('../ai/errors');
const { FIX_TYPES } = require('./promptBuilder');

const GUARANTEE_LANGUAGE_PATTERN =
  /\bguarantee(d|s)?\b|\b100%\s*(increase|improvement|guaranteed)\b|\bwill\s+(definitely|certainly)\b|#\s*1\s*(ranking|position|spot)|\brank(ing)?\s+(number\s*1|first)\b/i;

const MAX_ORIGINAL_LEN = 500;
const MAX_IMPROVED_LEN = 1200;
const MAX_REASON_LEN = 600;
const MAX_ALTERNATIVE_LEN = 500;
const MAX_ALTERNATIVES = 3;

function truncate(value, maxLen) {
  if (typeof value !== 'string') return value;
  return value.length > maxLen ? value.slice(0, maxLen) + '…' : value;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * @param {string} rawText Raw text content from Claude's response.
 * @param {string} requestedFixType The fix type that was actually requested.
 * @param {string} fallbackOriginal The server-resolved current value, used
 *   if Claude's "original" field is missing.
 * @returns {{ fixType: string, original: string, improved: string, reason: string, alternatives: string[] }}
 * @throws {AIValidationError}
 */
function parseAndValidateFix(rawText, requestedFixType, fallbackOriginal) {
  const parsed = parseJson(rawText);

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AIValidationError('The AI fix service returned data in an unexpected shape.');
  }

  if (!isNonEmptyString(parsed.improved)) {
    throw new AIValidationError('The AI fix service did not return a usable suggestion.');
  }
  if (!isNonEmptyString(parsed.reason)) {
    throw new AIValidationError('The AI fix service did not explain its suggestion.');
  }

  const improved = truncate(parsed.improved.trim(), MAX_IMPROVED_LEN);
  const reason = truncate(parsed.reason.trim(), MAX_REASON_LEN);

  // Defense in depth: even though the prompt forbids it, never pass through
  // a suggestion that promises a guaranteed outcome.
  if (GUARANTEE_LANGUAGE_PATTERN.test(improved) || GUARANTEE_LANGUAGE_PATTERN.test(reason)) {
    throw new AIValidationError('The AI fix service returned an unsafe suggestion. Please try regenerating.');
  }

  const alternatives = Array.isArray(parsed.alternatives)
    ? parsed.alternatives
        .filter((a) => isNonEmptyString(a) && !GUARANTEE_LANGUAGE_PATTERN.test(a))
        .slice(0, MAX_ALTERNATIVES)
        .map((a) => truncate(a.trim(), MAX_ALTERNATIVE_LEN))
    : [];

  const fixType = FIX_TYPES.includes(parsed.fixType) ? parsed.fixType : requestedFixType;
  const original = isNonEmptyString(parsed.original)
    ? truncate(parsed.original.trim(), MAX_ORIGINAL_LEN)
    : fallbackOriginal || '';

  return { fixType, original, improved, reason, alternatives };
}

module.exports = { parseAndValidateFix };
