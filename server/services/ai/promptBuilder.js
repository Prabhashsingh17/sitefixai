/**
 * promptBuilder.js
 * ---------------------------------------------------------------------------
 * Turns a scan + audit result into (a) a small, bounded "facts" object that
 * is both sent to Claude and returned to the client as the deterministic
 * "basedOn" section (so facts vs. AI output are never conflated), and
 * (b) the actual system/user prompt strings sent to the Claude API.
 *
 * Input limits: only a curated subset of fields is included, every string
 * is length-capped, and only non-passing findings (critical/warning/info)
 * are sent — "good" findings need no recommendation and would just add
 * tokens without helping the AI. This keeps the request small, bounds
 * cost/latency, and reduces the surface for the model to go off-topic.
 * ---------------------------------------------------------------------------
 */

const MAX_STRING_LEN = 200;
const MAX_FINDINGS_SENT = 40; // generous headroom; the audit engine produces ~28 today
const MAX_CTA_SAMPLES = 5;

const VALID_CATEGORIES = ['seo', 'performance', 'mobile', 'accessibility', 'content', 'ux', 'conversion'];

function truncate(value, maxLen = MAX_STRING_LEN) {
  if (typeof value !== 'string') return value;
  return value.length > maxLen ? value.slice(0, maxLen) + '…' : value;
}

/**
 * Extract a small, bounded set of real facts from the scan + audit result.
 * This is the ONLY data that reaches the model — nothing else from the raw
 * scan (full link lists, full button lists, etc.) is included.
 *
 * @param {object} scan   ScanResult from websiteScanner.js
 * @param {object} audit  AuditResult from auditEngine.js
 */
function extractFacts(scan, audit) {
  const nonPassingFindings = (audit.findings || [])
    .filter((f) => f.severity !== 'good')
    .slice(0, MAX_FINDINGS_SENT)
    .map((f) => ({
      category: f.category,
      severity: f.severity,
      title: truncate(f.title),
      evidence: truncate(f.evidence),
    }));

  return {
    url: scan.url,
    finalUrl: scan.finalUrl,
    https: Boolean(scan.technical?.https),
    statusCode: scan.technical?.statusCode ?? null,
    redirected: Boolean(scan.technical?.redirected),
    scanDurationMs: scan.technical?.scanDurationMs ?? null,

    title: truncate(scan.title),
    titleLength: scan.title ? scan.title.length : 0,
    metaDescription: truncate(scan.metaDescription),
    metaDescriptionLength: scan.metaDescription ? scan.metaDescription.length : 0,

    h1Count: scan.headings?.h1?.count ?? 0,
    h1Text: (scan.headings?.h1?.text || []).slice(0, 2).map((t) => truncate(t, 120)),
    h2Count: scan.headings?.h2?.count ?? 0,

    imageCount: scan.images?.count ?? 0,
    imagesMissingAltCount: scan.accessibility?.imagesMissingAlt?.count ?? 0,
    imagesMissingAltPercentage: scan.accessibility?.imagesMissingAlt?.percentage ?? 0,

    internalLinkCount: scan.links?.internal?.count ?? 0,
    externalLinkCount: scan.links?.external?.count ?? 0,

    formCount: (scan.forms || []).length,
    formsWithNoInputsCount: (scan.forms || []).filter((f) => (f.inputCount || 0) === 0).length,

    wordCount: scan.content?.wordCount ?? 0,
    ctaCount: scan.content?.ctaElements?.count ?? 0,
    ctaSamples: (scan.content?.ctaElements?.samples || []).slice(0, MAX_CTA_SAMPLES).map((s) => truncate(s, 80)),

    hasEmailLink: Boolean(scan.contact?.hasEmailLink),
    hasPhoneLink: Boolean(scan.contact?.hasPhoneLink),

    viewportPresent: Boolean(scan.mobile?.viewport?.present),
    viewportContent: truncate(scan.mobile?.viewport?.content, 120),

    canonicalPresent: Boolean(scan.seo?.canonicalUrl),
    robotsMeta: truncate(scan.seo?.robotsMeta, 80),
    openGraphKeys: Object.keys(scan.seo?.openGraph || {}),
    structuredDataPresent: Boolean(scan.seo?.structuredData?.present),
    structuredDataTypes: (scan.seo?.structuredData?.types || []).slice(0, 5),

    overallScore: audit.overallScore,
    categoryScores: audit.categoryScores,
    checksPassed: audit.summary?.bySeverity?.good ?? 0,
    totalChecks: audit.summary?.totalChecks ?? (audit.findings || []).length,

    findings: nonPassingFindings,
  };
}

const RESPONSE_SCHEMA_INSTRUCTIONS = `
Respond with ONLY a single JSON object — no markdown code fences, no commentary before or after it. It must have exactly this shape:

{
  "executiveSummary": "2-4 sentence plain-language overview of the site's overall state, referencing only the facts and findings provided",
  "recommendations": [
    {
      "category": "seo | performance | mobile | accessibility | content | ux | conversion",
      "priority": "high | medium | low",
      "problem": "What is wrong, grounded in a specific provided fact or finding",
      "whyItMatters": "Why this matters for visitors or search engines, in plain language",
      "recommendedFix": "A specific, actionable fix",
      "example": "A concrete example of the fix applied (e.g. sample title tag text, sample alt text) — invent illustrative wording only, never invent facts about this specific website that were not provided",
      "expectedImpact": "A cautious, non-guaranteed description of the likely benefit (use words like 'can help' or 'may improve' — never promise specific rankings, traffic, or conversion numbers)"
    }
  ],
  "topImprovementIndexes": [/* up to 5 integers: indexes into "recommendations", ordered highest-impact first */],
  "quickWinIndexes": [/* integers: indexes into "recommendations" that are fast/low-effort fixes */],
  "longTermIndexes": [/* integers: indexes into "recommendations" that are larger/structural efforts */]
}

Rules:
- Base every recommendation ONLY on the facts and findings given below. Do not invent statistics, page content, competitor comparisons, or claims about this website that are not present in the input.
- Never state or imply a guaranteed search ranking position, guaranteed traffic increase, or guaranteed conversion increase. Use cautious, non-absolute language for "expectedImpact".
- If there is not enough information to say something concrete about a category, do not fabricate a recommendation for it — it is fine to have fewer recommendations in that category.
- Every index in "topImprovementIndexes", "quickWinIndexes", and "longTermIndexes" must be a valid 0-based index into the "recommendations" array.
- Output valid JSON only. Do not wrap it in \`\`\`json or any other formatting.
`.trim();

function buildPrompt(facts) {
  const system = [
    'You are the recommendation engine for SiteFix AI, a website audit tool.',
    'You are given the REAL, machine-detected facts about one specific webpage and the results of a deterministic rule-based audit of it.',
    'Your job is to turn those facts into specific, actionable improvement recommendations for the site owner.',
    'You must not invent facts about this website that are not in the data provided — every recommendation must be traceable to a fact or finding given to you.',
    'You must never guarantee search ranking positions, traffic increases, or conversion increases; describe expected impact cautiously.',
  ].join(' ');

  const user = [
    'DETECTED FACTS (from an automated scan of this page):',
    JSON.stringify(facts, null, 2),
    '',
    RESPONSE_SCHEMA_INSTRUCTIONS,
  ].join('\n');

  return { system, user };
}

module.exports = {
  extractFacts,
  buildPrompt,
  VALID_CATEGORIES,
  truncate,
};
