/**
 * checks.js
 * ---------------------------------------------------------------------------
 * Individual, deterministic checks for each audit category. Every check is
 * a pure function of the scanner's output: same input always produces the
 * same points and finding. Nothing here is randomized, and no check ever
 * invents data the scanner didn't actually detect — where the scanner has
 * no signal for something, the check says so explicitly (severity 'info'
 * or 'good' with an honest caveat) rather than guessing.
 *
 * Each check function returns:
 *   { points: number, maxPoints: number, finding: Finding }
 * ---------------------------------------------------------------------------
 */

const { makeFinding } = require('./scoring');

// =============================================================================
// SEO — 8 checks, weights sum to 100
// =============================================================================
function seoChecks(scan) {
  const results = [];
  const title = scan.title;
  const titleLen = title ? title.length : 0;
  const metaDesc = scan.metaDescription;
  const h1Count = scan.headings?.h1?.count ?? 0;
  const canonical = scan.seo?.canonicalUrl;
  const og = scan.seo?.openGraph || {};
  const ogKeys = Object.keys(og);
  const structuredData = scan.seo?.structuredData || { present: false, types: [] };

  // 1. Title exists (20)
  if (title) {
    results.push({
      points: 20,
      maxPoints: 20,
      finding: makeFinding(
        'seo', 'good', 'Page has a title tag',
        'A <title> tag was found, which search engines and browsers rely on heavily.',
        `Title: "${title}"`,
        'Keep the title accurate and unique to this page.'
      ),
    });
  } else {
    results.push({
      points: 0,
      maxPoints: 20,
      finding: makeFinding(
        'seo', 'critical', 'Missing page title',
        'No <title> tag was found. This is one of the most important on-page SEO signals.',
        'No <title> element detected in the page <head>.',
        'Add a concise, descriptive <title> tag (ideally 30–60 characters).'
      ),
    });
  }

  // 2. Title length (15)
  if (title && titleLen >= 30 && titleLen <= 60) {
    results.push({
      points: 15,
      maxPoints: 15,
      finding: makeFinding(
        'seo', 'good', 'Title length is well-optimized',
        'The title length falls in the range search engines typically display in full.',
        `Title is ${titleLen} characters long.`,
        'No change needed.'
      ),
    });
  } else if (title) {
    const tooShort = titleLen < 30;
    results.push({
      points: 7,
      maxPoints: 15,
      finding: makeFinding(
        'seo', 'warning', `Title length is too ${tooShort ? 'short' : 'long'}`,
        tooShort
          ? 'Titles under 30 characters may under-use the space available in search results.'
          : 'Titles over 60 characters risk being truncated in search results.',
        `Title is ${titleLen} characters long.`,
        'Aim for approximately 30–60 characters.'
      ),
    });
  } else {
    results.push({
      points: 0,
      maxPoints: 15,
      finding: makeFinding(
        'seo', 'critical', 'Cannot evaluate title length',
        'No title tag exists to evaluate.',
        'No <title> element detected.',
        'Add a title tag first, then check its length.'
      ),
    });
  }

  // 3. Meta description exists (15)
  if (metaDesc) {
    results.push({
      points: 15,
      maxPoints: 15,
      finding: makeFinding(
        'seo', 'good', 'Meta description present',
        'A meta description helps control how the page is summarized in search results.',
        `Meta description: "${metaDesc.slice(0, 120)}${metaDesc.length > 120 ? '…' : ''}"`,
        'Keep it relevant and compelling.'
      ),
    });
  } else {
    results.push({
      points: 0,
      maxPoints: 15,
      finding: makeFinding(
        'seo', 'warning', 'Missing meta description',
        'No meta description tag was found. Search engines may auto-generate a snippet instead, which is often less compelling.',
        'No <meta name="description"> tag detected.',
        'Add a meta description of about 50–160 characters summarizing the page.'
      ),
    });
  }

  // 4. Meta description length (10)
  if (metaDesc && metaDesc.length >= 50 && metaDesc.length <= 160) {
    results.push({
      points: 10,
      maxPoints: 10,
      finding: makeFinding(
        'seo', 'good', 'Meta description length is well-optimized',
        'The length falls within the range typically shown in full in search results.',
        `Meta description is ${metaDesc.length} characters long.`,
        'No change needed.'
      ),
    });
  } else if (metaDesc) {
    const tooShort = metaDesc.length < 50;
    results.push({
      points: 4,
      maxPoints: 10,
      finding: makeFinding(
        'seo', 'info', `Meta description length is ${tooShort ? 'short' : 'long'}`,
        tooShort
          ? 'Descriptions under 50 characters may not fully use the available snippet space.'
          : 'Descriptions over 160 characters risk being truncated in search results.',
        `Meta description is ${metaDesc.length} characters long.`,
        'Aim for approximately 50–160 characters.'
      ),
    });
  } else {
    results.push({
      points: 0,
      maxPoints: 10,
      finding: makeFinding(
        'seo', 'info', 'Cannot evaluate meta description length',
        'No meta description exists to evaluate.',
        'No <meta name="description"> tag detected.',
        'Add a meta description first.'
      ),
    });
  }

  // 5. H1 exists, singular (15)
  if (h1Count === 1) {
    results.push({
      points: 15,
      maxPoints: 15,
      finding: makeFinding(
        'seo', 'good', 'Exactly one H1 heading',
        'A single H1 gives search engines a clear primary topic for the page.',
        `Detected H1: "${scan.headings.h1.text[0] || ''}"`,
        'No change needed.'
      ),
    });
  } else if (h1Count === 0) {
    results.push({
      points: 0,
      maxPoints: 15,
      finding: makeFinding(
        'seo', 'critical', 'Missing H1 heading',
        'No H1 heading was found. This is an important on-page SEO signal.',
        'No <h1> element detected.',
        "Add a single, descriptive H1 that reflects the page's main topic."
      ),
    });
  } else {
    results.push({
      points: 7,
      maxPoints: 15,
      finding: makeFinding(
        'seo', 'warning', 'Multiple H1 headings found',
        "Multiple H1 tags can dilute the page's topical focus for search engines.",
        `${h1Count} <h1> elements detected.`,
        'Use a single H1 per page; convert extras to H2/H3.'
      ),
    });
  }

  // 6. Canonical URL (10)
  if (canonical) {
    results.push({
      points: 10,
      maxPoints: 10,
      finding: makeFinding(
        'seo', 'good', 'Canonical URL declared',
        'A canonical tag helps prevent duplicate-content issues in search results.',
        `Canonical: ${canonical}`,
        'No change needed.'
      ),
    });
  } else {
    results.push({
      points: 0,
      maxPoints: 10,
      finding: makeFinding(
        'seo', 'warning', 'Missing canonical URL',
        'No canonical link tag was found.',
        'No <link rel="canonical"> detected.',
        'Add a canonical tag pointing to the preferred URL for this page.'
      ),
    });
  }

  // 7. Open Graph metadata (10)
  if (ogKeys.length >= 3 && og.title && og.description) {
    results.push({
      points: 10,
      maxPoints: 10,
      finding: makeFinding(
        'seo', 'good', 'Open Graph metadata present',
        'Open Graph tags control how the page appears when shared on social platforms.',
        `Detected og: ${ogKeys.join(', ')}`,
        'No change needed.'
      ),
    });
  } else if (ogKeys.length > 0) {
    results.push({
      points: 5,
      maxPoints: 10,
      finding: makeFinding(
        'seo', 'info', 'Partial Open Graph metadata',
        'Some Open Graph tags exist, but key ones may be missing.',
        `Detected og: ${ogKeys.join(', ')}`,
        'Add at minimum og:title, og:description, and og:image.'
      ),
    });
  } else {
    results.push({
      points: 0,
      maxPoints: 10,
      finding: makeFinding(
        'seo', 'info', 'No Open Graph metadata',
        'No Open Graph tags were found.',
        'No meta[property^="og:"] tags detected.',
        'Add og:title, og:description, and og:image for better link previews.'
      ),
    });
  }

  // 8. Structured data (5)
  if (structuredData.present) {
    results.push({
      points: 5,
      maxPoints: 5,
      finding: makeFinding(
        'seo', 'good', 'Structured data detected',
        'Structured data can enable rich results in search listings.',
        `Detected types: ${structuredData.types.join(', ') || 'unspecified'}`,
        'No change needed.'
      ),
    });
  } else {
    results.push({
      points: 0,
      maxPoints: 5,
      finding: makeFinding(
        'seo', 'info', 'No structured data detected',
        'No JSON-LD or microdata was found.',
        'No structured data markup detected.',
        "Consider adding JSON-LD structured data relevant to this page's content."
      ),
    });
  }

  return results;
}

