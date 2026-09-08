/**
 * promptBuilder.js (fix)
 * ---------------------------------------------------------------------------
 * Builds the prompt for a single "Fix with AI" request.
 *
 * Two things are deliberately NOT trusted from the client for standard fix
 * types: the "current value" and the "finding". Both are re-derived /
 * re-verified server-side from the stored scan record in fixRoutes.js
 * before this module ever sees them, so the AI is always grounded in real,
 * previously-detected data rather than anything a client could spoof.
 * ---------------------------------------------------------------------------
 */

const { truncate } = require('../ai/promptBuilder');

/** The 9 supported fix types, in the order they're offered in the UI. */
const FIX_TYPES = [
  'title',
  'meta_description',
  'headline',
  'cta',
  'alt_text',
  'seo_content',
  'faq_content',
  'landing_copy',
  'html_snippet',
];

const FIX_TYPE_LABELS = {
  title: 'Page title',
  meta_description: 'Meta description',
  headline: 'H1 / headline',
  cta: 'CTA text',
  alt_text: 'Image alt text',
  seo_content: 'Meta/SEO content',
  faq_content: 'FAQ content',
  landing_copy: 'Landing page copy',
  html_snippet: 'HTML snippet',
};

const FIX_TYPE_INSTRUCTIONS = {
  title:
    'Suggest an improved <title> tag for this page. Keep it roughly 30-60 characters, accurate to the page\'s real topic (from the facts given), and compelling for search results.',
  meta_description:
    'Suggest an improved meta description. Keep it roughly 50-160 characters, accurate to the page\'s real topic, and written to encourage clicks from search results.',
  headline:
    'Suggest an improved H1 / main headline for this page, accurate to its real topic and clear to a visitor landing on the page.',
  cta:
    'Suggest improved call-to-action button or link text: short, action-oriented, and specific about what happens next.',
  alt_text:
    'Suggest descriptive alt text for the image at the given file path. You cannot see the actual image — infer only a plausible, generic description from the filename and surrounding page context (title, URL). Make clear in "reason" that this is a starting-point suggestion the site owner must verify against the real image, not a factual description of its contents.',
  seo_content:
    'Suggest a tightened SEO metadata package: put both an improved title and an improved meta description into "improved", clearly labeled on separate lines (e.g. "Title: ...\\nMeta Description: ..."), consistent with each other and with the page\'s real topic.',
  faq_content:
    'Suggest 3-5 FAQ question-and-answer pairs plausible for this page\'s apparent topic (inferred only from the given title/headings). Format "improved" as a numbered list of Q/A pairs. Make clear in "reason" that these are draft questions to fact-check and personalize, not verified answers about this specific business.',
  landing_copy:
    'Suggest improved landing-page hero copy: a headline plus one short supporting sentence, consistent with the page\'s real topic. Make clear in "reason" that this is a creative draft for the site owner to review and personalize.',
  html_snippet:
    'Provide a minimal, correct HTML snippet that addresses the described issue (e.g. a canonical link tag, a properly labeled form input, a viewport meta tag, a basic JSON-LD block). Use clearly-marked placeholder values (e.g. "YOUR PAGE TITLE HERE") for anything not given in the facts — never invent specific business details.',
};

const RESPONSE_SCHEMA_INSTRUCTIONS = `
Respond with ONLY a single JSON object — no markdown code fences, no commentary before or after it. It must have exactly this shape:

{
  "fixType": "the same fix type requested",
  "original": "the current value provided below, or an empty string if none was given",
  "improved": "your suggested replacement content, following the instructions for this fix type",
  "reason": "why this is better, grounded in the finding and facts given -- use cautious, non-absolute language, never guarantee an outcome",
  "alternatives": ["0 to 3 alternative versions of \\"improved\\""]
}

Rules:
- Base this only on the facts and finding provided. Do not invent unrelated facts about the business, its products, its customers, or its performance.
- Never state or imply a guaranteed search ranking position, traffic increase, or conversion increase.
- If the fix type calls for a creative draft (FAQ, landing copy, alt text), say so plainly in "reason" -- it must not be presented as a verified fact about this website.
- Output valid JSON only. Do not wrap it in \`\`\`json or any other formatting.
`.trim();

