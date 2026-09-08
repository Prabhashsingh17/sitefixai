const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SQLITE_DB_PATH = ':memory:';
delete process.env.DATABASE_URL;

const { closeDb } = require('../server/services/db/connection');
const authService = require('../server/services/authService');
const { sessionMiddleware, getSessionTokenFromRequest, COOKIE_NAME } = require('../server/middleware/session');

test.beforeEach(() => {
  closeDb();
});

test.after(() => {
  closeDb();
});

function fakeReqWithCookie(cookieHeader) {
  return { headers: cookieHeader ? { cookie: cookieHeader } : {} };
}

function fakeRes() {
  return { headers: {}, setHeader(name, value) { this.headers[name] = value; } };
}

test('getSessionTokenFromRequest returns null when there is no cookie header', () => {
  assert.equal(getSessionTokenFromRequest(fakeReqWithCookie(null)), null);
});

test('getSessionTokenFromRequest extracts the session cookie by name among others', () => {
  const req = fakeReqWithCookie(`other=1; ${COOKIE_NAME}=abc123; another=2`);
  assert.equal(getSessionTokenFromRequest(req), 'abc123');
});

test('sessionMiddleware sets req.user = null and calls next() when there is no cookie', async () => {
  const req = fakeReqWithCookie(null);
  let nextCalled = false;

  await sessionMiddleware(req, fakeRes(), () => {
    nextCalled = true;
  });

  assert.equal(req.user, null);
  assert.equal(nextCalled, true);
});

test('sessionMiddleware populates req.user for a valid session cookie', async () => {
  const { sessionToken, user } = await authService.signup({ email: 'mw@example.com', password: 'a-good-password' });
  const req = fakeReqWithCookie(`${COOKIE_NAME}=${sessionToken}`);
  let nextCalled = false;

  await sessionMiddleware(req, fakeRes(), () => {
    nextCalled = true;
  });

  assert.equal(req.user.userId, user.userId);
  assert.equal(nextCalled, true);
});

test('sessionMiddleware fails open (req.user = null, next() still called) for a garbage cookie', async () => {
  const req = fakeReqWithCookie(`${COOKIE_NAME}=not-a-real-token`);
  let nextCalled = false;

  await sessionMiddleware(req, fakeRes(), () => {
    nextCalled = true;
  });

  assert.equal(req.user, null);
  assert.equal(nextCalled, true);
});
