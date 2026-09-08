const test = require('node:test');
const assert = require('node:assert/strict');

// Force an in-memory SQLite database for every test in this file, and make
// sure DATABASE_URL is unset so db/index.js picks the SQLite user/session
// repositories rather than trying to reach a real Postgres instance.
process.env.SQLITE_DB_PATH = ':memory:';
delete process.env.DATABASE_URL;

const { closeDb } = require('../server/services/db/connection');
const authService = require('../server/services/authService');
const {
  AuthValidationError,
  AuthWeakPasswordError,
  AuthConflictError,
  AuthInvalidCredentialsError,
} = require('../server/services/auth/errors');

// A fresh in-memory DB per test -- closeDb() forces the next getDb() call to
// open a brand new (empty) ':memory:' database, giving full isolation.
test.beforeEach(() => {
  closeDb();
});

test.after(() => {
  closeDb();
});

test('signup creates a user and an active session', async () => {
  const { user, sessionToken, expiresAt } = await authService.signup({
    email: 'new@example.com',
    password: 'a-good-password',
  });

  assert.equal(user.email, 'new@example.com');
  assert.ok(user.userId);
  assert.ok(user.createdAt);
  assert.ok(sessionToken);
  assert.ok(expiresAt);

  const sessionUser = await authService.getUserForSession(sessionToken);
  assert.equal(sessionUser.userId, user.userId);
});

test('the public user shape never includes the password hash', async () => {
  const { user } = await authService.signup({ email: 'safe@example.com', password: 'a-good-password' });
  assert.equal('passwordHash' in user, false);
  assert.ok(!JSON.stringify(user).toLowerCase().includes('hash'));
});

test('signup rejects an invalid email', async () => {
  await assert.rejects(
    () => authService.signup({ email: 'not-an-email', password: 'a-good-password' }),
    AuthValidationError
  );
});

test('signup rejects a missing password', async () => {
  await assert.rejects(() => authService.signup({ email: 'a@example.com', password: '' }), AuthValidationError);
});

test('signup rejects a password shorter than 8 characters', async () => {
  await assert.rejects(
    () => authService.signup({ email: 'a@example.com', password: 'short' }),
    AuthWeakPasswordError
  );
});

test('signup rejects a duplicate email (case-insensitive) with AuthConflictError', async () => {
  await authService.signup({ email: 'dup@example.com', password: 'a-good-password' });
  await assert.rejects(
    () => authService.signup({ email: 'DUP@example.com', password: 'another-password' }),
    AuthConflictError
  );
});

test('login succeeds with correct credentials and returns a working session', async () => {
  await authService.signup({ email: 'user@example.com', password: 'the-real-password' });

  const { user, sessionToken } = await authService.login({ email: 'user@example.com', password: 'the-real-password' });
  assert.equal(user.email, 'user@example.com');

  const sessionUser = await authService.getUserForSession(sessionToken);
  assert.equal(sessionUser.userId, user.userId);
});

test('login is case-insensitive on email', async () => {
  await authService.signup({ email: 'Case@Example.com', password: 'the-real-password' });
  const { user } = await authService.login({ email: 'case@example.com', password: 'the-real-password' });
  assert.ok(user);
});

test('login fails with the same error/message for a wrong password and a nonexistent email (no enumeration)', async () => {
  await authService.signup({ email: 'exists@example.com', password: 'the-real-password' });

  let wrongPasswordErr;
  try {
    await authService.login({ email: 'exists@example.com', password: 'wrong-password' });
  } catch (err) {
    wrongPasswordErr = err;
  }

  let noSuchEmailErr;
  try {
    await authService.login({ email: 'nobody@example.com', password: 'anything' });
  } catch (err) {
    noSuchEmailErr = err;
  }

  assert.ok(wrongPasswordErr instanceof AuthInvalidCredentialsError);
  assert.ok(noSuchEmailErr instanceof AuthInvalidCredentialsError);
  assert.equal(wrongPasswordErr.message, noSuchEmailErr.message);
  assert.equal(wrongPasswordErr.code, noSuchEmailErr.code);
});

test('logout deletes the session -- a subsequent lookup returns null', async () => {
  const { sessionToken } = await authService.signup({ email: 'logout@example.com', password: 'a-good-password' });
  assert.ok(await authService.getUserForSession(sessionToken));

  await authService.logout(sessionToken);
  assert.equal(await authService.getUserForSession(sessionToken), null);
});

test('logout on an already-invalid token does not throw (idempotent)', async () => {
  await assert.doesNotReject(() => authService.logout('not-a-real-token'));
  await assert.doesNotReject(() => authService.logout(null));
});

test('getUserForSession returns null (not throw) for a garbage token', async () => {
  assert.equal(await authService.getUserForSession('garbage'), null);
  assert.equal(await authService.getUserForSession(null), null);
});

test('getUserForSession returns null for an expired session', async () => {
  const { user } = await authService.signup({ email: 'expired@example.com', password: 'a-good-password' });

  // Insert an already-expired session directly via the repository, bypassing
  // authService's own (30-day-future) expiry to simulate time having passed.
  const sessionStore = require('../server/services/sessionStore');
  const expiredToken = 'expired-token-for-test';
  await sessionStore.createSession({
    sessionId: expiredToken,
    userId: user.userId,
    expiresAt: new Date(Date.now() - 1000).toISOString(),
  });

  assert.equal(await authService.getUserForSession(expiredToken), null);
});
