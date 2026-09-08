/**
 * sqliteUserRepository.js
 * ---------------------------------------------------------------------------
 * SQLite implementation of the user repository. Returns the SAME plain-JS
 * "User" shape (including passwordHash) regardless of backend -- it's the
 * service layer (server/services/authService.js), not the repository, that
 * decides what's safe to expose to a route/client. Mirrors sqliteRepository.js.
 * ---------------------------------------------------------------------------
 */

const crypto = require('crypto');
const { getDb } = require('./connection');

function rowToUser(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    email: row.email,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

function createUser({ email, passwordHash }) {
  const db = getDb();
  const userId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  db.prepare(
    `INSERT INTO users (user_id, email, password_hash, created_at)
     VALUES (@userId, @email, @passwordHash, @createdAt)`
  ).run({ userId, email, passwordHash, createdAt });

  return getUserById(userId);
}

function getUserByEmail(email) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email);
  return rowToUser(row);
}

function getUserById(userId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
  return rowToUser(row);
}

function touchLastLogin(userId) {
  const db = getDb();
  db.prepare('UPDATE users SET last_login_at = ? WHERE user_id = ?').run(new Date().toISOString(), userId);
}

module.exports = { createUser, getUserByEmail, getUserById, touchLastLogin };