// =============================================================================
// PERFORMANCE — 3 checks, weights sum to 100
// =============================================================================
function performanceChecks(scan) {
  const results = [];
  const https = Boolean(scan.technical?.https);
  const redirected = Boolean(scan.technical?.redirected);
  const duration = scan.technical?.scanDurationMs;

  // 1. HTTPS (40)
  if (https) {
    results.push({
      points: 40,
      maxPoints: 40,
      finding: makeFinding(
        'performance', 'good', 'Site is served over HTTPS',
        'HTTPS is required for security and is a browser/search-engine trust signal.',
        `Final URL: ${scan.finalUrl}`,
        'No change needed.'
      ),
    });
  } else {
    results.push({
      points: 0,
      maxPoints: 40,
      finding: makeFinding(
        'performance', 'critical', 'Site is not served over HTTPS',
        'The page was served over plain HTTP, which is insecure and is penalized by browsers and search engines.',
        `Final URL: ${scan.finalUrl}`,
        'Obtain an SSL/TLS certificate and redirect all HTTP traffic to HTTPS.'
      ),
    });
  }

  // 2. Redirect overhead (20)
  if (!redirected) {
    results.push({
      points: 20,
      maxPoints: 20,
      finding: makeFinding(
        'performance', 'good', 'No redirect overhead',
        'The requested URL resolved directly without a redirect.',
        `Requested: ${scan.url} → Final: ${scan.finalUrl}`,
        'No change needed.'
      ),
    });
  } else {
    results.push({
      points: 10,
      maxPoints: 20,
      finding: makeFinding(
        'performance', 'warning', 'URL required a redirect',
        'A redirect adds an extra network round trip before the page can start loading.',
        `Requested: ${scan.url} → Final: ${scan.finalUrl}`,
        'Where possible, link directly to the final canonical URL to avoid redirect overhead.'
      ),
    });
  }

  // 3. Response time (40)
  if (typeof duration === 'number') {
    if (duration < 1000) {
      results.push({
        points: 40,
        maxPoints: 40,
        finding: makeFinding(
          'performance', 'good', 'Fast server response',
          'The page responded quickly when our scanner fetched it.',
          `Measured fetch time: ${duration}ms (server response, not a full browser page-load measurement).`,
          'No change needed.'
        ),
      });
    } else if (duration < 3000) {
      results.push({
        points: 22,
        maxPoints: 40,
        finding: makeFinding(
          'performance', 'warning', 'Moderate server response time',
          'The page took longer than ideal to respond to our scanner.',
          `Measured fetch time: ${duration}ms.`,
          'Investigate server-side response time: caching, database queries, or hosting tier.'
        ),
      });
    } else {
      results.push({
        points: 5,
        maxPoints: 40,
        finding: makeFinding(
          'performance', 'critical', 'Slow server response',
          'The page took a long time to respond, which harms both user experience and SEO.',
          `Measured fetch time: ${duration}ms.`,
          'Investigate server performance, enable caching, or upgrade hosting.'
        ),
      });
    }
  } else {
    results.push({
      points: 0,
      maxPoints: 40,
      finding: makeFinding(
        'performance', 'info', 'Response time not measured',
        'No timing data was available for this scan.',
        'scanDurationMs missing from scan data.',
        'Re-run the audit to capture timing data.'
      ),
    });
  }

  return results;
}

