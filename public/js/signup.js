/**
 * signup.js
 * ---------------------------------------------------------------------------
 * Drives signup.html's form: POST /api/auth/signup (which also logs the new
 * account in server-side), then redirect to the dashboard. Mirrors login.js.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  const MIN_PASSWORD_LENGTH = 8;

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
    if (password.length < MIN_PASSWORD_LENGTH) {
      showError('Password must be at least ' + MIN_PASSWORD_LENGTH + ' characters.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating account…';

    let response;
    try {
      response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
    } catch (networkErr) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign up';
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
      submitBtn.textContent = 'Sign up';
      showError((payload && payload.message) || 'Something went wrong. Please try again.');
      return;
    }

    window.location.href = 'dashboard.html';
  });
})();
