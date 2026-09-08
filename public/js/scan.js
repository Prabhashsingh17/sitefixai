/**
 * scan.js
 * ---------------------------------------------------------------------------
 * Drives the scan.html "Analyzing your website" screen.
 *
 * What's real vs. demo on this page:
 *   - REAL: reading + validating the "url" query param; the POST /api/scan
 *     call that creates an actual scan record on the server and returns a
 *     real scanId; the redirect to dashboard.html?scanId=... .
 *   - DEMO: the step-by-step progress animation and the 0%-100% bar. The
 *     scanning engine itself isn't built yet (server/services/websiteScanner.js
 *     is a stub), so there is no real per-step progress to reflect. This
 *     animation is an honest loading UI, not a claim that each check has
 *     actually run -- no scores or findings are shown or invented here.
 *
 * The step list below mirrors SCAN_STAGES in
 * server/services/websiteScanner.js -- keep both in sync if it changes.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  const HTTP_URL_PATTERN = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;

  const STEP_IDS = [
    'connect',
    'structure',
    'seo',
    'performance',
    'mobile',
    'accessibility',
    'content',
    'conversion',
    'ai_recommendations',
  ];

  const workingSection = document.getElementById('scanWorking');
  const errorSection = document.getElementById('scanError');
  const errorTitleEl = document.getElementById('scanErrorTitle');
  const errorMessageEl = document.getElementById('scanErrorMessage');
  const targetUrlEl = document.getElementById('scanTargetUrl');
  const progressBarEl = document.getElementById('scanProgressBar');
  const progressFillEl = document.getElementById('scanProgressFill');
  const progressPctEl = document.getElementById('scanProgressPct');
  const stepEls = STEP_IDS.map(function (id) {
    return document.querySelector('.scan-step[data-step="' + id + '"]');
  });

  function showError(title, message) {
    if (workingSection) workingSection.hidden = true;
    if (errorSection) errorSection.hidden = false;
    if (errorTitleEl && title) errorTitleEl.textContent = title;
    if (errorMessageEl && message) errorMessageEl.textContent = message;
  }

  function getValidatedUrlParam() {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('url');
    if (!raw) return null;

    let decoded;
    try {
      decoded = raw.trim();
      // eslint-disable-next-line no-new
      new URL(decoded); // throws if not well-formed
    } catch (err) {
      return null;
    }

    return HTTP_URL_PATTERN.test(decoded) ? decoded : null;
  }

  function setProgress(percent) {
    const clamped = Math.max(0, Math.min(100, Math.round(percent)));
    if (progressFillEl) progressFillEl.style.width = clamped + '%';
    if (progressPctEl) progressPctEl.textContent = clamped + '%';
    if (progressBarEl) progressBarEl.setAttribute('aria-valuenow', String(clamped));
  }

  function setStepState(index, state) {
    const el = stepEls[index];
    if (!el) return;
    el.classList.remove('is-active', 'is-done');
    if (state) el.classList.add(state);
  }

  /**
   * Animate through the visual step list, then resolve.
   * Timing is fixed/deterministic on purpose -- this is a UI loading
   * sequence, not a reflection of real backend work.
   */
  function runProgressAnimation() {
    return new Promise(function (resolve) {
      const totalSteps = STEP_IDS.length;
      const stepDurationMs = 650;
      let currentStep = 0;

      function advance() {
        if (currentStep > 0) setStepState(currentStep - 1, 'is-done');

        if (currentStep >= totalSteps) {
          setProgress(100);
          resolve();
          return;
        }

        setStepState(currentStep, 'is-active');
        const percent = ((currentStep + 1) / totalSteps) * 100;
        setProgress(percent);

        currentStep += 1;
        window.setTimeout(advance, stepDurationMs);
      }

      advance();
    });
  }

  async function startScan(url) {
    let response;
    try {
      response = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url }),
      });
    } catch (networkErr) {
      showError(
        "We couldn't reach the server",
        'Check that the SiteFix AI server is running, then try again from the homepage.'
      );
      return;
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch (parseErr) {
      payload = null;
    }

    if (!response.ok) {
      const message =
        (payload && payload.message) ||
        'The server rejected this scan request.';
      showError("We couldn't start your audit", message);
      return;
    }

    const scanId = payload && payload.scanId;
    if (!scanId) {
      showError(
        "We couldn't start your audit",
        'The server did not return a scan ID.'
      );
      return;
    }

    await runProgressAnimation();

    const destination =
      'dashboard.html?scanId=' + encodeURIComponent(scanId) +
      '&url=' + encodeURIComponent(url);
    window.location.href = destination;
  }

  function init() {
    const validUrl = getValidatedUrlParam();

    if (!validUrl) {
      showError(
        'No valid website URL was provided',
        'Go back to the homepage and enter a website address starting with http:// or https://.'
      );
      return;
    }

    if (workingSection) workingSection.hidden = false;
    if (targetUrlEl) targetUrlEl.textContent = validUrl;

    startScan(validUrl);
  }

  init();
})();
