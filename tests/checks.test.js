const test = require('node:test');
const assert = require('node:assert/strict');
const { baseScan } = require('./fixtures');

const {
  seoChecks,
  performanceChecks,
  mobileChecks,
  accessibilityChecks,
  contentChecks,
  uxChecks,
  conversionChecks,
} = require('../server/services/audit/checks');

function findByTitle(results, title) {
  const match = results.find((r) => r.finding.title === title);
  assert.ok(match, `expected a finding titled "${title}"`);
  return match;
}

// =============================================================================
// SEO
// =============================================================================
test('seo: missing title is critical and scores 0/20', () => {
  const results = seoChecks(baseScan({ title: null }));
  const check = findByTitle(results, 'Missing page title');
  assert.equal(check.finding.severity, 'critical');
  assert.equal(check.points, 0);
  assert.equal(check.maxPoints, 20);
});

test('seo: title length exactly 30 and exactly 60 chars are both "good" boundary cases', () => {
  const title30 = 'x'.repeat(30);
  const title60 = 'x'.repeat(60);
  const r30 = findByTitle(seoChecks(baseScan({ title: title30 })), 'Title length is well-optimized');
  const r60 = findByTitle(seoChecks(baseScan({ title: title60 })), 'Title length is well-optimized');
  assert.equal(r30.points, 15);
  assert.equal(r60.points, 15);
});

test('seo: title length 29 chars (just under boundary) is a warning', () => {
  const title29 = 'x'.repeat(29);
  const results = seoChecks(baseScan({ title: title29 }));
  const check = findByTitle(results, 'Title length is too short');
  assert.equal(check.finding.severity, 'warning');
  assert.equal(check.points, 7);
});

test('seo: title length 61 chars (just over boundary) is a warning', () => {
  const title61 = 'x'.repeat(61);
  const results = seoChecks(baseScan({ title: title61 }));
  const check = findByTitle(results, 'Title length is too long');
  assert.equal(check.finding.severity, 'warning');
});

test('seo: missing meta description is a warning, not critical', () => {
  const results = seoChecks(baseScan({ metaDescription: null }));
  const check = findByTitle(results, 'Missing meta description');
  assert.equal(check.finding.severity, 'warning');
  assert.equal(check.points, 0);
});

test('seo: zero H1s is critical, one H1 is good, multiple H1s is a warning', () => {
  const zero = seoChecks(baseScan({ headings: { h1: { count: 0, text: [] }, h2: { count: 0, text: [] } } }));
  const one = seoChecks(baseScan({ headings: { h1: { count: 1, text: ['Home'] }, h2: { count: 0, text: [] } } }));
  const many = seoChecks(baseScan({ headings: { h1: { count: 3, text: ['A', 'B', 'C'] }, h2: { count: 0, text: [] } } }));

  assert.equal(findByTitle(zero, 'Missing H1 heading').finding.severity, 'critical');
  assert.equal(findByTitle(one, 'Exactly one H1 heading').finding.severity, 'good');
  assert.equal(findByTitle(many, 'Multiple H1 headings found').finding.severity, 'warning');
});

test('seo: canonical, Open Graph, and structured data each score correctly when present vs absent', () => {
  const withAll = seoChecks(
    baseScan({
      seo: {
        canonicalUrl: 'https://example.com/',
        openGraph: { title: 't', description: 'd', image: '/i.png' },
        structuredData: { present: true, types: ['Organization'] },
      },
    })
  );
  const withNone = seoChecks(baseScan({}));

  assert.equal(findByTitle(withAll, 'Canonical URL declared').points, 10);
  assert.equal(findByTitle(withAll, 'Open Graph metadata present').points, 10);
  assert.equal(findByTitle(withAll, 'Structured data detected').points, 5);

  assert.equal(findByTitle(withNone, 'Missing canonical URL').points, 0);
  assert.equal(findByTitle(withNone, 'No Open Graph metadata').points, 0);
  assert.equal(findByTitle(withNone, 'No structured data detected').points, 0);
});

// =============================================================================
// PERFORMANCE
// =============================================================================
test('performance: HTTPS true/false scores 40/0 and is critical when false', () => {
  const withHttps = performanceChecks(baseScan({ technical: { https: true, redirected: false, scanDurationMs: 100 } }));
  const withoutHttps = performanceChecks(baseScan({ technical: { https: false, redirected: false, scanDurationMs: 100 } }));

  assert.equal(findByTitle(withHttps, 'Site is served over HTTPS').points, 40);
  const noHttps = findByTitle(withoutHttps, 'Site is not served over HTTPS');
  assert.equal(noHttps.points, 0);
  assert.equal(noHttps.finding.severity, 'critical');
});

