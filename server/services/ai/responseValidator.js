/**
 * responseValidator.js
 * ---------------------------------------------------------------------------
 * Safely parses and validates the JSON Claude returns.
 *
 * Two layers of defense:
 *   1. Structural validation — every recommendation must have all seven
 *      required string fields and valid category/priority enum values, or
 *      it is dropped rather than passed through malformed. Index arrays
 *      (topImprovementIndexes etc.) are remapped against the filtered
 *      list so they never point at a dropped or nonexistent entry.
 *   2. Content safety — even though the prompt instructs Claude never to
 *      guarantee rankings/traffic/conversions, this is enforced again here:
 *      any recommendation containing guarantee-style language is dropped,
 *      and the executive summary is replaced with a safe, fact-based
 *      fallback if it slips through with such language.
 * ---------------------------------------------------------------------------
 */

const { AIValidationError } = require('./errors');
const { parseJson } = require('./jsonUtils');
const { VALID_CATEGORIES, truncate } = require('./promptBuilder');

const VALID_PRIORITIES = ['high', 'medium', 'low'];
const MAX_RECOMMENDATIONS = 30;
const MAX_TOP_IMPROVEMENTS = 5;
const MAX_QUICK_WINS = 15;
const MAX_LONG_TERM = 15;

const REQUIRED_RECOMMENDATION_FIELDS = [
  'category', 'priority', 'problem', 'whyItMatters', 'recommendedFix', 'example', 'expectedImpact',
];

// Defense-in-depth against the model promising guaranteed outcomes, even
// though the prompt already instructs it not to.
const GUARANTEE_LANGUAGE_PATTERN =
  /\bguarantee(d|s)?\b|\b100%\s*(increase|improvement|guaranteed)\b|\bwill\s+(definitely|certainly)\b|#\s*1\s*(ranking|position|spot)|\brank(ing)?\s+(number\s*1|first)\b/i;

/**
 * Strips a ```json ... ``` or ``` ... ``` fence if present, since models
 * sometimes wrap JSON in markdown even when told not to.
 * @deprecated re-exported from jsonUtils for backwards compatibility; new
 * code should import stripCodeFences from ./jsonUtils directly.
 */
function stripCodeFences(text) {
  return require('./jsonUtils').stripCodeFences(text);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function containsGuaranteeLanguage(recommendation) {
  return REQUIRED_RECOMMENDATION_FIELDS.some(
    (key) => isNonEmptyString(recommendation[key]) && GUARANTEE_LANGUAGE_PATTERN.test(recommendation[key])
  );
}

/**
 * Validates and cleans one recommendation object. Returns null (meaning
 * "drop this entry") rather than throwing, so a handful of malformed items
 * from the model don't invalidate an otherwise-good response.
 */
function validateRecommendation(item) {
  if (!item || typeof item !== 'object') return null;

  for (const field of REQUIRED_RECOMMENDATION_FIELDS) {
    if (!isNonEmptyString(item[field])) return null;
  }

  const category = item.category.trim().toLowerCase();
  if (!VALID_CATEGORIES.includes(category)) return null;

  const priority = item.priority.trim().toLowerCase();
  if (!VALID_PRIORITIES.includes(priority)) return null;

  const cleaned = {
    category,
    priority,
    problem: truncate(item.problem.trim(), 500),
    whyItMatters: truncate(item.whyItMatters.trim(), 500),
    recommendedFix: truncate(item.recommendedFix.trim(), 500),
    example: truncate(item.example.trim(), 500),
    expectedImpact: truncate(item.expectedImpact.trim(), 400),
  };

  if (containsGuaranteeLanguage(cleaned)) return null;

  return cleaned;
}

function remapIndexes(rawIndexes, indexMap, maxCount) {
  if (!Array.isArray(rawIndexes)) return [];
  const seen = new Set();
  const result = [];
  for (const rawIdx of rawIndexes) {
    if (typeof rawIdx !== 'number' || !Number.isInteger(rawIdx)) continue;
    if (!indexMap.has(rawIdx)) continue;
    const mapped = indexMap.get(rawIdx);
    if (seen.has(mapped)) continue;
    seen.add(mapped);
    result.push(mapped);
    if (result.length >= maxCount) break;
  }
  return result;
}

function safeFallbackSummary(facts) {
  const critical = facts.findings.filter((f) => f.severity === 'critical').length;
  const warning = facts.findings.filter((f) => f.severity === 'warning').length;
  return (
    `This audit found ${critical} critical issue(s) and ${warning} warning(s) ` +
    `across the checks performed. See the recommendations below for details.`
  );
}

/**
 * Parse and fully validate Claude's raw response text into the final,
 * client-safe analysis shape.
 *
 * @param {string} rawText Raw text content from the Claude API response.
 * @param {object} facts The same facts object sent to Claude (used only for
 *   the safe fallback summary if the model's summary must be discarded).
 * @returns {{ executiveSummary: string, recommendations: object[], topImprovements: object[], quickWins: object[], longTermImprovements: object[] }}
 * @throws {AIParseError|AIValidationError}
 */
function parseAndValidate(rawText, facts) {
  const parsed = parseJson(rawText);

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AIValidationError();
  }

  if (!Array.isArray(parsed.recommendations)) {
    throw new AIValidationError('The AI analysis did not include a recommendations list.');
  }

  const cleanedRecommendations = [];
  const indexMap = new Map(); // original index -> cleaned index
  for (let originalIndex = 0; originalIndex < parsed.recommendations.length; originalIndex += 1) {
    if (cleanedRecommendations.length >= MAX_RECOMMENDATIONS) break;
    const cleaned = validateRecommendation(parsed.recommendations[originalIndex]);
    if (cleaned) {
      indexMap.set(originalIndex, cleanedRecommendations.length);
      cleanedRecommendations.push(cleaned);
    }
  }
  const finalRecommendations = cleanedRecommendations;

  let executiveSummary = isNonEmptyString(parsed.executiveSummary)
    ? truncate(parsed.executiveSummary.trim(), 800)
    : null;
  if (!executiveSummary || GUARANTEE_LANGUAGE_PATTERN.test(executiveSummary)) {
    executiveSummary = safeFallbackSummary(facts);
  }

  const topIndexes = remapIndexes(parsed.topImprovementIndexes, indexMap, MAX_TOP_IMPROVEMENTS);
  const quickWinIndexes = remapIndexes(parsed.quickWinIndexes, indexMap, MAX_QUICK_WINS);
  const longTermIndexes = remapIndexes(parsed.longTermIndexes, indexMap, MAX_LONG_TERM);

  return {
    executiveSummary,
    recommendations: finalRecommendations,
    topImprovements: topIndexes.map((i) => finalRecommendations[i]),
    quickWins: quickWinIndexes.map((i) => finalRecommendations[i]),
    longTermImprovements: longTermIndexes.map((i) => finalRecommendations[i]),
  };
}

module.exports = {
  parseAndValidate,
  parseJson,
  validateRecommendation,
  stripCodeFences,
};
