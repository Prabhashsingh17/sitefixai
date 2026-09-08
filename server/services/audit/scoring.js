/**
 * scoring.js
 * ---------------------------------------------------------------------------
 * Shared helpers for the deterministic audit scoring engine.
 *
 * The scoring model: each category is made up of individual checks, and each
 * check is worth a fixed number of points (its `maxPoints`). A check awards
 * some or all of those points based on what was actually detected in the
 * scan data — never randomly. A category's score is simply
 *   round((sum of awarded points / sum of possible points) * 100)
 * which keeps every score traceable back to the specific checks (and their
 * findings) that produced it.
 * ---------------------------------------------------------------------------
 */

/** The relative weight of each category in the overall 0–100 score. Sums to 1. */
const CATEGORY_WEIGHTS = Object.freeze({
  seo: 0.2,
  performance: 0.15,
  mobile: 0.15,
  accessibility: 0.15,
  content: 0.15,
  ux: 0.1,
  conversion: 0.1,
});

const SEVERITIES = Object.freeze(['critical', 'warning', 'info', 'good']);

function clampScore(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * @param {string} category
 * @param {'critical'|'warning'|'info'|'good'} severity
 * @param {string} title
 * @param {string} description
 * @param {string} evidence
 * @param {string} recommendation
 */
function makeFinding(category, severity, title, description, evidence, recommendation) {
  if (!SEVERITIES.includes(severity)) {
    throw new Error(`Invalid finding severity: "${severity}"`);
  }
  return { category, severity, title, description, evidence, recommendation };
}

/**
 * Combines a category's individual check results into a single score + the
 * flat list of findings those checks produced.
 *
 * @param {Array<{ points: number, maxPoints: number, finding: object }>} checkResults
 * @returns {{ score: number, findings: object[] }}
 */
function evaluateCategory(checkResults) {
  const totalMax = checkResults.reduce((sum, c) => sum + c.maxPoints, 0);
  const totalPoints = checkResults.reduce((sum, c) => sum + c.points, 0);
  const score = totalMax > 0 ? clampScore((totalPoints / totalMax) * 100) : 100;
  const findings = checkResults.map((c) => c.finding);
  return { score, findings };
}

module.exports = {
  CATEGORY_WEIGHTS,
  SEVERITIES,
  clampScore,
  makeFinding,
  evaluateCategory,
};
