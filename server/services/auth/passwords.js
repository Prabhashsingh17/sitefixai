/**
 * passwords.js
 * ---------------------------------------------------------------------------
 * Isolates the bcryptjs calls so authService.js never touches the hashing
 * library directly -- mirrors how server/services/ai/claudeClient.js isolates
 * the one place that calls fetch().
 *
 * bcryptjs (pure JS) is used instead of native bcrypt/argon2 so this doesn't
 * add a second native-module build dependency alongside better-sqlite3,
 * which already fails to compile on this project's Windows dev machine
 * without Visual Studio Build Tools installed.
 * ---------------------------------------------------------------------------
 */

const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 10;

/** @param {string} plain @returns {Promise<string>} */
function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

/** @param {string} plain @param {string} hash @returns {Promise<boolean>} */
function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

module.exports = { hashPassword, verifyPassword };