// =============================================================================
// MOBILE — 3 checks, weights sum to 100
// =============================================================================
function mobileChecks(scan) {
  const results = [];
  const viewport = scan.mobile?.viewport || { present: false, content: null };
  const content = viewport.content || '';

  // 1. Viewport tag present (60)
  if (viewport.present) {
    results.push({
      points: 60,
      maxPoints: 60,
      finding: makeFinding(
        'mobile', 'good', 'Viewport meta tag present',
        'A viewport tag is required for pages to render correctly on mobile devices.',
        `Viewport content: "${content}"`,
        'No change needed.'
      ),
    });
  } else {
    results.push({
      points: 0,
      maxPoints: 60,
      finding: makeFinding(
        'mobile', 'critical', 'Missing viewport meta tag',
        'Without a viewport tag, mobile browsers typically render a desktop-width layout and zoom out, hurting usability.',
        'No <meta name="viewport"> tag detected.',
        'Add <meta name="viewport" content="width=device-width, initial-scale=1">.'
      ),
    });
  }

  // 2. Scales to device width (25)
  if (viewport.present && /width\s*=\s*device-width/i.test(content)) {
    results.push({
      points: 25,
      maxPoints: 25,
      finding: makeFinding(
        'mobile', 'good', 'Viewport scales to device width',
        "The viewport is configured to match the device's screen width.",
        `Viewport content: "${content}"`,
        'No change needed.'
      ),
    });
  } else if (viewport.present) {
    results.push({
      points: 5,
      maxPoints: 25,
      finding: makeFinding(
        'mobile', 'warning', 'Viewport may not scale correctly',
        'The viewport tag exists but does not declare width=device-width.',
        `Viewport content: "${content}"`,
        'Update the viewport content to include width=device-width.'
      ),
    });
  } else {
    results.push({
      points: 0,
      maxPoints: 25,
      finding: makeFinding(
        'mobile', 'critical', 'Cannot verify device-width scaling',
        'No viewport tag exists to evaluate.',
        'No <meta name="viewport"> tag detected.',
        'Add a viewport tag first.'
      ),
    });
  }

  // 3. Initial scale declared (15)
  if (viewport.present && /initial-scale\s*=\s*1(\.0)?/i.test(content)) {
    results.push({
      points: 15,
      maxPoints: 15,
      finding: makeFinding(
        'mobile', 'good', 'Initial zoom level configured',
        'An explicit initial-scale avoids inconsistent default zoom across mobile browsers.',
        `Viewport content: "${content}"`,
        'No change needed.'
      ),
    });
  } else if (viewport.present) {
    results.push({
      points: 8,
      maxPoints: 15,
      finding: makeFinding(
        'mobile', 'info', 'Initial zoom level not explicitly set',
        'initial-scale=1 is commonly recommended for consistent rendering across mobile browsers.',
        `Viewport content: "${content}"`,
        'Consider adding initial-scale=1 to the viewport tag.'
      ),
    });
  } else {
    results.push({
      points: 0,
      maxPoints: 15,
      finding: makeFinding(
        'mobile', 'info', 'Cannot verify initial zoom level',
        'No viewport tag exists to evaluate.',
        'No <meta name="viewport"> tag detected.',
        'Add a viewport tag first.'
      ),
    });
  }

  return results;
}