test('performance: response time tiers (fast/moderate/slow) score 40/22/5', () => {
  const fast = performanceChecks(baseScan({ technical: { https: true, redirected: false, scanDurationMs: 500 } }));
  const moderate = performanceChecks(baseScan({ technical: { https: true, redirected: false, scanDurationMs: 2000 } }));
  const slow = performanceChecks(baseScan({ technical: { https: true, redirected: false, scanDurationMs: 5000 } }));

  assert.equal(findByTitle(fast, 'Fast server response').points, 40);
  assert.equal(findByTitle(moderate, 'Moderate server response time').points, 22);
  assert.equal(findByTitle(slow, 'Slow server response').points, 5);
});

test('performance: a redirect costs points but is only a warning, not critical', () => {
  const results = performanceChecks(baseScan({ technical: { https: true, redirected: true, scanDurationMs: 100 } }));
  const check = findByTitle(results, 'URL required a redirect');
  assert.equal(check.points, 10);
  assert.equal(check.finding.severity, 'warning');
});

// =============================================================================
// MOBILE
// =============================================================================
test('mobile: missing viewport is critical across all three checks', () => {
  const results = mobileChecks(baseScan({ mobile: { viewport: { present: false, content: null } } }));
  assert.equal(findByTitle(results, 'Missing viewport meta tag').finding.severity, 'critical');
  assert.equal(findByTitle(results, 'Cannot verify device-width scaling').points, 0);
  assert.equal(findByTitle(results, 'Cannot verify initial zoom level').points, 0);
});

test('mobile: viewport present without device-width is a warning, not critical', () => {
  const results = mobileChecks(baseScan({ mobile: { viewport: { present: true, content: 'width=600' } } }));
  const check = findByTitle(results, 'Viewport may not scale correctly');
  assert.equal(check.finding.severity, 'warning');
  assert.equal(check.points, 5);
});

test('mobile: fully correct viewport scores full marks on all three checks', () => {
  const results = mobileChecks(
    baseScan({ mobile: { viewport: { present: true, content: 'width=device-width, initial-scale=1' } } })
  );
  const total = results.reduce((sum, r) => sum + r.points, 0);
  assert.equal(total, 100);
});

// =============================================================================
// ACCESSIBILITY
// =============================================================================
test('accessibility: no images awards full marks with a "nothing to evaluate" finding, not a penalty', () => {
  const results = accessibilityChecks(baseScan({ images: { count: 0, missingAlt: { count: 0, samples: [] } } }));
  const check = findByTitle(results, 'No images to evaluate');
  assert.equal(check.points, 40);
  assert.equal(check.finding.severity, 'good');
});

test('accessibility: images missing alt at 20% is a warning, at 30% is critical', () => {
  const warn = accessibilityChecks(
    baseScan({ images: { count: 10, missingAlt: { count: 2, samples: [] } }, accessibility: { imagesMissingAlt: { count: 2, percentage: 20 } } })
  );
  const critical = accessibilityChecks(
    baseScan({ images: { count: 10, missingAlt: { count: 3, samples: [] } }, accessibility: { imagesMissingAlt: { count: 3, percentage: 30 } } })
  );
  assert.equal(findByTitle(warn, 'Some images are missing alt text').finding.severity, 'warning');
  assert.equal(findByTitle(critical, 'Most images are missing alt text').finding.severity, 'critical');
});

test('accessibility: no form inputs awards full marks; unlabeled inputs reduce score proportionally', () => {
  const noForms = accessibilityChecks(baseScan({ forms: [] }));
  assert.equal(findByTitle(noForms, 'No form inputs to evaluate').points, 30);

  const halfLabeled = accessibilityChecks(
    baseScan({ forms: [{ action: null, method: 'post', inputCount: 2, unlabeledInputCount: 1, labelableInputCount: 2 }] })
  );
  const check = findByTitle(halfLabeled, 'Some form fields are missing labels');
  assert.equal(check.points, 15); // 30 * (1 - 1/2)
  assert.equal(check.finding.severity, 'warning'); // ratio exactly 0.5 -> warning

  const mostlyUnlabeled = accessibilityChecks(
    baseScan({ forms: [{ action: null, method: 'post', inputCount: 4, unlabeledInputCount: 3, labelableInputCount: 4 }] })
  );
  assert.equal(findByTitle(mostlyUnlabeled, 'Some form fields are missing labels').finding.severity, 'critical');
});

// =============================================================================
// CONTENT
// =============================================================================
test('content: word count tiers score 0/15/35/60', () => {
  const empty = contentChecks(baseScan({ content: { wordCount: 0, ctaElements: { count: 0, samples: [] } } }));
  const thin = contentChecks(baseScan({ content: { wordCount: 100, ctaElements: { count: 0, samples: [] } } }));
  const moderate = contentChecks(baseScan({ content: { wordCount: 200, ctaElements: { count: 0, samples: [] } } }));
  const healthy = contentChecks(baseScan({ content: { wordCount: 500, ctaElements: { count: 0, samples: [] } } }));

  assert.equal(findByTitle(empty, 'No readable text content found').points, 0);
  assert.equal(findByTitle(thin, 'Very thin content').points, 15);
  assert.equal(findByTitle(moderate, 'Content is on the thin side').points, 35);
  assert.equal(findByTitle(healthy, 'Content length looks healthy').points, 60);
});

