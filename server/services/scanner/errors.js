/**
 * errors.js
 * ---------------------------------------------------------------------------
 * Typed errors for the scanning pipeline. Every message on these classes is
 * written to be safe to show to an end user directly — no stack traces,
 * hostnames-as-resolved-IPs, file paths, or other internals ever go in
 * `message`. Anything that genuinely shouldn't be user-facing (a raw
 * caught error, an unexpected bug) should NOT be wrapped in one of these —
 * let the caller log it server-side and respond with a generic message
 * instead (see routes/auditRoutes.js).
 * ---------------------------------------------------------------------------
 */

class ScanError extends Error {
  constructor(message, code) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
  }
}

class InvalidUrlError extends ScanError {
  constructor(message = 'Please provide a valid http:// or https:// URL.') {
    super(message, 'invalid_url');
  }
}

class BlockedTargetError extends ScanError {
  constructor(
    message = 'This URL points to a private, local, or internal network address and cannot be scanned.'
  ) {
    super(message, 'blocked_target');
  }
}

class ScanTimeoutError extends ScanError {
  constructor(message = 'The website took too long to respond.') {
    super(message, 'timeout');
  }
}

class ResponseTooLargeError extends ScanError {
  constructor(message = 'The page was too large to analyze.') {
    super(message, 'response_too_large');
  }
}

class UnsupportedContentTypeError extends ScanError {
  constructor(message = 'This URL did not return an HTML page that can be audited.') {
    super(message, 'unsupported_content_type');
  }
}

class FetchFailedError extends ScanError {
  constructor(message = 'Could not connect to this website.') {
    super(message, 'fetch_failed');
  }
}

class TooManyRedirectsError extends ScanError {
  constructor(message = 'This URL redirected too many times.') {
    super(message, 'too_many_redirects');
  }
}

module.exports = {
  ScanError,
  InvalidUrlError,
  BlockedTargetError,
  ScanTimeoutError,
  ResponseTooLargeError,
  UnsupportedContentTypeError,
  FetchFailedError,
  TooManyRedirectsError,
};
