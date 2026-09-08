/**
 * htmlAnalyzer.js
 * ---------------------------------------------------------------------------
 * Parses raw HTML into the structured audit data SiteFix AI reports on.
 *
 * Uses cheerio, which parses markup into a DOM-like structure WITHOUT
 * executing any scripts, loading any subresources, or evaluating any code
 * found in the page — it is purely a text/markup parser.
 * ---------------------------------------------------------------------------
 */

const cheerio = require('cheerio');
const { URL } = require('url');

const MAX_SAMPLES = 15;
const MAX_HEADINGS = 30;
const MAX_BUTTONS = 40;
const MAX_CTA_SAMPLES = 20;

const CTA_PATTERN =
  /\b(buy now|shop now|sign up|sign\s?up|get started|start (your )?free|try (it )?free|start trial|free trial|subscribe|contact us|book (a )?demo|request a demo|download|learn more|add to cart|checkout|join now|get a quote|call now|order now|schedule (a )?call)\b/i;

function absolutize(href, baseUrl) {
  if (!href) return null;
  try {
    return new URL(href, baseUrl).toString();
  } catch (err) {
    return null;
  }
}

/**
 * @param {string} html
 * @param {URL} pageUrlObj The final URL the page was served from (post-redirects).
 */
function analyzeHtml(html, pageUrlObj) {
  const $ = cheerio.load(html);

  const baseHrefAttr = $('base').attr('href');
  const baseUrl = (baseHrefAttr && absolutize(baseHrefAttr, pageUrlObj.toString())) || pageUrlObj.toString();

  // ---- Title & meta description --------------------------------------------
  const title = $('title').first().text().trim() || null;
  const metaDescriptionRaw = $('meta[name="description"]').attr('content');
  const metaDescription = metaDescriptionRaw ? metaDescriptionRaw.trim() : null;

  // ---- Canonical -------------------------------------------------------------
  const canonicalHref = $('link[rel="canonical"]').attr('href');
  const canonicalUrl = canonicalHref ? absolutize(canonicalHref, baseUrl) : null;

  // ---- Headings ----------------------------------------------------------
  const h1Els = $('h1');
  const h1Text = h1Els
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean)
    .slice(0, MAX_HEADINGS);

  const h2Els = $('h2');
  const h2Text = h2Els
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean)
    .slice(0, MAX_HEADINGS);

  // ---- Images --------------------------------------------------------------
  const imgEls = $('img');
  const totalImages = imgEls.length;
  const missingAltEls = imgEls.filter((_, el) => {
    const alt = $(el).attr('alt');
    return alt === undefined || alt.trim() === '';
  });
  const missingAltSamples = missingAltEls
    .map((_, el) => $(el).attr('src') || $(el).attr('data-src') || '(no src attribute)')
    .get()
    .slice(0, 10);

  // ---- Links -----------------------------------------------------------------
  let internalCount = 0;
  let externalCount = 0;
  const internalSamples = [];
  const externalSamples = [];
  const pageHost = pageUrlObj.hostname;

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const lower = href.trim().toLowerCase();
    if (
      lower.startsWith('javascript:') ||
      lower.startsWith('mailto:') ||
      lower.startsWith('tel:') ||
      lower === '#' ||
      lower.startsWith('#')
    ) {
      return;
    }
    const abs = absolutize(href, baseUrl);
    if (!abs) return;
    let linkHost;
    try {
      linkHost = new URL(abs).hostname;
    } catch (err) {
      return;
    }
    if (linkHost === pageHost) {
      internalCount += 1;
      if (internalSamples.length < MAX_SAMPLES) internalSamples.push(abs);
    } else {
      externalCount += 1;
      if (externalSamples.length < MAX_SAMPLES) externalSamples.push(abs);
    }
  });

  // ---- Buttons -----------------------------------------------------------
  const buttons = [];
  $('button').each((_, el) => {
    if (buttons.length >= MAX_BUTTONS) return;
    buttons.push({ type: 'button', text: $(el).text().trim().slice(0, 120) || null });
  });
  $('input[type="submit"], input[type="button"]').each((_, el) => {
    if (buttons.length >= MAX_BUTTONS) return;
    const type = ($(el).attr('type') || 'button').toLowerCase();
    const value = $(el).attr('value');
    buttons.push({ type, text: value ? value.trim().slice(0, 120) : null });
  });

  // ---- CTA-like elements -------------------------------------------------
  const ctaSamples = [];
  $('a, button, input[type="submit"], input[type="button"]').each((_, el) => {
    if (ctaSamples.length >= MAX_CTA_SAMPLES) return;
    const text = ($(el).text() || $(el).attr('value') || '').trim();
    if (text && CTA_PATTERN.test(text)) {
      ctaSamples.push(text.slice(0, 80));
    }
  });

  // ---- Forms ---------------------------------------------------------------
  const LABELABLE_TYPES = new Set([
    'text', 'email', 'tel', 'url', 'search', 'number', 'password', 'date',
    'datetime-local', 'month', 'week', 'time', 'color',
  ]);
  const forms = [];
  $('form').each((_, el) => {
    const $form = $(el);
    const actionAttr = $form.attr('action');

    let relevantInputCount = 0;
    let unlabeledInputCount = 0;
    $form.find('input, textarea, select').each((__, inputEl) => {
      const $input = $(inputEl);
      const tag = inputEl.tagName ? inputEl.tagName.toLowerCase() : '';
      const type = (tag === 'input' ? $input.attr('type') || 'text' : 'text').toLowerCase();
      if (tag === 'input' && !LABELABLE_TYPES.has(type)) return; // skip submit/button/hidden/checkbox/radio etc.

      relevantInputCount += 1;
      const id = $input.attr('id');
      const hasForLabel = Boolean(id) && $(`label[for="${id}"]`).length > 0;
      const isWrappedInLabel = $input.closest('label').length > 0;
      const hasAriaLabel = Boolean($input.attr('aria-label') || $input.attr('aria-labelledby'));
      const isLabeled = hasForLabel || isWrappedInLabel || hasAriaLabel;
      if (!isLabeled) unlabeledInputCount += 1;
    });

    forms.push({
      action: actionAttr ? absolutize(actionAttr, baseUrl) : null,
      method: ($form.attr('method') || 'get').toLowerCase(),
      inputCount: $form.find('input, textarea, select').length,
      unlabeledInputCount,
      labelableInputCount: relevantInputCount,
    });
  });

  // ---- Contact info (mailto: / tel: links) ----------------------------------
  const emailLinks = [];
  const phoneLinks = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const lower = href.trim().toLowerCase();
    if (lower.startsWith('mailto:') && emailLinks.length < MAX_SAMPLES) {
      emailLinks.push(href.trim().slice(7).split('?')[0]);
    } else if (lower.startsWith('tel:') && phoneLinks.length < MAX_SAMPLES) {
      phoneLinks.push(href.trim().slice(4));
    }
  });

  // ---- Viewport --------------------------------------------------------------
  const viewportContent = $('meta[name="viewport"]').attr('content') || null;

  // ---- Robots meta -------------------------------------------------------
  const robotsMeta = $('meta[name="robots"]').attr('content') || null;

  // ---- Open Graph --------------------------------------------------------
  const openGraph = {};
  $('meta[property^="og:"]').each((_, el) => {
    const prop = $(el).attr('property');
    const content = $(el).attr('content');
    if (prop && content) {
      openGraph[prop.slice(3)] = content;
    }
  });

  // ---- Structured data -----------------------------------------------------
  // NOTE: must run before the script/style removal below, since JSON-LD
  // lives inside <script> tags.
  const ldJsonBlocks = $('script[type="application/ld+json"]');
  const structuredDataTypes = new Set();
  ldJsonBlocks.each((_, el) => {
    try {
      const parsed = JSON.parse($(el).contents().text());
      const items = Array.isArray(parsed) ? parsed : [parsed];
      items.forEach((item) => {
        if (item && item['@type']) {
          const t = item['@type'];
          (Array.isArray(t) ? t : [t]).forEach((tt) => structuredDataTypes.add(String(tt)));
        }
      });
    } catch (err) {
      // Malformed JSON-LD is ignored for type extraction, but its presence
      // still counts below.
    }
  });
  const hasMicrodata = $('[itemscope]').length > 0;
  const structuredDataPresent = ldJsonBlocks.length > 0 || hasMicrodata;

  // ---- Favicon (markup-declared) -------------------------------------------
  const faviconHref =
    $('link[rel="icon"]').attr('href') ||
    $('link[rel="shortcut icon"]').attr('href') ||
    $('link[rel="apple-touch-icon"]').attr('href') ||
    null;
  const faviconFromMarkup = faviconHref ? absolutize(faviconHref, baseUrl) : null;

  // ---- Word count (visible text only) ---------------------------------------
  // Run last: removes <script>/<style>/etc. so they don't pollute the text,
  // which would break anything above that still needs to read them.
  $('script, style, noscript, template').remove();
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  const wordCount = bodyText ? bodyText.split(' ').filter(Boolean).length : 0;

  return {
    title,
    metaDescription,
    headings: {
      h1: { count: h1Els.length, text: h1Text },
      h2: { count: h2Els.length, text: h2Text },
    },
    images: {
      count: totalImages,
      missingAlt: { count: missingAltEls.length, samples: missingAltSamples },
    },
    links: {
      total: internalCount + externalCount,
      internal: { count: internalCount, samples: internalSamples },
      external: { count: externalCount, samples: externalSamples },
    },
    buttons,
    forms,
    seo: {
      canonicalUrl,
      robotsMeta,
      openGraph,
      structuredData: {
        present: structuredDataPresent,
        types: Array.from(structuredDataTypes),
      },
    },
    mobile: {
      viewport: { present: Boolean(viewportContent), content: viewportContent },
    },
    accessibility: {
      imagesMissingAlt: {
        count: missingAltEls.length,
        percentage:
          totalImages > 0 ? Math.round((missingAltEls.length / totalImages) * 1000) / 10 : 0,
      },
    },
    content: {
      wordCount,
      ctaElements: { count: ctaSamples.length, samples: ctaSamples },
    },
    contact: {
      hasEmailLink: emailLinks.length > 0,
      hasPhoneLink: phoneLinks.length > 0,
      emailLinks,
      phoneLinks,
    },
    faviconFromMarkup,
  };
}

module.exports = { analyzeHtml };
