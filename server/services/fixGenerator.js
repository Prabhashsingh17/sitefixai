/**
 * fixGenerator.js
 * ---------------------------------------------------------------------------
 * The "Fix with AI" service. Given an already-verified finding and a fix
 * type, generates one AI-suggested content fix grounded in the real scan
 * data for that page.
 *
 * This service NEVER modifies anything on the customer's website -- it only
 * returns a suggestion for the user to review, copy, and apply themselves
 * (see POST /api/fix/generate in server/routes/fixRoutes.js, and the
 * dashboard's fix modal in public/js/dashboard.js).
 *
 * Trust boundary: this function assumes `finding` has already been verified
 * by the caller to be a real, stored finding (not client-supplied fiction),
 * and that `imageSrc` (for alt_text fixes) has already been verified to be
 * a real detected image path. See fixRoutes.js for those checks -- this
 * file focuses purely on prompt construction, the Claude call, and response
 * validation.
 * ---------------------------------------------------------------------------
 */

const { callClaude } = require('./ai/claudeClient');
const {
  FIX_TYPES,
  FIX_TYPE_LABELS,
  extractFixContext,
  resolveCurrentValue,
  buildFixPrompt,
} = require('./fix/promptBuilder');
const { parseAndValidateFix } = require('./fix/responseValidator');
const { FixInputError } = require('./fix/errors');
const errors = require('./fix/errors');

const FIX_MAX_TOKENS = 1200; // a single fix is short; no need for the full 4096 budget

/**
 * Generate one AI fix suggestion.
 *
 * @param {object} params
 * @param {object} params.scanResult ScanResult from websiteScanner.js (real, stored data).
 * @param {object} params.finding A finding from that scan's audit.findings (pre-verified by the caller).
 * @param {string} params.fixType One of FIX_TYPES.
 * @param {string|null} [params.imageSrc] For fixType 'alt_text': a pre-verified image path.
 * @returns {Promise<object>} { fixType, original, improved, reason, alternatives, generatedAt, disclaimer }
 * @throws {import('./fix/errors').FixInputError|import('./fix/errors').AIError}
 */
async function generateFix({ scanResult, finding, fixType, imageSrc = null }) {
  if (!scanResult || typeof scanResult !== 'object') {
    throw new FixInputError('No website scan data was provided.', 'invalid_fix_request');
  }
  if (typeof fixType !== 'string' || !FIX_TYPES.includes(fixType)) {
    throw new FixInputError('Please provide a supported fix type.', 'invalid_fix_type');
  }
  if (!finding || typeof finding !== 'object' || !finding.title) {
    throw new FixInputError('A valid finding is required to generate a fix.', 'invalid_fix_request');
  }

  const context = extractFixContext(scanResult);
  const currentValue = resolveCurrentValue(scanResult, fixType, imageSrc);
  const { system, user } = buildFixPrompt({ fixType, context, finding, currentValue });

  const { text } = await callClaude({ system, user, maxTokens: FIX_MAX_TOKENS });
  const validated = parseAndValidateFix(text, fixType, currentValue);

  return {
    ...validated,
    generatedAt: new Date().toISOString(),
    disclaimer:
      'This is an AI-generated suggestion based on the detected data above. ' +
      'Nothing is applied automatically -- review it, then copy it into your site yourself.',
  };
}

module.exports = {
  generateFix,
  FIX_TYPES,
  FIX_TYPE_LABELS,
  errors,
};
