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
`;

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