test('content: subheadings present vs absent scores 20/10, both non-critical', () => {
  const withH2 = contentChecks(baseScan({ headings: { h1: { count: 1, text: ['x'] }, h2: { count: 2, text: ['a', 'b'] } } }));
  const withoutH2 = contentChecks(baseScan({ headings: { h1: { count: 1, text: ['x'] }, h2: { count: 0, text: [] } } }));

  assert.equal(findByTitle(withH2, 'Content is broken up with subheadings').points, 20);
  const noH2Check = findByTitle(withoutH2, 'No subheadings detected');
  assert.equal(noH2Check.points, 10);
  assert.equal(noH2Check.finding.severity, 'info');
});

// =============================================================================
// UX
// =============================================================================
test('ux: internal link count tiers (0 / 1-2 / 3+) score 0/15/30', () => {
  const none = uxChecks(baseScan({ links: { total: 0, internal: { count: 0, samples: [] }, external: { count: 0, samples: [] } } }));
  const few = uxChecks(baseScan({ links: { total: 2, internal: { count: 2, samples: [] }, external: { count: 0, samples: [] } } }));
  const healthy = uxChecks(baseScan({ links: { total: 5, internal: { count: 5, samples: [] }, external: { count: 0, samples: [] } } }));

  assert.equal(findByTitle(none, 'No internal links found').finding.severity, 'critical');
  assert.equal(findByTitle(few, 'Limited internal navigation').points, 15);
  assert.equal(findByTitle(healthy, 'Page provides internal navigation').points, 30);
});

test('ux: an empty <form> (0 inputs) is flagged as broken, distinct from "no forms at all"', () => {
  const noForms = uxChecks(baseScan({ forms: [] }));
  const emptyForm = uxChecks(baseScan({ forms: [{ action: null, method: 'get', inputCount: 0, unlabeledInputCount: 0, labelableInputCount: 0 }] }));

  assert.equal(findByTitle(noForms, 'No forms to evaluate').points, 25);
  const brokenCheck = findByTitle(emptyForm, 'Empty form detected');
  assert.equal(brokenCheck.finding.severity, 'warning');
  assert.equal(brokenCheck.points, 10);
});

// =============================================================================
// CONVERSION
// =============================================================================
test('conversion: no CTA is critical for both the presence and primary-action checks', () => {
  const results = conversionChecks(baseScan({ content: { wordCount: 0, ctaElements: { count: 0, samples: [] } } }));
  assert.equal(findByTitle(results, 'No call-to-action detected').finding.severity, 'critical');
  assert.equal(findByTitle(results, 'No primary action to evaluate').finding.severity, 'critical');
});

test('conversion: contact info detected via mailto/tel scores full marks', () => {
  const withEmail = conversionChecks(baseScan({ contact: { hasEmailLink: true, hasPhoneLink: false, emailLinks: ['a@b.com'], phoneLinks: [] } }));
  const withNeither = conversionChecks(baseScan({ contact: { hasEmailLink: false, hasPhoneLink: false, emailLinks: [], phoneLinks: [] } }));

  assert.equal(findByTitle(withEmail, 'Direct contact information found').points, 25);
  assert.equal(findByTitle(withNeither, 'No direct contact information found').points, 0);
});

test('conversion: too many CTAs (>10) triggers a "too many" warning instead of full marks', () => {
  const results = conversionChecks(baseScan({ content: { wordCount: 500, ctaElements: { count: 15, samples: [] } } }));
  const check = findByTitle(results, 'Too many competing calls-to-action');
  assert.equal(check.finding.severity, 'warning');
  assert.equal(check.points, 8);
});

// =============================================================================
// Cross-cutting: every check in every category returns a well-formed Finding
// =============================================================================
test('every check across every category returns a finding with the exact required shape', () => {
  const allCheckFns = [seoChecks, performanceChecks, mobileChecks, accessibilityChecks, contentChecks, uxChecks, conversionChecks];
  const scan = baseScan({});
  const VALID_SEVERITIES = new Set(['critical', 'warning', 'info', 'good']);

  allCheckFns.forEach((fn) => {
    const results = fn(scan);
    assert.ok(results.length > 0, `${fn.name} produced no checks`);
    results.forEach((r) => {
      assert.equal(typeof r.points, 'number');
      assert.equal(typeof r.maxPoints, 'number');
      assert.ok(r.points >= 0 && r.points <= r.maxPoints, `${fn.name}: points out of range`);
      const keys = Object.keys(r.finding).sort();
      assert.deepEqual(keys, ['category', 'description', 'evidence', 'recommendation', 'severity', 'title']);
      assert.ok(VALID_SEVERITIES.has(r.finding.severity), `${fn.name}: invalid severity "${r.finding.severity}"`);
      assert.equal(typeof r.finding.title, 'string');
      assert.ok(r.finding.title.length > 0);
    });
  });
});
