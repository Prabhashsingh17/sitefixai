/**
 * errors.js
 * ---------------------------------------------------------------------------
 * Error classes for the "Fix with AI" feature. Re-exports the shared AI
 * transport errors (config/timeout/request/parse/validation) from
 * server/services/ai/errors.js so route handling can check `instanceof
 * AIError` uniformly, and adds one fix-specific error for request-shape
 * problems that are about the request itself, not the AI call.
 * ---------------------------------------------------------------------------
 */

const {
  AIError,
  AIConfigError,
  AIRequestError,
  AITimeoutError,
  AIParseError,
  AIValidationError,
} = require('../ai/errors');

/** The fix request itself was malformed: bad fixType, missing finding, etc. */
class FixInputError extends Error {
  constructor(message, code = 'invalid_fix_request') {
    super(message);
    this.name = 'FixInputError';
    this.code = code;
  }
}

module.exports = {
  FixInputError,
  AIError,
  AIConfigError,
  AIRequestError,
  AITimeoutError,
  AIParseError,
  AIValidationError,
};
