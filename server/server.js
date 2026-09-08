/**
 * server.js
 * ---------------------------------------------------------------------------
 * SiteFix AI — Express entry point.
 *
 * Responsibilities:
 *   - Serve the static frontend (public/)
 *   - Mount real API routes under /api
 *   - Provide honest error handling (no fake success responses)
 * ---------------------------------------------------------------------------
 */

require('dotenv').config();
const path = require('path');
const express = require('express');

const scanRoutes = require('./routes/scanRoutes');
const auditRoutes = require('./routes/auditRoutes');
const fixRoutes = require('./routes/fixRoutes');
const adminRoutes = require('./routes/adminRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// Removes the "X-Powered-By: Express" response header. Zero behavior
// change for the app itself -- purely avoids handing an attacker free
// framework fingerprinting information.
app.disable('x-powered-by');

// Use Node's built-in querystring parser instead of Express's default
// ('extended', which uses the `qs` package). `qs` has known moderate-
// severity DoS/parsing-bypass advisories in the version pinned by our
// Express 4.x dependency tree, and there's no patched 4.x release yet
// (only a semver-major Express 5 bump, which is out of scope for this
// audit). This app never reads nested/array query parameters -- every
// route only reads simple scalar values (e.g. `?limit=20`) -- so 'simple'
// parsing is 100% behavior-equivalent for every real request this app
// receives, while removing `qs` from the one place it would otherwise
// still run on every incoming request regardless of route.
app.set('query parser', 'simple');

// Small cap on request body size — nothing this API accepts needs more
// than a URL string, so this also limits abuse of the JSON body parser.
app.use(express.json({ limit: '100kb' }));

// Static frontend
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));

// Real backend API routes
app.use('/api', scanRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/fix', fixRoutes);
app.use('/api/admin', adminRoutes);

// Basic health check — genuinely reflects server status, nothing more.
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// 404 for unknown API routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'not_found', message: 'Unknown API route.' });
});

// Fallback error handler
app.use((err, req, res, next) => {
  // body-parser (and other middleware) set a proper 4xx status on ordinary
  // client-input errors like malformed JSON or an oversized body -- honor
  // that instead of always answering 500, which would mislabel a bad
  // request as a server failure. Only log (and answer 500 for) genuinely
  // unexpected errors; a malformed request is routine traffic, not a bug,
  // and shouldn't spam the server log with a stack trace every time.
  const candidateStatus = Number.isInteger(err.status) ? err.status : err.statusCode;
  const isClientError = Number.isInteger(candidateStatus) && candidateStatus >= 400 && candidateStatus < 500;

  if (!isClientError) {
    console.error(err);
    return res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
  }

  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'payload_too_large', message: 'Request body is too large.' });
  }

  // Covers malformed JSON (err.type === 'entity.parse.failed') and other
  // generic body-parser 4xx errors -- never echo the raw parser error
  // message (it can include a snippet of the offending request body).
  return res.status(candidateStatus).json({ error: 'bad_request', message: 'The request could not be understood.' });
});

app.listen(PORT, () => {
  console.log(`SiteFix AI server running at http://localhost:${PORT}`);
});
