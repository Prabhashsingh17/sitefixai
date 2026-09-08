/**
 * postgresUserRepository.js
 * ---------------------------------------------------------------------------
 * Postgres implementation of the user repository -- same plain-JS "User"
 * shape as sqliteUserRepository.js (see that file for the shape contract),
 * just async since `pg` has no synchronous query API.
 * ---------------------------------------------------------------------------
 */

const crypto = require('crypto');
const { getPool } = require('./postgresConnection');

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

async function createUser({ email, passwordHash }) {
  const pool = await getPool();
  const userId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  await pool.query(
    `INSERT INTO users (user_id, email, password_hash, created_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, email, passwordHash, createdAt]
  );

  return getUserById(userId);
}

async function getUserByEmail(email) {
  const pool = await getPool();
  const result = await pool.query('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
  return rowToUser(result.rows[0]);
}

async function getUserById(userId) {
  const pool = await getPool();
  const result = await pool.query('SELECT * FROM users WHERE user_id = $1', [userId]);
  return rowToUser(result.rows[0]);
}

async function touchLastLogin(userId) {
  const pool = await getPool();
  await pool.query('UPDATE users SET last_login_at = $1 WHERE user_id = $2', [new Date().toISOString(), userId]);
}

module.exports = { createUser, getUserByEmail, getUserById, touchLastLogin };
