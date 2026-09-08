/**
 * connection.js
 * ---------------------------------------------------------------------------
 * Opens (and, on first run, creates) the SQLite database file used to
 * persist scan history. This is the only file in the project that knows
 * the on-disk location or the raw schema -- everything else talks to
 * server/services/db/sqliteRepository.js, which speaks in plain JS objects.
 *
 * The database file lives in <project root>/data/sitefix.db by default,
 * override-able via SQLITE_DB_PATH (tests use this to point at ':memory:'
 * so they never touch the real file). The data/ directory is gitignored --
 * this file only ever stores scan results, audit findings, and AI
 * recommendations for THIS app's own scans. It never stores API keys or
 * any other secret; there is no column for one, and nothing in
 * scanRepository.js ever writes process.env values into a row.
 * ---------------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DEFAULT_DB_PATH = path.join(__dirname, '..', '..', '..', 'data', 'sitefix.db');

function resolveDbPath() {
  return process.env.SQLITE_DB_PATH || DEFAULT_DB_PATH;
}

function ensureDataDirExists(dbPath) {
  if (dbPath === ':memory:') return;
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS scans (
    scan_id             TEXT PRIMARY KEY,
    url                 TEXT NOT NULL,
    status              TEXT NOT NULL,
    created_at          TEXT NOT NULL,
    completed_at        TEXT,
    overall_score       INTEGER,
    category_scores     TEXT,
    scan_data           TEXT,
    findings            TEXT,
    audit_summary       TEXT,
    ai_recommendations  TEXT,
    error               TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_scans_created_at ON scans(created_at DESC);

  CREATE TABLE IF NOT EXISTS users (
    user_id             TEXT PRIMARY KEY,
    email               TEXT NOT NULL UNIQUE COLLATE NOCASE,
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

/**
 * `scans.user_id` was added after the table already shipped in production,
 * so it can't just live in the CREATE TABLE above (IF NOT EXISTS won't
 * retroactively add a column to an existing table). SQLite has no
 * `ADD COLUMN IF NOT EXISTS`, so this runs the ALTER and swallows the one
 * expected failure (the column already existing) rather than adding a
 * migration framework for a single column.
 *
 * Deliberately NOT a `REFERENCES users(user_id)` foreign key: when
 * DATABASE_URL is set, real users live in Postgres while scans stay here in
 * SQLite (see db/index.js) -- a cross-database foreign key can't be
 * enforced, and this local `users` table would then be an unused fallback,
 * not where the referenced row actually lives. This column is an
 * application-level reference only.
 */
function ensureScansUserIdColumn(db) {
  try {
    db.exec('ALTER TABLE scans ADD COLUMN user_id TEXT');
  } catch (err) {
    if (!/duplicate column/i.test(err.message)) throw err;
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_scans_user_id ON scans(user_id)');
}

let cachedDb = null;
let cachedDbPath = null;

/**
 * Returns the shared better-sqlite3 database handle, opening (and migrating)
 * it on first call. Re-opens if SQLITE_DB_PATH has changed since the last
 * call -- this only matters for tests, which swap the path between runs.
 */
function getDb() {
  const dbPath = resolveDbPath();
  if (cachedDb && cachedDbPath === dbPath) {
    return cachedDb;
  }

  if (cachedDb) {
    cachedDb.close();
  }

  ensureDataDirExists(dbPath);
  cachedDb = new Database(dbPath);
  cachedDb.pragma('journal_mode = WAL');
  cachedDb.exec(SCHEMA);
  ensureScansUserIdColumn(cachedDb);
  cachedDbPath = dbPath;
  return cachedDb;
}

/** Closes the current connection. Used by tests between runs; the running
 * server never needs to call this. */
function closeDb() {
  if (cachedDb) {
    cachedDb.close();
    cachedDb = null;
    cachedDbPath = null;
  }
}

module.exports = { getDb, closeDb, resolveDbPath };
