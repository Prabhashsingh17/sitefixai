/**
 * app.js
 * ---------------------------------------------------------------------------
 * Shared landing-page behaviour: mobile nav toggle, FAQ accordion, and the
 * "Run free audit" URL form. This is frontend-only demo/navigation logic —
 * no real scanning happens here. Submitting the form simply validates the
 * URL and forwards it to scan.html, which is a placeholder page (see
 * scan.js / scan.html) until the real backend scanner exists.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  /* ---- Mobile nav toggle ------------------------------------------------ */
  const navToggle = document.getElementById('navToggle');
  const mainNav = document.getElementById('main-nav');

  if (navToggle && mainNav) {
    navToggle.addEventListener('click', function () {
      const isOpen = mainNav.classList.toggle('is-open');
      navToggle.setAttribute('aria-expanded', String(isOpen));
    });

    mainNav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        mainNav.classList.remove('is-open');
        navToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /* ---- FAQ accordion ------------------------------------------------------ */
  document.querySelectorAll('.faq-item').forEach(function (item) {
    const button = item.querySelector('.faq-question');
    if (!button) return;

    button.addEventListener('click', function () {
      const isOpen = item.classList.contains('is-open');

      document.querySelectorAll('.faq-item.is-open').forEach(function (openItem) {
        if (openItem !== item) {
          openItem.classList.remove('is-open');
          openItem.querySelector('.faq-question').setAttribute('aria-expanded', 'false');
        }
      });

      item.classList.toggle('is-open', !isOpen);
      button.setAttribute('aria-expanded', String(!isOpen));
    });
  });

  /* ---- URL validation + "Run free audit" redirect ------------------------ */
  const HTTP_URL_PATTERN = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;

  function isValidHttpUrl(value) {
    if (!HTTP_URL_PATTERN.test(value)) return false;
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (err) {
      return false;
    }
  }

  const auditForm = document.getElementById('auditForm');
  const siteUrlInput = document.getElementById('siteUrl');
  const urlError = document.getElementById('urlError');

  if (auditForm && siteUrlInput) {
    auditForm.addEventListener('submit', function (event) {
      const rawValue = siteUrlInput.value.trim();

      if (!isValidHttpUrl(rawValue)) {
        event.preventDefault();
        if (urlError) urlError.hidden = false;
        siteUrlInput.setAttribute('aria-invalid', 'true');
        siteUrlInput.focus();
        return;
      }

      if (urlError) urlError.hidden = true;
      siteUrlInput.removeAttribute('aria-invalid');

      // Let the browser perform the GET submit (scan.html?url=<encoded value>),
      // but build the URL ourselves so it's guaranteed to be encoded safely.
      event.preventDefault();
      const target = 'scan.html?url=' + encodeURIComponent(rawValue);
      window.location.href = target;
    });

    siteUrlInput.addEventListener('input', function () {
      if (urlError && !urlError.hidden) urlError.hidden = true;
      siteUrlInput.removeAttribute('aria-invalid');
    });
  }
})();
