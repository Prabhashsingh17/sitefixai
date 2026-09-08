/**
 * dashboard.js
 * ---------------------------------------------------------------------------
 * Renders the SiteFix AI audit dashboard entirely from real API data, and
 * drives the "Fix with AI" modal.
 *
 * Data flow:
 *   1. Read scanId from the query string.
 *   2. GET /api/scan/:scanId. If the scan is still pending/in_progress
 *      (the backend scan is async), poll a few times before giving up.
 *   3. Render the top bar, hero score, category cards, and findings list
 *      directly from the scan record's real `audit` data — nothing here is
 *      hardcoded or invented. If the audit failed or is missing, an honest
 *      error state is shown instead of a fake dashboard.
 *
 * "Fix with AI" opens a modal that calls the real POST /api/fix/generate
 * endpoint and shows its real response. Nothing is ever applied to the
 * user's site automatically -- the modal only ever offers Copy/Regenerate,
 * never an "Apply" action.
 *
 * "Generate Report" links to report.html, which is still a placeholder.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  const POLL_INTERVAL_MS = 1200;
  const MAX_POLL_ATTEMPTS = 12; // ~14s of polling before giving up

  const CATEGORY_LABELS = {
    seo: 'SEO',
    performance: 'Performance',
    mobile: 'Mobile',
    accessibility: 'Accessibility',
    content: 'Content',
    ux: 'UX',
    conversion: 'Conversion',
  };
  const CATEGORY_ORDER = ['seo', 'performance', 'mobile', 'accessibility', 'content', 'ux', 'conversion'];

  const SEVERITY_LABELS = { critical: 'Critical', warning: 'Warning', info: 'Suggestion', good: 'Good' };
  const SEVERITY_RANK = { critical: 0, warning: 1, info: 2, good: 3 };

  // Mirrors server/services/fix/promptBuilder.js's FIX_TYPES/FIX_TYPE_LABELS.
  const FIX_TYPE_OPTIONS = [
    { value: 'title', label: 'Page title' },
    { value: 'meta_description', label: 'Meta description' },
    { value: 'headline', label: 'H1 / headline' },
    { value: 'cta', label: 'CTA text' },
    { value: 'alt_text', label: 'Image alt text' },
    { value: 'seo_content', label: 'Meta/SEO content' },
    { value: 'faq_content', label: 'FAQ content' },
    { value: 'landing_copy', label: 'Landing page copy' },
    { value: 'html_snippet', label: 'HTML snippet' },
  ];
  const FIX_TYPE_LABEL_MAP = FIX_TYPE_OPTIONS.reduce((map, opt) => {
    map[opt.value] = opt.label;
    return map;
  }, {});

  // Maps a finding's exact (deterministic) title to the fix type it's best
  // addressed by. Findings with no entry here (e.g. performance/HTTPS,
  // response-time, or purely structural navigation findings) don't have a
  // meaningful AI content fix -- "Fix with AI" tells the user that plainly
  // instead of opening an empty/broken modal.
  const FIX_TYPE_BY_FINDING_TITLE = {
    'Missing page title': 'title',
    'Title length is too short': 'title',
    'Title length is too long': 'title',
    'Missing meta description': 'meta_description',
    'Meta description length is short': 'meta_description',
    'Meta description length is long': 'meta_description',
    'Missing H1 heading': 'headline',
    'Multiple H1 headings found': 'headline',
    'Missing canonical URL': 'html_snippet',
    'No Open Graph metadata': 'html_snippet',
    'Partial Open Graph metadata': 'html_snippet',
    'No structured data detected': 'html_snippet',
    'Missing viewport meta tag': 'html_snippet',
    'Viewport may not scale correctly': 'html_snippet',
    'Some images are missing alt text': 'alt_text',
    'Most images are missing alt text': 'alt_text',
    'No H1 landmark found': 'headline',
    'Multiple H1 landmarks found': 'headline',
    'Some form fields are missing labels': 'html_snippet',
    'No readable text content found': 'landing_copy',
    'Very thin content': 'landing_copy',
    'Content is on the thin side': 'landing_copy',
    'No primary heading found': 'headline',
    'Multiple top-level headings': 'headline',
    'No subheadings detected': 'landing_copy',
    'No clear call-to-action detected': 'cta',
    'Many competing calls-to-action': 'cta',
    'Empty form detected': 'html_snippet',
    'No call-to-action detected': 'cta',
    'No form detected': 'html_snippet',
    'No direct contact information found': 'html_snippet',
    'Too many competing calls-to-action': 'cta',
    'No primary action to evaluate': 'cta',
  };

  function inferFixType(finding) {
    return FIX_TYPE_BY_FINDING_TITLE[finding.title] || null;
  }

  // ---- Element references --------------------------------------------------
  const els = {
    loading: document.getElementById('dashLoading'),
    loadingText: document.getElementById('dashLoadingText'),
    empty: document.getElementById('dashEmpty'),
    error: document.getElementById('dashError'),
    errorTitle: document.getElementById('dashErrorTitle'),
    errorMessage: document.getElementById('dashErrorMessage'),
    retryBtn: document.getElementById('dashRetryBtn'),
    content: document.getElementById('dashContent'),
    url: document.getElementById('dashUrl'),
    date: document.getElementById('dashDate'),
    generateReportBtn: document.getElementById('generateReportBtn'),
    scoreRingValue: document.getElementById('scoreRingValue'),
    overallScoreNum: document.getElementById('overallScoreNum'),
    summaryText: document.getElementById('dashSummaryText'),
    statCritical: document.getElementById('statCritical'),
    statWarning: document.getElementById('statWarning'),
    statInfo: document.getElementById('statInfo'),
    statGood: document.getElementById('statGood'),
    categoryCards: document.getElementById('categoryCards'),
    findingsTabs: document.getElementById('findingsTabs'),
    findingsSort: document.getElementById('findingsSort'),
    findingsList: document.getElementById('findingsList'),
    findingsEmpty: document.getElementById('findingsEmpty'),
    toast: document.getElementById('toast'),

    recentAuditsSection: document.getElementById('recentAuditsSection'),
    recentAuditsList: document.getElementById('recentAuditsList'),

    // Fix modal
    fixOverlay: document.getElementById('fixOverlay'),
    fixModal: document.getElementById('fixModal'),
    fixModalTitle: document.getElementById('fixModalTitle'),
    fixModalClose: document.getElementById('fixModalClose'),
    fixProblemText: document.getElementById('fixProblemText'),
    fixEvidenceText: document.getElementById('fixEvidenceText'),
    fixTypeSelect: document.getElementById('fixTypeSelect'),
    fixCurrentSection: document.getElementById('fixCurrentSection'),
    fixCurrentValue: document.getElementById('fixCurrentValue'),
    fixLoading: document.getElementById('fixLoading'),
    fixError: document.getElementById('fixError'),
    fixErrorMessage: document.getElementById('fixErrorMessage'),
    fixRetryBtn: document.getElementById('fixRetryBtn'),
    fixResult: document.getElementById('fixResult'),
    fixReasonText: document.getElementById('fixReasonText'),
    fixImprovedValue: document.getElementById('fixImprovedValue'),
    fixCopyBtn: document.getElementById('fixCopyBtn'),
    fixRegenerateBtn: document.getElementById('fixRegenerateBtn'),
    fixAlternativesSection: document.getElementById('fixAlternativesSection'),
    fixAlternativesList: document.getElementById('fixAlternativesList'),
    fixDisclaimerText: document.getElementById('fixDisclaimerText'),
  };

  const SCORE_RING_CIRCUMFERENCE = 2 * Math.PI * 70; // r=70, matches the SVG

  // Module state
  let currentScanId = null;
  let currentScanResult = null; // the real ScanResult, needed for current-value previews + alt_text image selection
  let currentFindings = [];
  let activeFilter = 'all';
  let activeSort = 'severity';
  let toastTimer = null;

  const fixModalState = { finding: null, fixType: null, imageSrc: null, latestImproved: '', triggerEl: null };

  // ---- Small helpers ---------------------------------------------------------
  function showOnly(el) {
    [els.loading, els.empty, els.error, els.content].forEach((section) => {
      if (section) section.hidden = section !== el;
    });
  }

  function severityScoreClass(score) {
    if (score >= 80) return 'is-good';
    if (score >= 50) return 'is-warning';
    return 'is-critical';
  }

  function formatDate(isoString) {
    if (!isoString) return '—';
    try {
      const date = new Date(isoString);
      return date.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    } catch (err) {
      return isoString;
    }
  }

  function showToast(message) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.hidden = false;
    els.toast.classList.add('is-visible');
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      els.toast.classList.remove('is-visible');
      window.setTimeout(() => {
        els.toast.hidden = true;
      }, 200);
    }, 3200);
  }

  function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
  }

  /**
   * Returns `value` only if it's a key in `allowedMap` (e.g. SEVERITY_LABELS
   * or CATEGORY_LABELS), else `fallback`. Used before interpolating a value
   * into an HTML *attribute* (e.g. a CSS class name) inside a template
   * literal -- escapeHtml() alone only protects text content and quoted
   * attribute values from breaking out via quote characters, not from
   * altering unquoted class lists. In normal operation these values always
   * come from the server's own enum-validated audit/AI data, so this is
   * defense-in-depth against any future regression upstream, not a fix for
   * a currently-reachable input.
   */
  function safeClassToken(value, allowedMap, fallback) {
    return Object.prototype.hasOwnProperty.call(allowedMap, value) ? value : fallback;
  }

  // ---- Rendering: main dashboard --------------------------------------------
  function renderTopbar(record) {
    els.url.textContent = record.url;
    els.date.textContent = 'Scanned ' + formatDate(record.completedAt || record.createdAt);
    els.generateReportBtn.onclick = () => {
      window.location.href = 'report.html?scanId=' + encodeURIComponent(record.scanId);
    };
  }

  function renderHeroScore(audit) {
    const score = Math.max(0, Math.min(100, Math.round(audit.overallScore)));
    els.overallScoreNum.textContent = String(score);

    const offset = SCORE_RING_CIRCUMFERENCE * (1 - score / 100);
    els.scoreRingValue.style.strokeDasharray = String(SCORE_RING_CIRCUMFERENCE);
    els.scoreRingValue.style.strokeDashoffset = String(offset);
    els.scoreRingValue.classList.remove('is-good', 'is-warning', 'is-critical');
    els.scoreRingValue.classList.add(severityScoreClass(score));

    const s = audit.summary || {};
    const bySeverity = s.bySeverity || { critical: 0, warning: 0, info: 0, good: 0 };
    els.statCritical.textContent = String(bySeverity.critical || 0);
    els.statWarning.textContent = String(bySeverity.warning || 0);
    els.statInfo.textContent = String(bySeverity.info || 0);
    els.statGood.textContent = String(bySeverity.good || 0);

    const weakest = s.weakestCategory ? CATEGORY_LABELS[s.weakestCategory] || s.weakestCategory : null;
    const total = s.totalChecks || audit.findings.length;
    const parts = [`${total} checks were run across 7 categories.`];
    if ((bySeverity.critical || 0) > 0 || (bySeverity.warning || 0) > 0) {
      parts.push(`${bySeverity.critical || 0} critical issue(s) and ${bySeverity.warning || 0} warning(s) were found.`);
    } else {
      parts.push('No critical issues or warnings were found.');
    }
    if (weakest) parts.push(`The area needing the most attention is ${weakest}.`);
    els.summaryText.textContent = parts.join(' ');
  }

  function renderCategoryCards(categoryScores) {
    els.categoryCards.innerHTML = '';
    CATEGORY_ORDER.forEach((key) => {
      const score = Math.max(0, Math.min(100, Math.round(categoryScores[key] ?? 0)));
      const card = document.createElement('div');
      card.className = 'category-card ' + severityScoreClass(score);
      card.innerHTML = `
        <div class="category-card__bar-track">
          <div class="category-card__bar-fill" style="width: ${score}%;"></div>
        </div>
        <p class="category-card__name">${CATEGORY_LABELS[key] || key}</p>
        <p class="category-card__score">${score}<span>/100</span></p>
      `;
      els.categoryCards.appendChild(card);
    });
  }

  function findingMatchesFilter(finding, filter) {
    return filter === 'all' || finding.severity === filter;
  }

  function sortFindings(findings, sortBy) {
    const copy = findings.slice();
    if (sortBy === 'category') {
      copy.sort((a, b) => {
        const catCompare = (a.category || '').localeCompare(b.category || '');
        if (catCompare !== 0) return catCompare;
        return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      });
    } else {
      // Default: severity (critical first), then category for stable grouping.
      copy.sort((a, b) => {
        const sevCompare = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
        if (sevCompare !== 0) return sevCompare;
        return (a.category || '').localeCompare(b.category || '');
      });
    }
    return copy;
  }

  function renderFindingsList() {
    const filtered = currentFindings.filter((f) => findingMatchesFilter(f, activeFilter));
    const sorted = sortFindings(filtered, activeSort);

    els.findingsList.innerHTML = '';

    if (sorted.length === 0) {
      els.findingsEmpty.hidden = false;
      return;
    }
    els.findingsEmpty.hidden = true;

    const fragment = document.createDocumentFragment();
    sorted.forEach((finding) => {
      fragment.appendChild(buildFindingCard(finding));
    });
    els.findingsList.appendChild(fragment);
  }

  function buildFindingCard(finding) {
    const card = document.createElement('article');
    const safeSeverity = safeClassToken(finding.severity, SEVERITY_LABELS, 'info');
    card.className = 'finding-card finding-card--' + safeSeverity;

    const severityLabel = SEVERITY_LABELS[finding.severity] || finding.severity;
    const categoryLabel = CATEGORY_LABELS[finding.category] || finding.category;

    // "good" findings have nothing to fix -- no footer/button for those.
    const footerHtml =
      finding.severity === 'good'
        ? ''
        : `
      <div class="finding-card__footer">
        <button class="btn btn-ghost btn-small fix-with-ai-btn" type="button">Fix with AI</button>
      </div>
    `;

    card.innerHTML = `
      <div class="finding-card__tags">
        <span class="severity-badge severity-badge--${safeSeverity}">${escapeHtml(severityLabel)}</span>
        <span class="finding-card__category">${escapeHtml(categoryLabel)}</span>
      </div>
      <h3 class="finding-card__title">${escapeHtml(finding.title)}</h3>
      <p class="finding-card__description">${escapeHtml(finding.description)}</p>
      <dl class="finding-card__meta">
        <div>
          <dt>Evidence</dt>
          <dd>${escapeHtml(finding.evidence)}</dd>
        </div>
        <div>
          <dt>Recommendation</dt>
          <dd>${escapeHtml(finding.recommendation)}</dd>
        </div>
      </dl>
      ${footerHtml}
    `;

    const fixBtn = card.querySelector('.fix-with-ai-btn');
    if (fixBtn) {
      fixBtn.addEventListener('click', () => {
        const fixType = inferFixType(finding);
        if (!fixType) {
          showToast("AI fix suggestions aren't available for this type of issue yet.");
          return;
        }
        openFixModal(finding, fixType, fixBtn);
      });
    }

    return card;
  }

  function renderDashboard(record) {
    currentScanId = record.scanId;
    currentScanResult = record.result;
    renderTopbar(record);
    renderHeroScore(record.audit);
    renderCategoryCards(record.audit.categoryScores);
    currentFindings = record.audit.findings || [];
    renderFindingsList();
    showOnly(els.content);
  }

  // ---- Tabs & sorting wiring ------------------------------------------------
  els.findingsTabs.addEventListener('click', (event) => {
    const btn = event.target.closest('.findings-tab');
    if (!btn) return;
    els.findingsTabs.querySelectorAll('.findings-tab').forEach((tab) => {
      tab.classList.toggle('is-active', tab === btn);
      tab.setAttribute('aria-selected', String(tab === btn));
    });
    activeFilter = btn.dataset.filter;
    renderFindingsList();
  });

  els.findingsSort.addEventListener('change', () => {
    activeSort = els.findingsSort.value;
    renderFindingsList();
  });

  // ---- Error / empty state helpers ----------------------------------------
  function showError(title, message) {
    els.errorTitle.textContent = title;
    els.errorMessage.textContent = message;
    showOnly(els.error);
  }

  // ---- Fetch + poll ---------------------------------------------------------
  async function fetchScanRecord(scanId) {
    const response = await fetch('/api/scan/' + encodeURIComponent(scanId));
    let payload = null;
    try {
      payload = await response.json();
    } catch (err) {
      payload = null;
    }
    return { ok: response.ok, status: response.status, payload };
  }

  async function loadDashboard(scanId) {
    showOnly(els.loading);
    els.loadingText.textContent = 'Fetching your audit…';

    for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt += 1) {
      let result;
      try {
        result = await fetchScanRecord(scanId);
      } catch (networkErr) {
        showError(
          "We couldn't reach the server",
          'Check that the SiteFix AI server is running, then try again.'
        );
        return;
      }

      if (result.status === 404) {
        showError(
          'Audit not found',
          "We couldn't find a scan with this ID. It may have expired, or the link may be incorrect."
        );
        return;
      }

      if (!result.ok || !result.payload) {
        showError(
          'We couldn\u2019t load this audit',
          'The server returned an unexpected response. Please try again.'
        );
        return;
      }

      const record = result.payload;

      if (record.status === 'failed') {
        showError(
          'This audit could not be completed',
          record.error || 'The scan failed for an unknown reason.'
        );
        return;
      }

      if (record.status === 'complete') {
        if (!record.audit) {
          showError(
            'Audit data is incomplete',
            'The scan finished, but no scoring data was returned. Please run a new audit.'
          );
          return;
        }
        renderDashboard(record);
        return;
      }

      // status is 'pending' or 'in_progress' -- wait and poll again.
      els.loadingText.textContent = 'Your audit is still running… (this usually takes just a few seconds)';
      await new Promise((resolve) => window.setTimeout(resolve, POLL_INTERVAL_MS));
    }

    showError(
      'This is taking longer than expected',
      'The audit is still running on the server. Try refreshing this page in a moment.'
    );
  }

  // ===========================================================================
  // "Fix with AI" modal
  // ===========================================================================

  function populateFixTypeSelect() {
    els.fixTypeSelect.innerHTML = '';
    FIX_TYPE_OPTIONS.forEach((opt) => {
      const optionEl = document.createElement('option');
      optionEl.value = opt.value;
      optionEl.textContent = opt.label;
      els.fixTypeSelect.appendChild(optionEl);
    });
  }

  function getFirstMissingAltImage() {
    return (currentScanResult && currentScanResult.images && currentScanResult.images.missingAlt &&
      currentScanResult.images.missingAlt.samples && currentScanResult.images.missingAlt.samples[0]) || null;
  }

  /** Best-effort client-side preview only -- the server independently
   * re-resolves the authoritative current value from its own stored data. */
  function clientPreviewCurrentValue(fixType, imageSrc) {
    const scan = currentScanResult;
    if (!scan) return '';
    switch (fixType) {
      case 'title':
        return scan.title || '';
      case 'meta_description':
        return scan.metaDescription || '';
      case 'headline':
        return (scan.headings && scan.headings.h1 && scan.headings.h1.text && scan.headings.h1.text[0]) || '';
      case 'cta':
        return (scan.content && scan.content.ctaElements && scan.content.ctaElements.samples && scan.content.ctaElements.samples[0]) || '';
      case 'alt_text':
        return imageSrc || getFirstMissingAltImage() || '';
      default:
        return '';
    }
  }

  function openFixModal(finding, fixType, triggerEl) {
    fixModalState.finding = finding;
    fixModalState.fixType = fixType;
    fixModalState.imageSrc = fixType === 'alt_text' ? getFirstMissingAltImage() : null;
    fixModalState.latestImproved = '';
    fixModalState.triggerEl = triggerEl || document.activeElement;

    els.fixModalTitle.textContent = 'Fix: ' + (FIX_TYPE_LABEL_MAP[fixType] || fixType);
    els.fixProblemText.textContent = finding.description || finding.title;
    els.fixEvidenceText.textContent = finding.evidence ? 'Evidence: ' + finding.evidence : '';
    els.fixTypeSelect.value = fixType;

    const preview = clientPreviewCurrentValue(fixType, fixModalState.imageSrc);
    els.fixCurrentSection.hidden = !preview;
    els.fixCurrentValue.textContent = preview;

    els.fixResult.hidden = true;
    els.fixError.hidden = true;
    els.fixLoading.hidden = true;

    els.fixOverlay.hidden = false;
    document.body.style.overflow = 'hidden';
    els.fixModalClose.focus();

    requestFix();
  }

  function closeFixModal() {
    if (els.fixOverlay.hidden) return;
    els.fixOverlay.hidden = true;
    document.body.style.overflow = '';
    if (fixModalState.triggerEl && typeof fixModalState.triggerEl.focus === 'function') {
      fixModalState.triggerEl.focus();
    }
  }

  function showFixError(message) {
    els.fixLoading.hidden = true;
    els.fixResult.hidden = true;
    els.fixErrorMessage.textContent = message;
    els.fixError.hidden = false;
  }

  async function requestFix() {
    els.fixError.hidden = true;
    els.fixResult.hidden = true;
    els.fixLoading.hidden = false;

    const fixType = els.fixTypeSelect.value;
    const body = {
      scanId: currentScanId,
      fixType,
      finding: fixModalState.finding,
    };
    if (fixType === 'alt_text' && fixModalState.imageSrc) {
      body.imageSrc = fixModalState.imageSrc;
    }

    let response;
    try {
      response = await fetch('/api/fix/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (networkErr) {
      showFixError("We couldn't reach the server. Check your connection and try again.");
      return;
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch (err) {
      payload = null;
    }

    els.fixLoading.hidden = true;

    if (!response.ok || !payload || !payload.success || !payload.fix) {
      const message = (payload && payload.message) || 'Something went wrong generating this fix.';
      showFixError(message);
      return;
    }

    renderFixResult(payload.fix);
  }

  function renderFixResult(fix) {
    els.fixReasonText.textContent = fix.reason || '';
    els.fixImprovedValue.textContent = fix.improved || '';
    els.fixDisclaimerText.textContent = fix.disclaimer || '';
    fixModalState.latestImproved = fix.improved || '';

    if (fix.original) {
      els.fixCurrentSection.hidden = false;
      els.fixCurrentValue.textContent = fix.original;
    }

    els.fixAlternativesList.innerHTML = '';
    const alternatives = Array.isArray(fix.alternatives) ? fix.alternatives : [];
    if (alternatives.length > 0) {
      els.fixAlternativesSection.hidden = false;
      alternatives.forEach((alt) => {
        const li = document.createElement('li');
        li.className = 'fix-alternative';

        const span = document.createElement('span');
        span.className = 'fix-alternative__text';
        span.textContent = alt;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'fix-alternative__copy';
        btn.textContent = 'Copy';
        btn.addEventListener('click', () => copyWithFeedback(alt, btn));

        li.appendChild(span);
        li.appendChild(btn);
        els.fixAlternativesList.appendChild(li);
      });
    } else {
      els.fixAlternativesSection.hidden = true;
    }

    els.fixResult.hidden = false;
  }

  async function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (err) {
        // fall through to the legacy fallback below
      }
    }
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      return ok;
    } catch (err) {
      return false;
    }
  }

  async function copyWithFeedback(text, btn) {
    const ok = await copyToClipboard(text);
    const original = btn.textContent;
    btn.textContent = ok ? 'Copied!' : 'Copy failed';
    btn.classList.toggle('is-copied', ok);
    window.setTimeout(() => {
      btn.textContent = original;
      btn.classList.remove('is-copied');
    }, 1800);
  }

  // ---- Modal event wiring ---------------------------------------------------
  els.fixModalClose.addEventListener('click', closeFixModal);
  els.fixOverlay.addEventListener('click', (event) => {
    if (event.target === els.fixOverlay) closeFixModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !els.fixOverlay.hidden) closeFixModal();
  });
  // Minimal focus trap while the modal is open.
  els.fixOverlay.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const focusable = els.fixModal.querySelectorAll(
      'button:not([disabled]), [href], select, textarea, input, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  els.fixRetryBtn.addEventListener('click', () => requestFix());
  els.fixRegenerateBtn.addEventListener('click', () => {
    fixModalState.fixType = els.fixTypeSelect.value;
    if (fixModalState.fixType === 'alt_text' && !fixModalState.imageSrc) {
      fixModalState.imageSrc = getFirstMissingAltImage();
    }
    requestFix();
  });
  els.fixCopyBtn.addEventListener('click', () => {
    copyWithFeedback(fixModalState.latestImproved || '', els.fixCopyBtn);
  });

  // ===========================================================================
  // Recent Audits
  // ===========================================================================
  // Shown regardless of the current scanId's load state (loading/empty/error/
  // content), so the user can always jump to a previous audit from here.
  const RECENT_AUDITS_LIMIT = 8;

  function severityScoreClassOrNull(score) {
    if (score === null || score === undefined) return null;
    return severityScoreClass(score);
  }

  function buildRecentAuditItem(entry, currentScanId) {
    const a = document.createElement('a');
    a.className = 'recent-audit-item' + (entry.scanId === currentScanId ? ' is-current' : '');
    a.href = 'dashboard.html?scanId=' + encodeURIComponent(entry.scanId);

    const main = document.createElement('div');
    main.className = 'recent-audit-item__main';

    const urlEl = document.createElement('p');
    urlEl.className = 'recent-audit-item__url';
    urlEl.textContent = entry.url;

    const dateEl = document.createElement('p');
    dateEl.className = 'recent-audit-item__date';
    dateEl.textContent = formatDate(entry.completedAt || entry.createdAt);

    main.appendChild(urlEl);
    main.appendChild(dateEl);
    a.appendChild(main);

    if (entry.status === 'complete' && typeof entry.overallScore === 'number') {
      const scoreEl = document.createElement('span');
      const scoreClass = severityScoreClassOrNull(entry.overallScore);
      scoreEl.className = 'recent-audit-item__score' + (scoreClass ? ' ' + scoreClass : '');
      scoreEl.innerHTML = String(Math.round(entry.overallScore)) + '<span>/100</span>';
      a.appendChild(scoreEl);
    } else {
      const pill = document.createElement('span');
      const isFailed = entry.status === 'failed';
      pill.className = 'recent-audit-item__status-pill' + (isFailed ? ' is-failed' : '');
      pill.textContent = isFailed ? 'Failed' : entry.status === 'in_progress' ? 'In progress' : 'Pending';
      a.appendChild(pill);
    }

    return a;
  }

  async function loadRecentAudits(currentScanId) {
    let response;
    try {
      response = await fetch('/api/audit/history?limit=' + RECENT_AUDITS_LIMIT);
    } catch (networkErr) {
      return; // Recent Audits is a convenience panel -- fail silently, don't block the page.
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch (err) {
      payload = null;
    }

    if (!response.ok || !payload || !payload.success || !Array.isArray(payload.history)) {
      return;
    }

    if (payload.history.length === 0) {
      els.recentAuditsSection.hidden = true;
      return;
    }

    els.recentAuditsList.innerHTML = '';
    payload.history.forEach((entry) => {
      els.recentAuditsList.appendChild(buildRecentAuditItem(entry, currentScanId));
    });
    els.recentAuditsSection.hidden = false;
  }

  // ---- Init ---------------------------------------------------------------
  function init() {
    populateFixTypeSelect();

    const params = new URLSearchParams(window.location.search);
    const scanId = params.get('scanId');

    loadRecentAudits(scanId);

    if (!scanId) {
      showOnly(els.empty);
      return;
    }

    els.retryBtn.addEventListener('click', () => loadDashboard(scanId));
    loadDashboard(scanId);
  }

  init();
})();
