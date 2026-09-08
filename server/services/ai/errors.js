/**
 * errors.js
 * ---------------------------------------------------------------------------
 * Typed errors for the AI analysis layer. As with the scanner's error
 * classes, every message here is written to be safe to show an end user
 * directly — no API keys, raw provider error bodies, or stack traces.
 * ---------------------------------------------------------------------------
 */

class AIError extends Error {
  constructor(message, code) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
  }
}

/** The server has no (or an obviously invalid) Anthropic API key configured. */
class AIConfigError extends AIError {
  constructor(message = 'AI analysis is not configured on this server.') {
    super(message, 'ai_not_configured');
  }
}

/** The scan this analysis was requested for isn't in a state we can analyze. */
class AINotReadyError extends AIError {
  constructor(message = 'This scan does not have completed audit data to analyze yet.') {
    super(message, 'audit_not_ready');
  }
}

/** Network failure, timeout, or non-2xx response from the Claude API. */
class AIRequestError extends AIError {
  constructor(message = 'Could not reach the AI analysis service.') {
    super(message, 'ai_request_failed');
  }
}

/** The Claude API took too long to respond. */
class AITimeoutError extends AIError {
  constructor(message = 'The AI analysis took too long to respond.') {
    super(message, 'ai_timeout');
  }
}

/** Claude responded, but the response body wasn't valid JSON at all. */
class AIParseError extends AIError {
  constructor(message = 'The AI analysis returned an unreadable response.') {
    super(message, 'ai_invalid_response');
  }
}

/** Claude's JSON parsed, but didn't match the required recommendation schema. */
class AIValidationError extends AIError {
  constructor(message = 'The AI analysis returned data in an unexpected shape.') {
    super(message, 'ai_invalid_response');
  }
}

module.exports = {
  AIError,
  AIConfigError,
  AINotReadyError,
  AIRequestError,
  AITimeoutError,
  AIParseError,
  AIValidationError,
};