// =============================================================================
// ACCESSIBILITY — 3 checks, weights sum to 100
// =============================================================================
function accessibilityChecks(scan) {
  const results = [];
  const totalImages = scan.images?.count ?? 0;
  const missingAlt = scan.accessibility?.imagesMissingAlt || { count: 0, percentage: 0 };
  const h1Count = scan.headings?.h1?.count ?? 0;
  const forms = scan.forms || [];

  // 1. Image alt text coverage (40)
  if (totalImages === 0) {
    results.push({
      points: 40,
      maxPoints: 40,
      finding: makeFinding(
        'accessibility', 'good', 'No images to evaluate',
        'This page has no <img> elements, so there is nothing to flag for alt text.',
        'Image count: 0',
        'If images are added later, ensure each has descriptive alt text.'
      ),
    });
  } else if (missingAlt.percentage === 0) {
    results.push({
      points: 40,
      maxPoints: 40,
      finding: makeFinding(
        'accessibility', 'good', 'All images have alt text',
        'Every detected image includes an alt attribute, supporting screen reader users.',
        `${totalImages} image(s) checked, 0 missing alt text.`,
        'No change needed.'
      ),
    });
  } else {
    const pts = Math.round(40 * (1 - missingAlt.percentage / 100));
    const severity = missingAlt.percentage <= 20 ? 'warning' : 'critical';
    const title = severity === 'warning' ? 'Some images are missing alt text' : 'Most images are missing alt text';
    results.push({
      points: pts,
      maxPoints: 40,
      finding: makeFinding(
        'accessibility', severity, title,
        severity === 'warning'
          ? 'A minority of images lack alt attributes, creating gaps for screen reader users.'
          : 'A large share of images lack alt attributes, a significant barrier for screen reader users.',
        `${missingAlt.count} of ${totalImages} images (${missingAlt.percentage}%) are missing alt text.`,
        'Add descriptive alt text to every meaningful image (decorative images can use alt="").'
      ),
    });
  }

  // 2. Single H1 landmark (30)
  if (h1Count === 1) {
    results.push({
      points: 30,
      maxPoints: 30,
      finding: makeFinding(
        'accessibility', 'good', 'Single H1 landmark present',
        'Exactly one H1 gives assistive technology users a clear page landmark.',
        '1 <h1> element detected.',
        'No change needed.'
      ),
    });
  } else if (h1Count === 0) {
    results.push({
      points: 0,
      maxPoints: 30,
      finding: makeFinding(
        'accessibility', 'critical', 'No H1 landmark found',
        'Screen reader users often navigate by heading landmarks; without an H1 the page lacks a clear entry point.',
        'No <h1> element detected.',
        "Add a single H1 heading describing the page's main content."
      ),
    });
  } else {
    results.push({
      points: 15,
      maxPoints: 30,
      finding: makeFinding(
        'accessibility', 'warning', 'Multiple H1 landmarks found',
        'Multiple H1s can confuse heading-based navigation for assistive technology.',
        `${h1Count} <h1> elements detected.`,
        'Use a single H1 per page.'
      ),
    });
  }

  // 3. Form label coverage (30)
  const formStats = forms.reduce(
    (acc, f) => {
      acc.labelable += f.labelableInputCount || 0;
      acc.unlabeled += f.unlabeledInputCount || 0;
      return acc;
    },
    { labelable: 0, unlabeled: 0 }
  );

  if (formStats.labelable === 0) {
    results.push({
      points: 30,
      maxPoints: 30,
      finding: makeFinding(
        'accessibility', 'good', 'No form inputs to evaluate',
        'This page has no text-style form fields requiring labels.',
        'Labelable form input count: 0',
        'If forms are added later, ensure every input has an associated label.'
      ),
    });
  } else if (formStats.unlabeled === 0) {
    results.push({
      points: 30,
      maxPoints: 30,
      finding: makeFinding(
        'accessibility', 'good', 'All form fields have labels',
        'Every detected form input has an associated label, wrapping label, or aria-label.',
        `${formStats.labelable} input(s) checked, all labeled.`,
        'No change needed.'
      ),
    });
  } else {
    const labeledRatio = 1 - formStats.unlabeled / formStats.labelable;
    const pts = Math.round(30 * labeledRatio);
    const severity = labeledRatio >= 0.5 ? 'warning' : 'critical';
    results.push({
      points: pts,
      maxPoints: 30,
      finding: makeFinding(
        'accessibility', severity, 'Some form fields are missing labels',
        'Inputs without an associated <label> (or aria-label) are harder for screen reader users to fill in correctly.',
        `${formStats.unlabeled} of ${formStats.labelable} form input(s) have no detectable label.`,
        'Add a <label for="..."> (or aria-label/aria-labelledby) for every form field.'
      ),
    });
  }

  return results;
}

