/**
 * sqliteSessionRepository.js
 * ---------------------------------------------------------------------------
 * SQLite implementation of the session repository. A session's ID IS its
 * token (a crypto-random string) -- there is no separate secret, so a plain
 * primary-key lookup is the whole validation. Mirrors sqliteRepository.js.
 * ---------------------------------------------------------------------------
 */

const { getDb } = require('./connection');

function rowToSession(row) {
  if (!row) return null;
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

function createSession({ sessionId, userId, expiresAt }) {
  const db = getDb();
  const createdAt = new Date().toISOString();

  db.prepare(
    `INSERT INTO sessions (session_id, user_id, created_at, expires_at)
     VALUES (@sessionId, @userId, @createdAt, @expiresAt)`
  ).run({ sessionId, userId, createdAt, expiresAt });

  return getSession(sessionId);
}

/** Returns null for a missing OR expired session -- callers never need to separately check expiry. */
function getSession(sessionId) {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM sessions WHERE session_id = ? AND expires_at > ?')
    .get(sessionId, new Date().toISOString());
  return rowToSession(row);
}

function deleteSession(sessionId) {
  const db = getDb();
  db.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId);
}

module.exports = { createSession, getSession, deleteSession };
