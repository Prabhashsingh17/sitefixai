const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAndValidate, parseJson, stripCodeFences } = require('../server/services/ai/responseValidator');
const { AIParseError, AIValidationError } = require('../server/services/ai/errors');

const sampleFacts = {
  findings: [
    { category: 'seo', severity: 'critical', title: 'Missing title', evidence: 'no title' },
    { category: 'mobile', severity: 'warning', title: 'Viewport issue', evidence: 'bad viewport' },
  ],
};

function goodRecommendation(overrides = {}) {
  return {
    category: 'seo',
    priority: 'high',
    problem: 'The page has no title tag.',
    whyItMatters: 'Search engines rely on titles to understand page topic.',
    recommendedFix: 'Add a descriptive <title> tag.',
    example: '<title>Best Widgets Online | Fast Shipping</title>',
    expectedImpact: 'This can help search engines and users understand the page better.',
    ...overrides,
  };
}

// =============================================================================
// stripCodeFences / parseJson
// =============================================================================
test('stripCodeFences removes ```json fences when present', () => {
  const wrapped = '```json\n{"a":1}\n```';
  assert.equal(stripCodeFences(wrapped), '{"a":1}');
});

test('stripCodeFences removes plain ``` fences when present', () => {
  const wrapped = '```\n{"a":1}\n```';
  assert.equal(stripCodeFences(wrapped), '{"a":1}');
});

test('stripCodeFences leaves unwrapped JSON untouched', () => {
  assert.equal(stripCodeFences('{"a":1}'), '{"a":1}');
});

test('parseJson throws AIParseError on empty or non-string input', () => {
  assert.throws(() => parseJson(''), AIParseError);
  assert.throws(() => parseJson(null), AIParseError);
  assert.throws(() => parseJson(undefined), AIParseError);
});

test('parseJson throws AIParseError on syntactically invalid JSON', () => {
  assert.throws(() => parseJson('{not valid json'), AIParseError);
});

test('parseJson successfully parses fenced JSON', () => {
  const parsed = parseJson('```json\n{"executiveSummary":"hi","recommendations":[]}\n```');
  assert.equal(parsed.executiveSummary, 'hi');
});

// =============================================================================
// parseAndValidate — structural validation
// =============================================================================
test('parseAndValidate throws AIValidationError when the top level is not an object', () => {
  assert.throws(() => parseAndValidate('[]', sampleFacts), AIValidationError);
  assert.throws(() => parseAndValidate('null', sampleFacts), AIValidationError);
  assert.throws(() => parseAndValidate('"just a string"', sampleFacts), AIValidationError);
});

test('parseAndValidate throws AIValidationError when "recommendations" is missing or not an array', () => {
  assert.throws(() => parseAndValidate(JSON.stringify({ executiveSummary: 'hi' }), sampleFacts), AIValidationError);
  assert.throws(
    () => parseAndValidate(JSON.stringify({ executiveSummary: 'hi', recommendations: 'nope' }), sampleFacts),
    AIValidationError
  );
});

test('a well-formed response parses cleanly with all fields intact', () => {
  const payload = {
    executiveSummary: 'This page has several fixable SEO and mobile issues.',
    recommendations: [goodRecommendation()],
    topImprovementIndexes: [0],
    quickWinIndexes: [0],
    longTermIndexes: [],
  };
  const result = parseAndValidate(JSON.stringify(payload), sampleFacts);

  assert.equal(result.executiveSummary, payload.executiveSummary);
  assert.equal(result.recommendations.length, 1);
  assert.equal(result.recommendations[0].category, 'seo');
  assert.equal(result.topImprovements.length, 1);
  assert.equal(result.topImprovements[0].problem, payload.recommendations[0].problem);
  assert.equal(result.quickWins.length, 1);
  assert.equal(result.longTermImprovements.length, 0);
});

// =============================================================================
// Individual recommendation filtering
// =============================================================================
test('a recommendation missing a required field is dropped, valid ones are kept', () => {
  const payload = {
    executiveSummary: 'Summary text.',
    recommendations: [
      goodRecommendation({ problem: undefined }), // missing field -> dropped
      goodRecommendation({ category: 'content' }), // valid -> kept
    ],
  };
  const result = parseAndValidate(JSON.stringify(payload), sampleFacts);
  assert.equal(result.recommendations.length, 1);
  assert.equal(result.recommendations[0].category, 'content');
});

test('a recommendation with an invalid category is dropped', () => {
  const payload = {
    executiveSummary: 'Summary text.',
    recommendations: [goodRecommendation({ category: 'not-a-real-category' })],
  };
  const result = parseAndValidate(JSON.stringify(payload), sampleFacts);
  assert.equal(result.recommendations.length, 0);
});

test('a recommendation with an invalid priority is dropped', () => {
  const payload = {
    executiveSummary: 'Summary text.',
    recommendations: [goodRecommendation({ priority: 'urgent' })],
  };
  const result = parseAndValidate(JSON.stringify(payload), sampleFacts);
  assert.equal(result.recommendations.length, 0);
});

