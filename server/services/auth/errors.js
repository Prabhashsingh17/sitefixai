/**
 * errors.js
 * ---------------------------------------------------------------------------
 * Typed errors for the auth service. As with every other service's errors,
 * every message here is written to be safe to show an end user directly --
 * no password hashes, session tokens, or raw DB errors.
 * ---------------------------------------------------------------------------
 */

class AuthError extends Error {
  constructor(message, code) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
  }
}

/** Email/password missing or malformed (bad format, wrong type, etc). */
class AuthValidationError extends AuthError {
  constructor(message = 'Please provide a valid email and password.') {
    super(message, 'invalid_input');
  }
}

/** Password doesn't meet the minimum length requirement. */
class AuthWeakPasswordError extends AuthError {
  constructor(message = 'Password must be at least 8 characters.') {
    super(message, 'weak_password');
  }
}

/** Signup with an email that's already registered. */
class AuthConflictError extends AuthError {
  constructor(message = 'An account with that email already exists.') {
    super(message, 'email_taken');
  }
}

/**
 * Login failed. Deliberately the same message/code whether the email
 * doesn't exist or the password is wrong -- never reveal which, so a caller
 * can't enumerate registered emails by trying logins.
 */
class AuthInvalidCredentialsError extends AuthError {
  constructor(message = 'Incorrect email or password.') {
    super(message, 'invalid_credentials');
  }
}

/** No valid session for the given token (missing, unknown, or expired). */
class AuthSessionError extends AuthError {
  constructor(message = 'Your session has expired. Please log in again.') {
    super(message, 'session_invalid');
  }
}

module.exports = {
  AuthError,
  AuthValidationError,
  AuthWeakPasswordError,
  AuthConflictError,
  AuthInvalidCredentialsError,
  AuthSessionError,
};