// =============================================================================
// CONTENT — 3 checks, weights sum to 100
// =============================================================================
function contentChecks(scan) {
  const results = [];
  const wordCount = scan.content?.wordCount ?? 0;
  const h1Count = scan.headings?.h1?.count ?? 0;
  const h2Count = scan.headings?.h2?.count ?? 0;

  // 1. Word count adequacy (60)
  if (wordCount === 0) {
    results.push({
      points: 0,
      maxPoints: 60,
      finding: makeFinding(
        'content', 'critical', 'No readable text content found',
        'The page appears to have no visible body text.',
        'Word count: 0',
        "Add substantive, unique text content describing this page's purpose."
      ),
    });
  } else if (wordCount < 150) {
    results.push({
      points: 15,
      maxPoints: 60,
      finding: makeFinding(
        'content', 'critical', 'Very thin content',
        'Pages with very little text often struggle to rank and may look unfinished to visitors.',
        `Word count: ${wordCount}`,
        'Expand the page with more substantive, useful content (aim for 300+ words where relevant).'
      ),
    });
  } else if (wordCount < 300) {
    results.push({
      points: 35,
      maxPoints: 60,
      finding: makeFinding(
        'content', 'warning', 'Content is on the thin side',
        'The page has some text, but may benefit from more depth.',
        `Word count: ${wordCount}`,
        'Consider expanding key sections with more detail.'
      ),
    });
  } else {
    results.push({
      points: 60,
      maxPoints: 60,
      finding: makeFinding(
        'content', 'good', 'Content length looks healthy',
        'The page has a substantive amount of text content.',
        `Word count: ${wordCount}`,
        'No change needed.'
      ),
    });
  }

  // 2. Primary heading (20)
  if (h1Count === 1) {
    results.push({
      points: 20,
      maxPoints: 20,
      finding: makeFinding(
        'content', 'good', 'Clear primary heading',
        'Exactly one H1 helps visitors immediately understand the page topic.',
        '1 <h1> element detected.',
        'No change needed.'
      ),
    });
  } else if (h1Count === 0) {
    results.push({
      points: 0,
      maxPoints: 20,
      finding: makeFinding(
        'content', 'critical', 'No primary heading found',
        "Without an H1, visitors and search engines lack a clear statement of the page's topic.",
        'No <h1> element detected.',
        'Add a single, descriptive H1 heading.'
      ),
    });
  } else {
    results.push({
      points: 10,
      maxPoints: 20,
      finding: makeFinding(
        'content', 'warning', 'Multiple top-level headings',
        "Multiple H1s can make the page's primary topic less clear.",
        `${h1Count} <h1> elements detected.`,
        'Use a single H1 and demote the rest to H2/H3.'
      ),
    });
  }

  // 3. Subheading usage (20)
  if (h2Count > 0) {
    results.push({
      points: 20,
      maxPoints: 20,
      finding: makeFinding(
        'content', 'good', 'Content is broken up with subheadings',
        'Subheadings improve scannability for readers and give search engines additional topical signals.',
        `${h2Count} <h2> element(s) detected.`,
        'No change needed.'
      ),
    });
  } else {
    results.push({
      points: 10,
      maxPoints: 20,
      finding: makeFinding(
        'content', 'info', 'No subheadings detected',
        'The page has no H2 subheadings.',
        'No <h2> elements detected.',
        'For longer content, break sections up with descriptive H2 subheadings.'
      ),
    });
  }

  return results;
}

