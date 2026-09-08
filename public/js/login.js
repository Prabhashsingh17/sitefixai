/**
 * login.js
 * ---------------------------------------------------------------------------
 * Drives login.html's form: POST /api/auth/login, then redirect to the
 * dashboard. Errors are rendered via textContent (never innerHTML) into an
 * inline element, matching every other form on this site.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  const form = document.getElementById('authForm');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const errorEl = document.getElementById('authError');
  const submitBtn = document.getElementById('authSubmit');

  function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  function clearError() {
    errorEl.hidden = true;
    errorEl.textContent = '';
  }

  if (!form) return;

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    clearError();

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
      showError('Please enter your email and password.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Logging in…';

    let response;
    try {
      response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
    } catch (networkErr) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Log in';
      showError("We couldn't reach the server. Check your connection and try again.");
      return;
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch (err) {
      payload = null;
    }

    if (!response.ok || !payload || !payload.success) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Log in';
      showError((payload && payload.message) || 'Something went wrong. Please try again.');
      return;
    }

    window.location.href = 'dashboard.html';
  });
})();