test('category and priority are case-normalized to lowercase', () => {
  const payload = {
    executiveSummary: 'Summary text.',
    recommendations: [goodRecommendation({ category: 'SEO', priority: 'HIGH' })],
  };
  const result = parseAndValidate(JSON.stringify(payload), sampleFacts);
  assert.equal(result.recommendations[0].category, 'seo');
  assert.equal(result.recommendations[0].priority, 'high');
});

test('an empty recommendations array is valid (not an error) -- no forced content', () => {
  const payload = { executiveSummary: 'Nothing actionable was found.', recommendations: [] };
  const result = parseAndValidate(JSON.stringify(payload), sampleFacts);
  assert.deepEqual(result.recommendations, []);
});

// =============================================================================
// Guarantee-language safety net (defense in depth beyond the prompt)
// =============================================================================
test('a recommendation promising a guaranteed outcome is dropped entirely', () => {
  const payload = {
    executiveSummary: 'Summary text.',
    recommendations: [
      goodRecommendation({ expectedImpact: 'This will guarantee a #1 ranking on Google within a week.' }),
      goodRecommendation({ category: 'mobile' }), // clean one, should survive
    ],
  };
  const result = parseAndValidate(JSON.stringify(payload), sampleFacts);
  assert.equal(result.recommendations.length, 1);
  assert.equal(result.recommendations[0].category, 'mobile');
});

test('guarantee language anywhere in a recommendation field (not just expectedImpact) is caught', () => {
  const payload = {
    executiveSummary: 'Summary text.',
    recommendations: [goodRecommendation({ recommendedFix: 'Do this and we guarantee 100% increase in sales.' })],
  };
  const result = parseAndValidate(JSON.stringify(payload), sampleFacts);
  assert.equal(result.recommendations.length, 0);
});

test('executiveSummary containing guarantee language is replaced with a safe fallback', () => {
  const payload = {
    executiveSummary: 'Following these steps will guarantee a #1 ranking position.',
    recommendations: [goodRecommendation()],
  };
  const result = parseAndValidate(JSON.stringify(payload), sampleFacts);
  assert.notEqual(result.executiveSummary, payload.executiveSummary);
  assert.ok(!/guarantee/i.test(result.executiveSummary));
  assert.ok(result.executiveSummary.length > 0);
});

test('a missing or empty executiveSummary falls back to a safe generated one', () => {
  const payload = { executiveSummary: '', recommendations: [goodRecommendation()] };
  const result = parseAndValidate(JSON.stringify(payload), sampleFacts);
  assert.ok(result.executiveSummary.length > 0);
});

// =============================================================================
// Index remapping (topImprovements / quickWins / longTermImprovements)
// =============================================================================
test('index arrays are remapped correctly when earlier items get dropped', () => {
  const payload = {
    executiveSummary: 'Summary.',
    recommendations: [
      goodRecommendation({ category: 'not-valid' }), // index 0 -> dropped
      goodRecommendation({ category: 'seo' }), // index 1 -> becomes cleaned index 0
      goodRecommendation({ category: 'mobile' }), // index 2 -> becomes cleaned index 1
    ],
    topImprovementIndexes: [2, 1], // originally referring to mobile, seo
  };
  const result = parseAndValidate(JSON.stringify(payload), sampleFacts);
  assert.equal(result.recommendations.length, 2);
  assert.equal(result.topImprovements.length, 2);
  assert.equal(result.topImprovements[0].category, 'mobile');
  assert.equal(result.topImprovements[1].category, 'seo');
});

test('index arrays silently drop indexes pointing at a dropped recommendation', () => {
  const payload = {
    executiveSummary: 'Summary.',
    recommendations: [
      goodRecommendation({ priority: 'not-valid' }), // index 0 -> dropped
      goodRecommendation({ category: 'seo' }), // index 1 -> cleaned index 0
    ],
    topImprovementIndexes: [0, 1], // index 0 points at the dropped item
  };
  const result = parseAndValidate(JSON.stringify(payload), sampleFacts);
  assert.equal(result.topImprovements.length, 1);
  assert.equal(result.topImprovements[0].category, 'seo');
});

test('non-integer, out-of-range, and duplicate indexes are all filtered out', () => {
  const payload = {
    executiveSummary: 'Summary.',
    recommendations: [goodRecommendation()],
    topImprovementIndexes: [0, 0, 0.5, 99, 'zero', null],
  };
  const result = parseAndValidate(JSON.stringify(payload), sampleFacts);
  assert.equal(result.topImprovements.length, 1); // only the single valid, deduped index 0
});

test('topImprovementIndexes is capped at 5 entries even if more are provided', () => {
  const recs = Array.from({ length: 8 }, () => goodRecommendation());
  const payload = {
    executiveSummary: 'Summary.',
    recommendations: recs,
    topImprovementIndexes: [0, 1, 2, 3, 4, 5, 6, 7],
  };
  const result = parseAndValidate(JSON.stringify(payload), sampleFacts);
  assert.equal(result.topImprovements.length, 5);
});

test('a missing index array (e.g. quickWinIndexes absent) results in an empty array, not a crash', () => {
  const payload = { executiveSummary: 'Summary.', recommendations: [goodRecommendation()] };
  const result = parseAndValidate(JSON.stringify(payload), sampleFacts);
  assert.deepEqual(result.quickWins, []);
  assert.deepEqual(result.longTermImprovements, []);
});