// =============================================================================
// UX — 4 checks, weights sum to 100
// =============================================================================
function uxChecks(scan) {
  const results = [];
  const internalLinks = scan.links?.internal?.count ?? 0;
  const ctaCount = scan.content?.ctaElements?.count ?? 0;
  const ctaSamples = scan.content?.ctaElements?.samples || [];
  const forms = scan.forms || [];

  // 1. Internal navigation present (30)
  if (internalLinks >= 3) {
    results.push({
      points: 30,
      maxPoints: 30,
      finding: makeFinding(
        'ux', 'good', 'Page provides internal navigation',
        'Multiple internal links give visitors clear paths to explore the site.',
        `${internalLinks} internal link(s) detected.`,
        'No change needed.'
      ),
    });
  } else if (internalLinks > 0) {
    results.push({
      points: 15,
      maxPoints: 30,
      finding: makeFinding(
        'ux', 'warning', 'Limited internal navigation',
        'Few internal links were found, which may limit how visitors explore the rest of the site.',
        `${internalLinks} internal link(s) detected.`,
        'Add links to related pages, categories, or key site sections.'
      ),
    });
  } else {
    results.push({
      points: 0,
      maxPoints: 30,
      finding: makeFinding(
        'ux', 'critical', 'No internal links found',
        'This page has no links to other pages on the same site, which can strand visitors.',
        '0 internal links detected.',
        'Add navigation or contextual links to other pages on the site.'
      ),
    });
  }

  // 2. CTA clarity (30)
  if (ctaCount === 0) {
    results.push({
      points: 0,
      maxPoints: 30,
      finding: makeFinding(
        'ux', 'warning', 'No clear call-to-action detected',
        'No buttons or links matched common call-to-action language.',
        '0 CTA-style elements detected.',
        'Add a clear call-to-action such as "Get Started" or "Contact Us".'
      ),
    });
  } else if (ctaCount <= 5) {
    results.push({
      points: 30,
      maxPoints: 30,
      finding: makeFinding(
        'ux', 'good', 'Clear call-to-action present',
        'The page includes button/link text matching common call-to-action patterns.',
        `${ctaCount} CTA-style element(s) detected${ctaSamples.length ? `: ${ctaSamples.slice(0, 3).join(', ')}` : ''}.`,
        'No change needed.'
      ),
    });
  } else {
    results.push({
      points: 18,
      maxPoints: 30,
      finding: makeFinding(
        'ux', 'info', 'Many competing calls-to-action',
        'A large number of CTA-style elements were found, which may dilute focus on a single primary action.',
        `${ctaCount} CTA-style elements detected.`,
        'Consider emphasizing one primary action per page.'
      ),
    });
  }

  // 3. Form usability (25)
  const brokenForms = forms.filter((f) => (f.inputCount || 0) === 0);
  if (forms.length === 0) {
    results.push({
      points: 25,
      maxPoints: 25,
      finding: makeFinding(
        'ux', 'good', 'No forms to evaluate',
        'This page has no forms, so there is nothing to flag for form usability.',
        'Form count: 0',
        'No change needed.'
      ),
    });
  } else if (brokenForms.length === 0) {
    results.push({
      points: 25,
      maxPoints: 25,
      finding: makeFinding(
        'ux', 'good', 'Forms contain input fields',
        'Every detected form includes at least one input field.',
        `${forms.length} form(s) checked, all contain input fields.`,
        'No change needed.'
      ),
    });
  } else {
    results.push({
      points: 10,
      maxPoints: 25,
      finding: makeFinding(
        'ux', 'warning', 'Empty form detected',
        'One or more <form> elements have no input fields, which usually indicates a broken or incomplete form.',
        `${brokenForms.length} of ${forms.length} form(s) have no input fields.`,
        'Check for JavaScript-rendered fields that may be missing from the initial HTML, or remove the unused form.'
      ),
    });
  }

  // 4. Site navigation depth signal (15) — honest about single-page scope
  if (internalLinks >= 5) {
    results.push({
      points: 15,
      maxPoints: 15,
      finding: makeFinding(
        'ux', 'good', 'Reasonable link depth on this page',
        'A healthy number of internal links suggests good connectivity from this page.',
        `${internalLinks} internal link(s) detected on this page.`,
        'No change needed.'
      ),
    });
  } else {
    results.push({
      points: 8,
      maxPoints: 15,
      finding: makeFinding(
        'ux', 'info', 'Limited data on overall site navigation',
        "This audit only scans a single page, so broader site navigation and broken links across the full site can't be fully assessed here.",
        `${internalLinks} internal link(s) detected on this page.`,
        'Consider a full-site crawl to check navigation depth and for broken links site-wide.'
      ),
    });
  }

  return results;
}

