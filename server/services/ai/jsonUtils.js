/**
 * jsonUtils.js
 * ---------------------------------------------------------------------------
 * Shared helpers for safely parsing a Claude text response as JSON. Used by
 * both server/services/ai/responseValidator.js and
 * server/services/fix/responseValidator.js so the "strip markdown fences,
 * then JSON.parse, throw a typed error on failure" logic exists once.
 * ---------------------------------------------------------------------------
 */

const { AIParseError } = require('./errors');

/**
 * Strips a ```json ... ``` or ``` ... ``` fence if present, since models
 * sometimes wrap JSON in markdown even when told not to.
 */
function stripCodeFences(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

/**
 * @param {string} rawText Raw text content from a Claude response.
 * @returns {*} Parsed JSON (caller is responsible for shape validation).
 * @throws {AIParseError}
 */
function parseJson(rawText) {
  if (typeof rawText !== 'string' || !rawText.trim()) {
    throw new AIParseError('The AI service returned an empty response.');
  }
  const candidate = stripCodeFences(rawText);
  try {
    return JSON.parse(candidate);
  } catch (err) {
    throw new AIParseError();
  }
}

module.exports = { stripCodeFences, parseJson };
