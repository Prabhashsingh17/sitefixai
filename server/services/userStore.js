/**
 * userStore.js
 * ---------------------------------------------------------------------------
 * Public API the rest of the app uses for user persistence -- a thin
 * pass-through to server/services/db/ (see db/index.js for the SQLite-vs-
 * Postgres switch), exactly like scanStore.js.
 *
 * Every function here is declared `async` even though the SQLite backend's
 * functions are synchronous -- this way authService.js can always `await`
 * these calls regardless of which backend is active (an `async function`
 * that returns a plain value still resolves to that value when awaited).
 *
 * User shape: { userId, email, passwordHash, createdAt, lastLoginAt }
 * `passwordHash` is only ever read by server/services/authService.js -- it
 * must never be included in anything sent to a client.
 * ---------------------------------------------------------------------------
 */

const db = require('./db');

async function createUser(params) {
  return db.users.createUser(params);
}

async function getUserByEmail(email) {
  return db.users.getUserByEmail(email);
}

async function getUserById(userId) {
  return db.users.getUserById(userId);
}

async function touchLastLogin(userId) {
  return db.users.touchLastLogin(userId);
}

module.exports = { createUser, getUserByEmail, getUserById, touchLastLogin };