// =============================================================================
// CONVERSION — 4 checks, weights sum to 100
// =============================================================================
function conversionChecks(scan) {
  const results = [];
  const ctaCount = scan.content?.ctaElements?.count ?? 0;
  const forms = scan.forms || [];
  const contact = scan.contact || { hasEmailLink: false, hasPhoneLink: false };

  // 1. CTA presence (30)
  if (ctaCount > 0) {
    results.push({
      points: 30,
      maxPoints: 30,
      finding: makeFinding(
        'conversion', 'good', 'Call-to-action present',
        'The page includes at least one clear call-to-action.',
        `${ctaCount} CTA-style element(s) detected.`,
        'No change needed.'
      ),
    });
  } else {
    results.push({
      points: 0,
      maxPoints: 30,
      finding: makeFinding(
        'conversion', 'critical', 'No call-to-action detected',
        'Without a clear CTA, visitors have no obvious next step.',
        '0 CTA-style elements detected.',
        'Add a clear, action-oriented button or link (e.g. "Contact Us", "Get a Quote").'
      ),
    });
  }

  // 2. Contact form present (25)
  if (forms.length > 0) {
    results.push({
      points: 25,
      maxPoints: 25,
      finding: makeFinding(
        'conversion', 'good', 'A form is available on the page',
        'Forms give visitors a direct way to convert (contact, sign up, request a quote, etc.).',
        `${forms.length} form(s) detected.`,
        'No change needed.'
      ),
    });
  } else {
    results.push({
      points: 0,
      maxPoints: 25,
      finding: makeFinding(
        'conversion', 'warning', 'No form detected',
        'No <form> element was found on this page.',
        '0 forms detected.',
        'Add a contact or lead-capture form if this page is meant to convert visitors.'
      ),
    });
  }

  // 3. Direct contact info (25)
  if (contact.hasEmailLink || contact.hasPhoneLink) {
    const parts = [];
    if (contact.hasEmailLink) parts.push('email link');
    if (contact.hasPhoneLink) parts.push('phone link');
    results.push({
      points: 25,
      maxPoints: 25,
      finding: makeFinding(
        'conversion', 'good', 'Direct contact information found',
        'Visitors can reach out directly via a detected contact link.',
        `Detected: ${parts.join(' and ')}.`,
        'No change needed.'
      ),
    });
  } else {
    results.push({
      points: 0,
      maxPoints: 25,
      finding: makeFinding(
        'conversion', 'warning', 'No direct contact information found',
        'No mailto: or tel: link was detected on this page.',
        'No mailto: or tel: links detected.',
        'Add a visible email address or phone number (as a mailto:/tel: link) so visitors can reach out directly.'
      ),
    });
  }

  // 4. Primary action clarity (20)
  if (ctaCount === 0) {
    results.push({
      points: 0,
      maxPoints: 20,
      finding: makeFinding(
        'conversion', 'critical', 'No primary action to evaluate',
        'There is no CTA to assess for clarity.',
        '0 CTA-style elements detected.',
        'Add a call-to-action first.'
      ),
    });
  } else if (ctaCount <= 10) {
    results.push({
      points: 20,
      maxPoints: 20,
      finding: makeFinding(
        'conversion', 'good', 'Primary action is reasonably clear',
        'The number of competing calls-to-action is reasonable, keeping the primary action clear.',
        `${ctaCount} CTA-style element(s) detected.`,
        'No change needed.'
      ),
    });
  } else {
    results.push({
      points: 8,
      maxPoints: 20,
      finding: makeFinding(
        'conversion', 'warning', 'Too many competing calls-to-action',
        'A very high number of CTA-style elements may make it unclear what action visitors should prioritize.',
        `${ctaCount} CTA-style elements detected.`,
        'Reduce to one clear primary action per page, demoting secondary actions visually.'
      ),
    });
  }

  return results;
}

module.exports = {
  seoChecks,
  performanceChecks,
  mobileChecks,
  accessibilityChecks,
  contentChecks,
  uxChecks,
  conversionChecks,
};
