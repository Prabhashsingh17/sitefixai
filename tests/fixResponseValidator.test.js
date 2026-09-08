const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAndValidateFix } = require('../server/services/fix/responseValidator');
const { AIValidationError } = require('../server/services/ai/errors');

function goodPayload(overrides = {}) {
  return {
    fixType: 'title',
    original: 'Old Title',
    improved: 'New Improved Title | Brand',
    reason: 'This is clearer and better sized for search results.',
    alternatives: ['Alt One', 'Alt Two'],
    ...overrides,
  };
}

test('a well-formed fix response parses cleanly', () => {
  const result = parseAndValidateFix(JSON.stringify(goodPayload()), 'title', 'Old Title');
  assert.equal(result.fixType, 'title');
  assert.equal(result.original, 'Old Title');
  assert.equal(result.improved, 'New Improved Title | Brand');
  assert.equal(result.reason.length > 0, true);
  assert.deepEqual(result.alternatives, ['Alt One', 'Alt Two']);
});

test('throws AIValidationError when the top level is not an object', () => {
  assert.throws(() => parseAndValidateFix('[]', 'title', ''), AIValidationError);
  assert.throws(() => parseAndValidateFix('null', 'title', ''), AIValidationError);
});

test('throws AIValidationError when "improved" is missing or empty', () => {
  assert.throws(() => parseAndValidateFix(JSON.stringify(goodPayload({ improved: '' })), 'title', ''), AIValidationError);
  assert.throws(() => parseAndValidateFix(JSON.stringify(goodPayload({ improved: undefined })), 'title', ''), AIValidationError);
});

test('throws AIValidationError when "reason" is missing or empty', () => {
  assert.throws(() => parseAndValidateFix(JSON.stringify(goodPayload({ reason: '' })), 'title', ''), AIValidationError);
});

test('falls back to the server-provided current value when "original" is missing', () => {
  const result = parseAndValidateFix(JSON.stringify(goodPayload({ original: undefined })), 'title', 'Server Known Title');
  assert.equal(result.original, 'Server Known Title');
});

test('falls back to the requested fix type if the model returns an invalid/mismatched one', () => {
  const result = parseAndValidateFix(JSON.stringify(goodPayload({ fixType: 'not-a-real-type' })), 'meta_description', '');
  assert.equal(result.fixType, 'meta_description');
});

test('a suggestion promising a guaranteed outcome in "improved" is rejected entirely', () => {
  assert.throws(
    () => parseAndValidateFix(JSON.stringify(goodPayload({ improved: 'This title will guarantee a #1 ranking.' })), 'title', ''),
    AIValidationError
  );
});

test('a suggestion promising a guaranteed outcome in "reason" is rejected entirely', () => {
  assert.throws(
    () => parseAndValidateFix(JSON.stringify(goodPayload({ reason: 'We guarantee 100% increase in conversions.' })), 'title', ''),
    AIValidationError
  );
});

test('individual alternatives containing guarantee language are filtered out, others kept', () => {
  const result = parseAndValidateFix(
    JSON.stringify(goodPayload({ alternatives: ['A safe alternative', 'This will guarantee first page ranking'] })),
    'title',
    ''
  );
  assert.deepEqual(result.alternatives, ['A safe alternative']);
});

test('alternatives are capped at 3 even if more are provided', () => {
  const result = parseAndValidateFix(
    JSON.stringify(goodPayload({ alternatives: ['One', 'Two', 'Three', 'Four', 'Five'] })),
    'title',
    ''
  );
  assert.equal(result.alternatives.length, 3);
});

test('a missing alternatives array results in an empty array, not a crash', () => {
  const result = parseAndValidateFix(JSON.stringify(goodPayload({ alternatives: undefined })), 'title', '');
  assert.deepEqual(result.alternatives, []);
});

test('long improved/reason text is truncated rather than rejected', () => {
  const result = parseAndValidateFix(
    JSON.stringify(goodPayload({ improved: 'x'.repeat(2000), reason: 'y'.repeat(2000) })),
    'title',
    ''
  );
  assert.ok(result.improved.length <= 1201);
  assert.ok(result.reason.length <= 601);
});

test('handles markdown-fenced JSON from the model', () => {
  const fenced = '```json\n' + JSON.stringify(goodPayload()) + '\n```';
  const result = parseAndValidateFix(fenced, 'title', '');
  assert.equal(result.improved, 'New Improved Title | Brand');
});
