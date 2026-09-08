const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword } = require('../server/services/auth/passwords');

test('hashPassword produces a hash that verifyPassword accepts for the correct password', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.ok(await verifyPassword('correct horse battery staple', hash));
});

test('verifyPassword rejects an incorrect password', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.equal(await verifyPassword('wrong password', hash), false);
});

test('hashing the same password twice produces different hashes (random salt)', async () => {
  const hashA = await hashPassword('same password');
  const hashB = await hashPassword('same password');
  assert.notEqual(hashA, hashB);
  assert.ok(await verifyPassword('same password', hashA));
  assert.ok(await verifyPassword('same password', hashB));
});

test('the plaintext password never appears in the stored hash', async () => {
  const hash = await hashPassword('super-secret-password-should-not-leak');
  assert.ok(!hash.includes('super-secret-password-should-not-leak'));
});
