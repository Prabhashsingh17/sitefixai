/**
 * authService.js
 * ---------------------------------------------------------------------------
 * Signup / login / logout / session-lookup business logic. Routes
 * (server/routes/authRoutes.js) never touch userStore/sessionStore directly
 * -- everything goes through here, matching how aiAnalyzer.js/fixGenerator.js
 * sit between routes and their lower-level clients.
 * ---------------------------------------------------------------------------
 */

const crypto = require('crypto');
const userStore = require('./userStore');
const sessionStore = require('./sessionStore');
const { hashPassword, verifyPassword } = require('./auth/passwords');
const {
  AuthValidationError,
  AuthWeakPasswordError,
  AuthConflictError,
  AuthInvalidCredentialsError,
} = require('./auth/errors');
const errors = require('./auth/errors');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 72; // bcrypt silently ignores bytes beyond this
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** True for both Postgres's unique_violation (23505) and SQLite's UNIQUE constraint error. */
function isUniqueConstraintError(err) {
  if (!err) return false;
  if (err.code === '23505') return true;
  return /UNIQUE constraint failed/i.test(err.message || '');
}

function validateEmail(email) {
  if (typeof email !== 'string') return null;
  const trimmed = email.trim().toLowerCase();
  if (!trimmed || trimmed.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(trimmed)) return null;
  return trimmed;
}

function isValidPasswordLength(password) {
  return typeof password === 'string' && password.length >= MIN_PASSWORD_LENGTH && password.length <= MAX_PASSWORD_LENGTH;
}

/** Never return the password hash (or anything else internal) to a caller/client. */
function toPublicUser(user) {
  return { userId: user.userId, email: user.email, createdAt: user.createdAt };
}

async function createSessionForUser(userId) {
  const sessionToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await sessionStore.createSession({ sessionId: sessionToken, userId, expiresAt });
  return { sessionToken, expiresAt };
}

/**
 * @param {{email: string, password: string}} params
 * @returns {Promise<{user: object, sessionToken: string, expiresAt: string}>}
 * @throws {AuthValidationError|AuthWeakPasswordError|AuthConflictError}
 */
async function signup({ email, password }) {
  const validEmail = validateEmail(email);
  if (!validEmail || typeof password !== 'string' || !password) {
    throw new AuthValidationError();
  }
  if (!isValidPasswordLength(password)) {
    throw new AuthWeakPasswordError();
  }

  const passwordHash = await hashPassword(password);

  let user;
  try {
    user = await userStore.createUser({ email: validEmail, passwordHash });
  } catch (err) {
    if (isUniqueConstraintError(err)) throw new AuthConflictError();
    throw err;
  }

  const { sessionToken, expiresAt } = await createSessionForUser(user.userId);
  return { user: toPublicUser(user), sessionToken, expiresAt };
}

/**
 * @param {{email: string, password: string}} params
 * @returns {Promise<{user: object, sessionToken: string, expiresAt: string}>}
 * @throws {AuthInvalidCredentialsError} Same error for "no such email" and
 *   "wrong password" -- never reveal which, to avoid email enumeration.
 */
async function login({ email, password }) {
  const validEmail = validateEmail(email);
  if (!validEmail || typeof password !== 'string' || !password) {
    throw new AuthInvalidCredentialsError();
  }

  const user = await userStore.getUserByEmail(validEmail);
  if (!user) throw new AuthInvalidCredentialsError();

  const passwordMatches = await verifyPassword(password, user.passwordHash);
  if (!passwordMatches) throw new AuthInvalidCredentialsError();

  await userStore.touchLastLogin(user.userId);
  const { sessionToken, expiresAt } = await createSessionForUser(user.userId);
  return { user: toPublicUser(user), sessionToken, expiresAt };
}

/** Idempotent -- logging out a token that's already gone is not an error. */
async function logout(sessionToken) {
  if (!sessionToken) return;
  await sessionStore.deleteSession(sessionToken);
}

/**
 * @param {string} sessionToken
 * @returns {Promise<object|null>} The public user shape, or null for any
 *   missing/invalid/expired session -- never throws, so middleware can stay
 *   fail-open for anonymous visitors.
 */
async function getUserForSession(sessionToken) {
  if (!sessionToken) return null;
  const session = await sessionStore.getSession(sessionToken);
  if (!session) return null;
  const user = await userStore.getUserById(session.userId);
  return user ? toPublicUser(user) : null;
}

module.exports = { signup, login, logout, getUserForSession, errors };
