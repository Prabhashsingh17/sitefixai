/**
 * sessionStore.js
 * ---------------------------------------------------------------------------
 * Public API the rest of the app uses for session persistence -- a thin
 * pass-through to server/services/db/, exactly like scanStore.js/userStore.js.
 * See userStore.js's header comment for why every function is `async`.
 *
 * Session shape: { sessionId, userId, createdAt, expiresAt }
 * A session's ID IS its token (the cookie value) -- there is no separate
 * secret to validate.
 * ---------------------------------------------------------------------------
 */

const db = require('./db');

async function createSession(params) {
  return db.sessions.createSession(params);
}

async function getSession(sessionId) {
  return db.sessions.getSession(sessionId);
}

async function deleteSession(sessionId) {
  return db.sessions.deleteSession(sessionId);
}

module.exports = { createSession, getSession, deleteSession };
