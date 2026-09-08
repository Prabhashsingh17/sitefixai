/**
 * errors.js
 * ---------------------------------------------------------------------------
 * Typed errors for the Anthropic Admin API layer (server/services/admin/).
 * As with the AI and scanner error classes, every message here is written
 * to be safe to show an end user directly -- no admin keys, key IDs, raw
 * provider error bodies, or stack traces.
 * ---------------------------------------------------------------------------
 */

class AdminError extends Error {
  constructor(message, code) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
  }
}

/** The server has no (or an obviously invalid) Anthropic Admin API key, or no key ID, configured. */
class AdminConfigError extends AdminError {
  constructor(message = 'API key lookup is not configured on this server.') {
    super(message, 'admin_not_configured');
  }
}

/** The configured API key ID doesn't exist (or isn't visible to this Admin key). */
class AdminNotFoundError extends AdminError {
  constructor(message = 'The configured API key ID was not found.') {
    super(message, 'admin_key_not_found');
  }
}

/** Network failure, or a non-2xx response from the Admin API other than 401/403/404. */
class AdminRequestError extends AdminError {
  constructor(message = 'Could not reach the Anthropic Admin API.') {
    super(message, 'admin_request_failed');
  }
}

/** The Admin API took too long to respond. */
class AdminTimeoutError extends AdminError {
  constructor(message = 'The API key lookup took too long to respond.') {
    super(message, 'admin_timeout');
  }
}

/** The Admin API responded, but the response body wasn't valid/expected JSON. */
class AdminParseError extends AdminError {
  constructor(message = 'The Admin API returned an unreadable response.') {
    super(message, 'admin_invalid_response');
  }
}

module.exports = {
  AdminError,
  AdminConfigError,
  AdminNotFoundError,
  AdminRequestError,
  AdminTimeoutError,
  AdminParseError,
};
