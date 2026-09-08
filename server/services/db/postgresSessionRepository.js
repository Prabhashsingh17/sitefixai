/**
 * postgresSessionRepository.js
 * ---------------------------------------------------------------------------
 * Postgres implementation of the session repository. Mirrors
 * sqliteSessionRepository.js's shape/contract exactly, just async.
 * ---------------------------------------------------------------------------
 */

const { getPool } = require('./postgresConnection');

function rowToSession(row) {
  if (!row) return null;
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

async function createSession({ sessionId, userId, expiresAt }) {
  const pool = await getPool();
  const createdAt = new Date().toISOString();

  await pool.query(
    `INSERT INTO sessions (session_id, user_id, created_at, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [sessionId, userId, createdAt, expiresAt]
  );

  return getSession(sessionId);
}

/** Returns null for a missing OR expired session -- callers never need to separately check expiry. */
async function getSession(sessionId) {
  const pool = await getPool();
  const result = await pool.query(
    'SELECT * FROM sessions WHERE session_id = $1 AND expires_at > $2',
    [sessionId, new Date().toISOString()]
  );
  return rowToSession(result.rows[0]);
}

async function deleteSession(sessionId) {
  const pool = await getPool();
  await pool.query('DELETE FROM sessions WHERE session_id = $1', [sessionId]);
}

module.exports = { createSession, getSession, deleteSession };
