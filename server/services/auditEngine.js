/**
 * auditEngine.js
 * ---------------------------------------------------------------------------
 * Deterministic website audit scoring engine for SiteFix AI.
 *
 * runAudit(scanResult) takes the structured output of
 * server/services/websiteScanner.js and computes:
 *   - a 0–100 score for each of 7 categories (SEO, Performance, Mobile,
 *     Accessibility, Content, UX, Conversion)
 *   - an overall 0–100 score (a fixed weighted average of the categories)
 *   - a flat list of findings — one per check, always including the checks
 *     that passed — so every point of every score is traceable back to a
 *     specific, explainable check against real scan data.
 *
 * This is 100% deterministic: no Math.random(), no external calls, no AI.
 * The exact same scan input always produces the exact same output. Where
 * the scanner simply has no data for something (e.g. no images on the
 * page), the relevant check awards full marks with an honest "nothing to
 * evaluate" finding rather than penalizing or guessing.
 * ---------------------------------------------------------------------------
 */

const { CATEGORY_WEIGHTS, clampScore, evaluateCategory } = require('./audit/scoring');
const {
  seoChecks,
  performanceChecks,
  mobileChecks,
  accessibilityChecks,
  contentChecks,
  uxChecks,
  conversionChecks,
} = require('./audit/checks');

/** Category keys, in a stable, deliberate display order. */
const CATEGORY_ORDER = Object.freeze([
  'seo',
  'performance',
  'mobile',
  'accessibility',
  'content',
  'ux',
  'conversion',
]);

const CATEGORY_CHECK_RUNNERS = Object.freeze({
  seo: seoChecks,
  performance: performanceChecks,
  mobile: mobileChecks,
  accessibility: accessibilityChecks,
  content: contentChecks,
  ux: uxChecks,
  conversion: conversionChecks,
});

const SEVERITY_RANK = Object.freeze({ critical: 0, warning: 1, info: 2, good: 3 });

/**
 * @typedef {Object} Finding
 * @property {string} category
 * @property {'critical'|'warning'|'info'|'good'} severity
 * @property {string} title
 * @property {string} description
 * @property {string} evidence
 * @property {string} recommendation
 *
 * @typedef {Object} AuditResult
 * @property {number} overallScore                0–100
 * @property {Object.<string, number>} categoryScores  0–100 per category
 * @property {Finding[]} findings
 * @property {Object} summary
 */

/**
 * Run the deterministic audit against a scanner result.
 *
 * @param {object} scanResult The structured output of websiteScanner.scanWebsite().
 * @returns {AuditResult}
 */
function runAudit(scanResult) {
  if (!scanResult || typeof scanResult !== 'object') {
    throw new TypeError('runAudit() requires a scan result object from websiteScanner.');
  }

  const categoryScores = {};
  const findings = [];

  CATEGORY_ORDER.forEach((category) => {
    const runner = CATEGORY_CHECK_RUNNERS[category];
    const checkResults = runner(scanResult);
    const { score, findings: categoryFindings } = evaluateCategory(checkResults);
    categoryScores[category] = score;
    findings.push(...categoryFindings);
  });

  const overallScore = clampScore(
    CATEGORY_ORDER.reduce((sum, category) => sum + categoryScores[category] * CATEGORY_WEIGHTS[category], 0)
  );

  const summary = buildSummary(findings, categoryScores, overallScore);

  return { overallScore, categoryScores, findings, summary };
}

/**
 * @param {Finding[]} findings
 * @param {Object.<string, number>} categoryScores
 * @param {number} overallScore
 */
function buildSummary(findings, categoryScores, overallScore) {
  const bySeverity = { critical: 0, warning: 0, info: 0, good: 0 };
  findings.forEach((f) => {
    bySeverity[f.severity] += 1;
  });

  const sortedByScore = sortCategoriesByScore(categoryScores);
  const weakestCategory = sortedByScore[0];
  const strongestCategory = sortedByScore[sortedByScore.length - 1];

  const topIssues = findings
    .filter((f) => f.severity === 'critical' || f.severity === 'warning')
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
    .slice(0, 5);

  return {
    totalChecks: findings.length,
    bySeverity,
    overallScore,
    weakestCategory,
    strongestCategory,
    topIssues,
  };
}

/** Category keys sorted ascending by score (lowest/weakest first). */
function sortCategoriesByScore(categoryScores) {
  return [...CATEGORY_ORDER].sort((a, b) => categoryScores[a] - categoryScores[b]);
}

module.exports = {
  runAudit,
  CATEGORY_ORDER,
};