/**
 * Extract a small, bounded context object for fix generation. Deliberately
 * smaller than the full-audit facts object in ai/promptBuilder.js — a
 * single-field fix only needs page-identity context, not every finding.
 *
 * @param {object} scan ScanResult from websiteScanner.js
 */
function extractFixContext(scan) {
  return {
    url: scan.url,
    pageTitle: truncate(scan.title, 150) || null,
    metaDescription: truncate(scan.metaDescription, 200) || null,
    h1: truncate((scan.headings?.h1?.text || [])[0], 150) || null,
    h2Samples: (scan.headings?.h2?.text || []).slice(0, 5).map((t) => truncate(t, 100)),
    existingCtaSamples: (scan.content?.ctaElements?.samples || []).slice(0, 3).map((t) => truncate(t, 80)),
  };
}

/**
 * Determine the real, server-authoritative "current value" for a fix type,
 * pulled directly from the stored scan result -- never from client input,
 * except for `imageSrc` which selects WHICH detected image to target for
 * alt_text (and is itself validated by the caller against the scan's real
 * missing-alt sample list before reaching here).
 *
 * @param {object} scan ScanResult from websiteScanner.js
 * @param {string} fixType
 * @param {string|null} validatedImageSrc Already-verified image path, or null.
 * @returns {string} The current value, or '' if there isn't one to show.
 */
function resolveCurrentValue(scan, fixType, validatedImageSrc) {
  switch (fixType) {
    case 'title':
      return scan.title || '';
    case 'meta_description':
      return scan.metaDescription || '';
    case 'headline':
      return (scan.headings?.h1?.text || [])[0] || '';
    case 'cta':
      return (scan.content?.ctaElements?.samples || [])[0] || '';
    case 'alt_text':
      return validatedImageSrc || (scan.images?.missingAlt?.samples || [])[0] || '';
    default:
      // seo_content, faq_content, landing_copy, html_snippet don't map to
      // one single existing field -- there's no meaningful "current value".
      return '';
  }
}

/**
 * @param {object} params
 * @param {string} params.fixType One of FIX_TYPES.
 * @param {object} params.context Output of extractFixContext().
 * @param {object} params.finding The verified, stored finding this fix addresses.
 * @param {string} params.currentValue Output of resolveCurrentValue().
 * @returns {{ system: string, user: string }}
 */
function buildFixPrompt({ fixType, context, finding, currentValue }) {
  const instructions = FIX_TYPE_INSTRUCTIONS[fixType];

  const system = [
    'You are the "Fix with AI" feature of SiteFix AI, a website audit tool.',
    'You are given real, machine-detected facts about one specific webpage, one specific audit finding about it, and (when available) the current content being fixed.',
    'You must not invent facts about this website beyond what is given -- every suggestion must be grounded in the provided data.',
    'You must never guarantee search ranking, traffic, or conversion outcomes.',
    'You must respond with a single JSON object matching the exact schema you are given, and nothing else.',
  ].join(' ');

  const user = [
    `FIX TYPE: ${fixType}`,
    `INSTRUCTIONS FOR THIS FIX TYPE: ${instructions}`,
    '',
    'PAGE CONTEXT (real, detected facts):',
    JSON.stringify(context, null, 2),
    '',
    'THE FINDING THIS FIX ADDRESSES (from a deterministic audit -- real, not invented):',
    JSON.stringify(
      {
        category: finding.category,
        severity: finding.severity,
        title: finding.title,
        description: finding.description,
        evidence: finding.evidence,
      },
      null,
      2
    ),
    '',
    `CURRENT VALUE (may be empty if none was detected): ${JSON.stringify(currentValue || '')}`,
    '',
    RESPONSE_SCHEMA_INSTRUCTIONS,
  ].join('\n');

  return { system, user };
}

module.exports = {
  FIX_TYPES,
  FIX_TYPE_LABELS,
  extractFixContext,
  resolveCurrentValue,
  buildFixPrompt,
};
