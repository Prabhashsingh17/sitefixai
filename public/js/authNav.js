/**
 * authNav.js
 * ---------------------------------------------------------------------------
 * Shared by index.html, scan.html, dashboard.html, and report.html (the only
 * cross-page script in this codebase -- each page's JS is otherwise fully
 * self-contained; duplicating this ~20-line block into all four page scripts
 * would be worse). Checks GET /api/auth/me and swaps the nav's
 * #navAuthLink between "Log in" and "Log out". Fails silently on any error
 * -- this is a nice-to-have nav state, never something that should break
 * page load.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  async function initAuthNav() {
    const link = document.getElementById('navAuthLink');
    if (!link) return;

    let payload;
    try {
      const res = await fetch('/api/auth/me');
      payload = await res.json();
    } catch (err) {
      return;
    }

    if (payload && payload.success && payload.user) {
      link.textContent = 'Log out';
      link.setAttribute('href', '#');
      link.addEventListener('click', async function (event) {
        event.preventDefault();
        try {
          await fetch('/api/auth/logout', { method: 'POST' });
        } catch (err) {
          // Fall through to the redirect regardless -- the cookie is
          // cleared client-side by the server response when it does land.
        }
        window.location.href = 'index.html';
      });
    }

    link.hidden = false;
  }

  initAuthNav();
})();
