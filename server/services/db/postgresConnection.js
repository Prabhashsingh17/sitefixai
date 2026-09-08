/**
 * postgresConnection.js
 * ---------------------------------------------------------------------------
 * Opens (and, on first use, schema-creates) the Postgres connection pool used
 * for users/sessions when DATABASE_URL is configured (see db/index.js for the
 * SQLite-vs-Postgres switch). Only users/sessions live here -- scans stay on
 * SQLite for now (see db/index.js's doc comment for why).
 *
 * Unlike better-sqlite3, `pg` is fully async -- there is no synchronous
 * equivalent of getDb() here, only getPool(), which every repository
 * function awaits before running a query.
 * ---------------------------------------------------------------------------
 */

const { Pool } = require('pg');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    user_id             TEXT PRIMARY KEY,
    email               TEXT NOT NULL UNIQUE,
    password_hash       TEXT NOT NULL,
    created_at          TEXT NOT NULL,
    last_login_at       TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    session_id          TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL REFERENCES users(user_id),
    created_at          TEXT NOT NULL,
    expires_at          TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
`;

let cachedPool = null;
let schemaReadyPromise = null;

function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not configured.');
  }
  // Neon (and most hosted Postgres providers) require SSL but present a
  // certificate chain that Node's default trust store doesn't always
  // validate cleanly -- rejectUnauthorized:false is the standard, documented
  // workaround these providers themselves recommend for this exact case.
  return new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
}

/** Returns the shared pool, creating it (and its schema) on first call. */
async function getPool() {
  if (!cachedPool) {
    cachedPool = createPool();
  }
  if (!schemaReadyPromise) {
    schemaReadyPromise = cachedPool.query(SCHEMA);
  }
  await schemaReadyPromise;
  return cachedPool;
}

/** Closes the pool. Used by tests between runs; the running server never needs this. */
async function closePool() {
  if (cachedPool) {
    await cachedPool.end();
    cachedPool = null;
    schemaReadyPromise = null;
  }
}

module.exports = { getPool, closePool };
