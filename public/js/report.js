/**
 * report.js
 * ---------------------------------------------------------------------------
 * Renders the printable SiteFix AI audit report entirely from real API data.
 *
 * Data flow:
 *   1. Read scanId from the query string.
 *   2. GET /api/scan/:scanId (polling briefly if the scan is still
 *      pending/in_progress, same as dashboard.js).
 *   3. If the scan is complete but has no AI analysis yet, this page
 *      automatically requests one (POST /api/audit/analyze) so the report
 *      can include an executive summary, AI fixes, top priorities, and
 *      quick wins. If AI analysis fails or isn't configured, the report
 *      still renders in full using the deterministic audit data alone --
 *      the AI-specific sections show an honest "unavailable" note instead
 *      of blocking the whole report.
 *
 * "Download / Print Report" uses the browser's native print-to-PDF via
 * window.print() -- no PDF library, no server-side rendering.
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

  const SCORE_RING_CIRCUMFERENCE = 2 * Math.PI * 70; // r=70, matches the SVG

  // ---- Element references --------------------------------------------------
  const els = {
    loading: document.getElementById('reportLoading'),
    loadingText: document.getElementById('reportLoadingText'),
    empty: document.getElementById('reportEmpty'),
    error: document.getElementById('reportError'),
    errorTitle: document.getElementById('reportErrorTitle'),
    errorMessage: document.getElementById('reportErrorMessage'),
    retryBtn: document.getElementById('reportRetryBtn'),
    content: document.getElementById('reportContent'),

    backLink: document.getElementById('backToDashboardLink'),
    printBtn: document.getElementById('printReportBtn'),

    url: document.getElementById('reportUrl'),
    auditDate: document.getElementById('reportAuditDate'),
    generatedDate: document.getElementById('reportGeneratedDate'),

    scoreRingValue: document.getElementById('reportScoreRingValue'),
    overallScoreNum: document.getElementById('reportOverallScoreNum'),
    categoryTableBody: document.getElementById('reportCategoryTableBody'),

    summaryLabel: document.getElementById('reportSummaryLabel'),
    summaryText: document.getElementById('reportSummaryText'),

    criticalEmpty: document.getElementById('reportCriticalEmpty'),
    criticalList: document.getElementById('reportCriticalList'),
    warningsEmpty: document.getElementById('reportWarningsEmpty'),
    warningsList: document.getElementById('reportWarningsList'),

    recommendationsEmpty: document.getElementById('reportRecommendationsEmpty'),
    recommendationsList: document.getElementById('reportRecommendationsList'),

    aiFixesLabel: document.getElementById('reportAiFixesLabel'),
    aiFixesList: document.getElementById('reportAiFixesList'),

    topPrioritiesLabel: document.getElementById('reportTopPrioritiesLabel'),
    topPrioritiesList: document.getElementById('reportTopPrioritiesList'),

    quickWinsLabel: document.getElementById('reportQuickWinsLabel'),
    quickWinsList: document.getElementById('reportQuickWinsList'),

    disclaimerText: document.getElementById('reportDisclaimerText'),
    footerUrl: document.getElementById('reportFooterUrl'),
  };

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

  function capitalize(value) {
    if (!value) return '';
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function formatDate(isoString) {
    if (!isoString) return '—';
    try {
      const date = new Date(isoString);
      return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    } catch (err) {
      return isoString;
    }
  }

  function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
  }

  const VALID_PRIORITIES = { high: true, medium: true, low: true };

  /**
   * Returns `value` only if it's a key in `allowedMap`, else `fallback`.
   * Used before interpolating a value into an HTML *attribute* (a CSS class
   * name) -- escapeHtml() protects text content and quoted attribute values
   * from breaking out via quote characters, but not unquoted class lists.
   * In normal operation these values always come from the server's own
   * enum-validated audit/AI data; this is defense-in-depth against any
   * future regression upstream, not a fix for a currently-reachable input.
   */
  function safeClassToken(value, allowedMap, fallback) {
    return Object.prototype.hasOwnProperty.call(allowedMap, value) ? value : fallback;
  }

  function showError(title, message) {
    els.errorTitle.textContent = title;
    els.errorMessage.textContent = message;
    showOnly(els.error);
  }

  // ---- Rendering: header, scores --------------------------------------------
  function renderHeader(record) {
    els.url.textContent = record.url;
    els.auditDate.textContent = formatDate(record.completedAt || record.createdAt);
    els.generatedDate.textContent = formatDate(new Date().toISOString());
    els.backLink.href = 'dashboard.html?scanId=' + encodeURIComponent(record.scanId);
    els.footerUrl.textContent = record.url;
  }

  function renderScores(audit) {
    const score = Math.max(0, Math.min(100, Math.round(audit.overallScore)));
    els.overallScoreNum.textContent = String(score);

    const offset = SCORE_RING_CIRCUMFERENCE * (1 - score / 100);
    els.scoreRingValue.style.strokeDasharray = String(SCORE_RING_CIRCUMFERENCE);
    els.scoreRingValue.style.strokeDashoffset = String(offset);
    els.scoreRingValue.classList.remove('is-good', 'is-warning', 'is-critical');
    els.scoreRingValue.classList.add(severityScoreClass(score));

    els.categoryTableBody.innerHTML = CATEGORY_ORDER.map((key) => {
      const catScore = Math.max(0, Math.min(100, Math.round(audit.categoryScores[key] ?? 0)));
      return `<tr><td>${escapeHtml(CATEGORY_LABELS[key] || key)}</td><td class="report-table__score ${severityScoreClass(catScore)}">${catScore}/100</td></tr>`;
    }).join('');
  }

  // ---- Rendering: executive summary -----------------------------------------
  function buildDeterministicSummary(audit) {
    const s = audit.summary || {};
    const bySeverity = s.bySeverity || { critical: 0, warning: 0, info: 0, good: 0 };
    const weakest = s.weakestCategory ? CATEGORY_LABELS[s.weakestCategory] || s.weakestCategory : null;
    const total = s.totalChecks || audit.findings.length;
    const parts = [`This audit ran ${total} checks across 7 categories and produced an overall score of ${Math.round(audit.overallScore)}/100.`];
    if ((bySeverity.critical || 0) > 0 || (bySeverity.warning || 0) > 0) {
      parts.push(`${bySeverity.critical || 0} critical issue(s) and ${bySeverity.warning || 0} warning(s) were found.`);
    } else {
      parts.push('No critical issues or warnings were found.');
    }
    if (weakest) parts.push(`The area needing the most attention is ${weakest}.`);
    return parts.join(' ');
  }

  function renderSummary(analysis, aiError, audit) {
    if (analysis && analysis.executiveSummary) {
      els.summaryLabel.textContent = 'AI-generated summary, based on the detected audit data.';
      els.summaryText.textContent = analysis.executiveSummary;
      return;
    }
    els.summaryLabel.textContent = aiError
      ? 'AI-generated summary unavailable (' + aiError + '). Showing a deterministic summary instead:'
      : 'Deterministic summary, based directly on the audit results:';
    els.summaryText.textContent = buildDeterministicSummary(audit);
  }

  // ---- Rendering: critical issues / warnings ---------------------------------
  function findingBlockHtml(finding) {
    const categoryLabel = CATEGORY_LABELS[finding.category] || finding.category;
    const severityLabel = SEVERITY_LABELS[finding.severity] || finding.severity;
    const safeSeverity = safeClassToken(finding.severity, SEVERITY_LABELS, 'info');
    return `
      <div class="report-finding report-finding--${safeSeverity}">
        <div class="report-finding__tags">
          <span class="severity-badge severity-badge--${safeSeverity}">${escapeHtml(severityLabel)}</span>
          <span class="report-finding__category">${escapeHtml(categoryLabel)}</span>
        </div>
        <h3 class="report-finding__title">${escapeHtml(finding.title)}</h3>
        <p class="report-finding__description">${escapeHtml(finding.description)}</p>
        <dl class="report-finding__meta">
          <div><dt>Evidence</dt><dd>${escapeHtml(finding.evidence)}</dd></div>
          <div><dt>Recommendation</dt><dd>${escapeHtml(finding.recommendation)}</dd></div>
        </dl>
      </div>
    `;
  }

  function renderSeverityGroup(findings, severity, listEl, emptyEl) {
    const matches = findings.filter((f) => f.severity === severity);
    if (matches.length === 0) {
      emptyEl.hidden = false;
      listEl.innerHTML = '';
      return;
    }
    emptyEl.hidden = true;
    listEl.innerHTML = matches.map(findingBlockHtml).join('');
  }

  // ---- Rendering: consolidated recommendations checklist ---------------------
  function renderRecommendationsChecklist(findings) {
    const actionable = findings.filter((f) => f.severity !== 'good');
    if (actionable.length === 0) {
      els.recommendationsEmpty.hidden = false;
      els.recommendationsList.innerHTML = '';
      return;
    }
    els.recommendationsEmpty.hidden = true;
    els.recommendationsList.innerHTML = actionable
      .map(
        (f) =>
          `<li><span class="report-recommendation-list__category">${escapeHtml(CATEGORY_LABELS[f.category] || f.category)}:</span> ${escapeHtml(f.recommendation)}</li>`
      )
      .join('');
  }

  // ---- Rendering: AI fixes ---------------------------------------------------
  function renderAiFixes(analysis, aiError) {
    if (!analysis || !Array.isArray(analysis.recommendations) || analysis.recommendations.length === 0) {
      els.aiFixesLabel.textContent = aiError
        ? 'AI fixes unavailable (' + aiError + ').'
        : 'No AI-generated fixes were produced for this audit.';
      els.aiFixesList.innerHTML = '';
      return;
    }
    els.aiFixesLabel.textContent = 'AI-generated, grounded in the audit data above -- review before use.';
    els.aiFixesList.innerHTML = analysis.recommendations
      .map((rec) => {
        const safePriority = safeClassToken(rec.priority, VALID_PRIORITIES, 'low');
        return `
      <div class="report-ai-fix report-ai-fix--${safePriority}">
        <div class="report-finding__tags">
          <span class="priority-badge priority-badge--${safePriority}">${escapeHtml(capitalize(rec.priority))} priority</span>
          <span class="report-finding__category">${escapeHtml(CATEGORY_LABELS[rec.category] || rec.category)}</span>
        </div>
        <h3 class="report-finding__title">${escapeHtml(rec.problem)}</h3>
        <p class="report-body-text"><strong>Why it matters:</strong> ${escapeHtml(rec.whyItMatters)}</p>
        <p class="report-body-text"><strong>Recommended fix:</strong> ${escapeHtml(rec.recommendedFix)}</p>
        <p class="report-body-text"><strong>Example:</strong> ${escapeHtml(rec.example)}</p>
        <p class="report-body-text"><strong>Expected impact:</strong> ${escapeHtml(rec.expectedImpact)}</p>
      </div>
    `;
      })
      .join('');
  }

  // ---- Rendering: top 5 priorities -------------------------------------------
  function renderTopPriorities(analysis, audit, aiError) {
    if (analysis && Array.isArray(analysis.topImprovements) && analysis.topImprovements.length > 0) {
      els.topPrioritiesLabel.textContent = 'AI-selected, highest impact first.';
      els.topPrioritiesList.innerHTML = analysis.topImprovements
        .map(
          (rec) =>
            `<li><strong>${escapeHtml(rec.problem)}</strong><span class="report-priority-list__fix"> — ${escapeHtml(rec.recommendedFix)}</span></li>`
        )
        .join('');
      return;
    }

    const fallback = (audit.summary && audit.summary.topIssues) || [];
    if (fallback.length === 0) {
      els.topPrioritiesLabel.textContent = aiError
        ? 'AI-selected priorities unavailable (' + aiError + ').'
        : 'No priority issues were found.';
      els.topPrioritiesList.innerHTML = '';
      return;
    }
    els.topPrioritiesLabel.textContent =
      (aiError ? 'AI analysis unavailable — showing ' : 'Showing ') +
      'the highest-severity findings from the deterministic audit instead.';
    els.topPrioritiesList.innerHTML = fallback
      .slice(0, 5)
      .map(
        (f) =>
          `<li><strong>${escapeHtml(f.title)}</strong><span class="report-priority-list__fix"> — ${escapeHtml(f.recommendation)}</span></li>`
      )
      .join('');
  }

  // ---- Rendering: quick wins --------------------------------------------------
  function renderQuickWins(analysis, aiError) {
    if (analysis && Array.isArray(analysis.quickWins) && analysis.quickWins.length > 0) {
      els.quickWinsLabel.textContent = 'AI-selected, fast and low-effort fixes.';
      els.quickWinsList.innerHTML = analysis.quickWins.map((rec) => `<li>${escapeHtml(rec.recommendedFix)}</li>`).join('');
      return;
    }
    els.quickWinsLabel.textContent = aiError
      ? 'AI-selected quick wins unavailable (' + aiError + ').'
      : 'No quick wins were identified by the AI analysis.';
    els.quickWinsList.innerHTML = '';
  }

  // ---- Rendering: footer ------------------------------------------------------
  function renderFooterDisclaimer(analysis) {
    els.disclaimerText.textContent =
      analysis && analysis.disclaimer
        ? analysis.disclaimer
        : 'This report reflects only automated, machine-detected data about the audited page at the time of the scan. It does not include AI-generated recommendations.';
  }

  // ---- Master render ---------------------------------------------------------
  function renderReport(record, analysis, aiError) {
    renderHeader(record);
    renderScores(record.audit);
    renderSummary(analysis, aiError, record.audit);
    renderSeverityGroup(record.audit.findings, 'critical', els.criticalList, els.criticalEmpty);
    renderSeverityGroup(record.audit.findings, 'warning', els.warningsList, els.warningsEmpty);
    renderRecommendationsChecklist(record.audit.findings);
    renderAiFixes(analysis, aiError);
    renderTopPriorities(analysis, record.audit, aiError);
    renderQuickWins(analysis, aiError);
    renderFooterDisclaimer(analysis);
  }

  // ---- Fetch + poll + auto-analyze ------------------------------------------
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

  async function requestAnalysis(scanId) {
    try {
      const response = await fetch('/api/audit/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scanId }),
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch (err) {
        payload = null;
      }
      if (response.ok && payload && payload.success) {
        return { analysis: payload.analysis, error: null };
      }
      return { analysis: null, error: (payload && payload.message) || 'AI analysis is unavailable.' };
    } catch (networkErr) {
      return { analysis: null, error: 'Could not reach the AI analysis service.' };
    }
  }

  async function loadReport(scanId) {
    showOnly(els.loading);
    els.loadingText.textContent = 'Fetching your audit…';

    for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt += 1) {
      let result;
      try {
        result = await fetchScanRecord(scanId);
      } catch (networkErr) {
        showError("We couldn't reach the server", 'Check that the SiteFix AI server is running, then try again.');
        return;
      }

      if (result.status === 404) {
        showError('Report not found', "We couldn't find a scan with this ID. It may have expired, or the link may be incorrect.");
        return;
      }

      if (!result.ok || !result.payload) {
        showError("We couldn't load this report", 'The server returned an unexpected response. Please try again.');
        return;
      }

      const record = result.payload;

      if (record.status === 'failed') {
        showError('This audit could not be completed', record.error || 'The scan failed for an unknown reason.');
        return;
      }

      if (record.status === 'complete') {
        if (!record.audit) {
          showError('Audit data is incomplete', 'The scan finished, but no scoring data was returned. Please run a new audit.');
          return;
        }

        let analysis = record.analysis || null;
        let aiError = null;
        if (!analysis) {
          els.loadingText.textContent = 'Generating AI insights for your report…';
          const analysisResult = await requestAnalysis(scanId);
          analysis = analysisResult.analysis;
          aiError = analysisResult.error;
        }

        renderReport(record, analysis, aiError);
        showOnly(els.content);
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

  // ---- Init ---------------------------------------------------------------
  function init() {
    const params = new URLSearchParams(window.location.search);
    const scanId = params.get('scanId');

    if (!scanId) {
      showOnly(els.empty);
      return;
    }

    els.retryBtn.addEventListener('click', () => loadReport(scanId));
    els.printBtn.addEventListener('click', () => window.print());
    loadReport(scanId);
  }

  init();
})();
