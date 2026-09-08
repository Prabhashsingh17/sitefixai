# SiteFix AI (MVP)

An AI-powered website audit and improvement tool. This MVP includes the
marketing landing page, a premium "Analyzing your website" scan-progress
screen, a real website-scanning backend (fetches a public URL and extracts
structured SEO/mobile/accessibility/content/technical data), a
deterministic scoring engine that turns that data into 0–100 scores and
explainable findings, a full audit dashboard that renders all of it, a
server-side Claude integration that turns the detected facts + findings
into AI-written recommendations, a per-finding "Fix with AI" modal that
generates a single, copy-ready content fix (title, meta description,
headline, CTA, alt text, and more) grounded in that finding's real data, a
professional, print-friendly audit report you can save as a PDF straight
from the browser, and persistent audit history backed by SQLite, so past
audits survive a server restart and are browsable from a "Recent Audits"
panel on the dashboard.

## What's real vs. demo

- **Real:** the Express server, static file serving, URL validation, the
  scan lifecycle (now persisted via `scanStore.js` → `server/services/db/*`,
  SQLite-backed — see "Audit history" below), the website scanner
  (`websiteScanner.js` + `server/services/scanner/*`), the audit scoring
  engine (`auditEngine.js` + `server/services/audit/*`), the dashboard
  (`dashboard.html` + `dashboard.js`) rendering that engine's real output
  plus a real "Recent Audits" panel backed by the database, the AI
  recommendation engine (`aiAnalyzer.js` + `server/services/ai/*`), the
  "Fix with AI" modal and its backend (`fixGenerator.js` +
  `server/services/fix/*`), and the full audit report (`report.html` +
  `report.js`), which renders real scan, audit, and AI-analysis data into
  a printable document. No hardcoded, mocked, or randomly-generated
  scores, findings, or fixes exist anywhere — every report section is
  built from that scan's actual API responses, and the page auto-requests
  an AI analysis if one hasn't been generated yet so the report's
  executive summary/AI fixes/priorities/quick-wins sections can be
  populated. Nothing is ever written back to the scanned website
  automatically — every fix and every report are copy/print/download-only.
- **Demo/cosmetic:** on `scan.html`, the step-by-step progress list and the
  0%→100% bar are a scripted loading animation, not a readout of real
  per-step backend progress (the scan itself typically finishes in well
  under a second). The dashboard hero score's "Summary" text is a
  deterministic sentence built from the real audit numbers, explicitly
  labeled as a placeholder for future AI-generated copy on that page
  (separate from the report page, whose executive summary is fully
  AI-generated when available). Findings whose category has no meaningful
  AI content fix (e.g. HTTPS status, response time, internal-link count)
  show an honest "not available for this issue" toast instead of opening
  an empty "Fix with AI" modal. If AI analysis is unavailable when a
  report is generated (no API key configured, rate-limited, etc.), the
  report still renders in full using deterministic audit data, with a
  plain, honest note in place of each AI-only section — it never blocks or
  fakes the report. On the landing page, the "sample audit" and
  "before/after fix" examples are clearly labeled as illustrative — they
  are not a real scan of any specific website, so they're never presented
  as one.
- **Not implemented yet (and labeled as such):** billing/payment for the
  Pro and Business pricing tiers. Every feature listed under those tiers
  (full audit, AI recommendations, AI fixes, the professional report,
  multi-site support, audit history) already works today and is available
  for free — there's no paywall to bypass. The pricing section says this
  directly ("every feature shown above ... is free to use right now while
  we finish billing"), and every pricing card's button leads to the same
  real, working free-audit flow rather than a fake checkout.

## Project structure

```
sitefix-ai/
├── public/                     # Frontend (HTML/CSS/vanilla JS)
│   ├── index.html               # Landing page (conversion-focused: benefits, sample audit, pricing)
│   ├── scan.html                 # "Analyzing your website" progress screen
│   ├── dashboard.html            # Full audit dashboard + "Fix with AI" modal
│   ├── report.html               # Printable audit report (real data + AI analysis)
│   ├── css/style.css
│   └── js/
│       ├── app.js                # Landing page nav, FAQ, URL validation
│       ├── scan.js               # Creates a real scan, animates progress, redirects
│       ├── dashboard.js          # Fetches real audit data; renders scores, findings, filters, fix modal, recent audits
│       └── report.js             # Fetches/auto-generates AI analysis, renders the full printable report
├── server/
│   ├── server.js                 # Express app entry point
│   ├── routes/
│   │   ├── scanRoutes.js         # POST /api/scan (async), GET /api/scan/:scanId
│   │   ├── auditRoutes.js        # POST /api/audit/scan, POST /api/audit/analyze,
│   │   │                          #   GET /api/audit/history, GET /api/audit/:scanId
│   │   └── fixRoutes.js          # POST /api/fix/generate
│   └── services/
│       ├── websiteScanner.js     # Public scanner API: scanWebsite(url)
│       ├── auditEngine.js        # Public scoring API: runAudit(scanResult)
│       ├── aiAnalyzer.js         # Public AI API: generateRecommendations(scan, audit)
│       ├── fixGenerator.js       # Public fix API: generateFix({ scanResult, finding, fixType })
│       ├── scanStore.js          # Public persistence API (thin wrapper over db/) --
│       │                          #   createScan, getScan, updateScan, listRecent
│       ├── db/
│       │   ├── index.js           # Repository swap point (reads DB_DRIVER, defaults to sqlite)
│       │   ├── connection.js      # Opens/migrates the SQLite file; SQLITE_DB_PATH override
│       │   └── sqliteRepository.js # SQLite implementation of createScan/getScan/updateScan/listRecent
│       ├── ai/
│       │   ├── claudeClient.js    # Shared low-level Claude API caller (used by both AI features)
│       │   ├── jsonUtils.js       # Shared "strip fences, parse JSON safely" helper
│       │   ├── promptBuilder.js   # Extracts bounded facts + builds the full-audit Claude prompt
│       │   ├── responseValidator.js # Parses/validates/sanitizes the full-audit JSON output
│       │   └── errors.js          # Typed, user-safe error classes
│       ├── fix/
│       │   ├── promptBuilder.js   # Fix types, context extraction, current-value resolution
│       │   ├── responseValidator.js # Parses/validates/sanitizes a single fix's JSON output
│       │   └── errors.js          # Fix-specific errors (re-exports the shared AI errors)
│       ├── scanner/
│       │   ├── urlSafety.js       # URL validation + SSRF protection
│       │   ├── httpClient.js      # Safe fetch: DNS pinning, timeouts, size caps, redirects
│       │   ├── htmlAnalyzer.js    # cheerio-based structured data extraction
│       │   └── errors.js          # Typed, user-safe error classes
│       └── audit/
│           ├── scoring.js         # Category weights + scoring/finding helpers
│           └── checks.js          # Individual checks for all 7 categories
├── data/                          # SQLite database file (gitignored, created on first run)
├── tests/                        # node:test suite (run with `npm test`)
│   ├── fixtures.js               # Shared mock scan-result builders
│   ├── scoring.test.js
│   ├── checks.test.js
│   ├── auditEngine.test.js
│   ├── scanStore.test.js         # Uses an in-memory SQLite DB -- never touches data/sitefix.db
│   ├── promptBuilder.test.js
│   ├── responseValidator.test.js
│   ├── aiAnalyzer.test.js        # Uses a mocked fetch -- no real API calls in tests
│   ├── fixPromptBuilder.test.js
│   ├── fixResponseValidator.test.js
│   └── fixGenerator.test.js      # Uses a mocked fetch -- no real API calls in tests
├── package.json
├── .env.example
├── .gitignore
└── README.md
```

## Requirements

- Node.js 18 or later
- npm
- An Anthropic API key (only needed for `POST /api/audit/analyze` — everything
  else works without one). Get one at https://console.anthropic.com/

No external database to install or configure — audit history is stored in
a local SQLite file (`data/sitefix.db`), created automatically the first
time the server runs. `better-sqlite3` (the SQLite driver) has a native
addon that's compiled/downloaded during `npm install`; if that ever fails
in a restricted environment, the fix is almost always a Node/npm version
or network-access issue with that one package, not with this app's code.

## Install & run locally

```bash
# 1. Move into the project folder
cd sitefix-ai

# 2. Install dependencies
npm install

# 3. Create your local .env file
cp .env.example .env
# Edit .env and set ANTHROPIC_API_KEY if you want AI recommendations.
# (all other defaults are fine for local development — PORT=3000)

# 4. Start the server
npm start
```

Then open **http://localhost:3000** in your browser. On first run this
creates `data/sitefix.db` (gitignored) — delete that file any time to
reset audit history to empty.

For auto-restart on file changes during development:

```bash
npm run dev
```

## How a scan flows through the app

1. **Landing page** — entering a URL and clicking "Get my free audit"
   validates it's a proper `http://`/`https://` address, then redirects to
   `scan.html?url=<encoded>`.
2. **scan.html** — re-validates the URL, calls `POST /api/scan` to create a
   real scan record and kick off the real scanner in the background, then
   plays a 9-step progress animation. When it finishes, it redirects to
   `dashboard.html?scanId=<id>&url=<encoded>`.
3. **dashboard.html** — fetches `GET /api/scan/:scanId` (polling briefly if
   the scan is still `pending`/`in_progress`) and renders the real result:
   overall score, per-category scores, and every finding, with working
   severity tabs (All/Critical/Warnings/Suggestions/Good) and a sort control
   (Severity/Category). A failed or missing scan shows a plain-language
   error state instead of a broken or fake dashboard.

For a request/response round-trip in one call (e.g. for testing or a future
API client), use `POST /api/audit/scan` instead — see below.

## What the scanner extracts

Given a URL, `websiteScanner.scanWebsite()` returns:

- `title`, `metaDescription`, canonical URL
- `headings` — H1/H2 counts and text
- `images` — count, and which are missing `alt` text
- `links` — internal vs. external counts and samples
- `buttons` and `forms` — with input counts, actions, methods
- CTA-like elements (heuristic match on common call-to-action phrases)
- word count of visible body text
- viewport meta tag, robots meta tag
- basic Open Graph metadata
- structured data presence (JSON-LD / microdata) and detected `@type`s
- HTTPS status, final URL after redirects, status code, favicon presence

No AI-written recommendations are produced yet — this is the raw data an
AI step would eventually read.

## Security: SSRF protections

Because this feature fetches URLs supplied by users, `server/services/scanner/`
takes these precautions:

- Only `http://` and `https://` are accepted; credentials embedded in the
  URL (`user:pass@host`) are rejected.
- Hostnames are resolved via DNS ourselves, and the request is rejected if
  **any** resolved address is loopback, link-local (including the
  `169.254.169.254` cloud metadata address), or in a private/reserved range
  (RFC1918, CGNAT, TEST-NET, multicast, etc.) — for the original URL and
  **every redirect hop** it follows.
- The actual TCP connection is pinned to the exact validated IP address (via
  a custom DNS `lookup`), so the OS resolver can't hand back a different
  address between the check and the connection (DNS-rebinding protection).
- `localhost`, `*.localhost`, `*.local`, `*.internal`, and known cloud
  metadata hostnames are blocked outright, as are common internal-service
  ports (SSH, databases, etc.) even on otherwise-public hosts.
- Every request has a hard timeout (10s) and redirects are capped (5 hops).
- Responses are capped at 3MB and aborted mid-stream if exceeded — never
  buffered in full first.
- The response body is only ever parsed as text via cheerio, which does not
  execute scripts or fetch subresources.
- Only pages served as `text/html` (or `application/xhtml+xml`) are
  analyzed; anything else is rejected before parsing.
- Errors returned to the client are pre-written, safe messages (see
  `scanner/errors.js`) — stack traces, resolved IPs, and other internals are
  only ever logged server-side, never sent in a response.

## API reference

### `POST /api/audit/scan` (synchronous)

Request:
```json
{ "url": "https://example.com" }
```

Success response (`200`):
```json
{ "success": true, "scanId": "...", "data": { "...": "see scanner output above" }, "audit": { "...": "see scoring engine output below" } }
```

Failure response (`400`/`422`/`502`/`504`):
```json
{ "success": false, "scanId": "...", "error": "<code>", "message": "<safe message>" }
```

Error codes: `invalid_url` (400), `blocked_target` (400), `too_many_redirects`
(400), `unsupported_content_type` (422), `response_too_large` (422),
`timeout` (504), `fetch_failed` (502).

### `POST /api/scan` (async) + `GET /api/scan/:scanId`

Used by `scan.html`/`dashboard.html`: `POST /api/scan` returns a `scanId`
immediately (`202`) while the scan runs in the background; `GET
/api/scan/:scanId` returns `{ scanId, url, status, createdAt, completedAt,
result, audit, analysis, error }`, where `status` is `pending` |
`in_progress` | `complete` | `failed`.

### `POST /api/audit/analyze` (AI recommendations)

Generates AI-written recommendations from an already-completed scan. Requires
`ANTHROPIC_API_KEY` to be set (see Requirements above).

Request:
```json
{ "scanId": "..." }
```

Success response (`200`):
```json
{ "success": true, "scanId": "...", "analysis": { "...": "see AI recommendation engine output below" } }
```

Failure response:
```json
{ "success": false, "scanId": "...", "error": "<code>", "message": "<safe message>" }
```

Error codes: `invalid_scan_id` (400), `not_found` (404), `audit_not_ready`
(409 — the scan hasn't finished or failed), `ai_not_configured` (503 — no
API key set, or the key was rejected), `ai_request_failed` (502/429-derived),
`ai_timeout` (504), `ai_invalid_response` (502 — Claude's output couldn't be
parsed or validated).

### `POST /api/fix/generate` ("Fix with AI")

Generates one AI-suggested content fix for a single finding. Requires
`ANTHROPIC_API_KEY` to be set. Never modifies the scanned website — this
only ever returns a suggestion.

Request:
```json
{
  "scanId": "...",
  "fixType": "title | meta_description | headline | cta | alt_text | seo_content | faq_content | landing_copy | html_snippet",
  "finding": { "category": "...", "severity": "...", "title": "...", "description": "...", "evidence": "...", "recommendation": "..." },
  "imageSrc": "... (optional, only used for fixType \"alt_text\")"
}
```

`finding` must exactly match one of the real findings already stored for
that `scanId` (from `POST /api/audit/scan`) — a fabricated or altered
finding is rejected with `finding_mismatch` before any AI call is made.
Likewise, `imageSrc` is only honored if it's one of that scan's actual
detected missing-alt image paths.

Success response (`200`):
```json
{
  "success": true,
  "scanId": "...",
  "fix": {
    "fixType": "headline",
    "original": "...",
    "improved": "...",
    "reason": "...",
    "alternatives": ["...", "..."],
    "generatedAt": "2026-01-01T00:00:00.000Z",
    "disclaimer": "This is an AI-generated suggestion... Nothing is applied automatically."
  }
}
```

Failure response:
```json
{ "success": false, "scanId": "...", "error": "<code>", "message": "<safe message>" }
```

Error codes: `invalid_scan_id` (400), `invalid_fix_type` (400),
`invalid_fix_request` (400), `finding_mismatch` (400), `not_found` (404),
`audit_not_ready` (409), plus the same `ai_*` codes as `/api/audit/analyze`.

### `GET /api/audit/history?limit=20`

Lists recent audits, newest first, for the dashboard's "Recent Audits"
panel. Lightweight by design — URL, status, timestamps, and overall score
only, not the full scan/audit/AI payload (fetch a specific scanId for
that). `limit` is optional, defaults to 20, and is capped at 100.

Response:
```json
{
  "success": true,
  "history": [
    { "scanId": "...", "url": "...", "status": "complete", "createdAt": "...", "completedAt": "...", "overallScore": 86, "error": null }
  ]
}
```

### `GET /api/audit/:scanId`

Full detail for one historical audit — equivalent to `GET /api/scan/:scanId`
but under the `/api/audit` namespace, with field names matching this
namespace's other responses (`data`/`audit`/`analysis`).

Success response (`200`):
```json
{
  "success": true,
  "scanId": "...", "url": "...", "status": "complete",
  "createdAt": "...", "completedAt": "...",
  "data": { "...": "ScanResult" }, "audit": { "...": "AuditResult" }, "analysis": { "...": "AIAnalysis | null" },
  "error": null
}
```

Failure response: `400` (`invalid_scan_id`) or `404` (`not_found`), same
shape as elsewhere: `{ "success": false, "error": "<code>", "message": "..." }`.

## Audit scoring engine

`server/services/auditEngine.js` takes a scan result and deterministically
computes scores for 7 categories — SEO, Performance, Mobile, Accessibility,
Content, UX, Conversion — plus a weighted overall 0–100 score. It has **no
randomness and no AI**: the same scan input always produces the exact same
output, and every point is traceable to a specific check against real,
detected page data (see `server/services/audit/checks.js`).

Each category is built from individually-weighted checks (e.g. SEO: title
exists, title length, meta description, H1 structure, canonical, Open
Graph, structured data). A category's score is `(points earned / points
possible) × 100`. Where the scanner has no relevant data for a check (e.g.
a page with zero images, or zero forms), that check awards full marks with
an honest "nothing to evaluate" finding rather than penalizing or guessing.

The overall score is a fixed weighted average: SEO 20%, Performance 15%,
Mobile 15%, Accessibility 15%, Content 15%, UX 10%, Conversion 10%.

Every check produces one finding, always, whether it passed or failed:
```json
{
  "category": "seo",
  "severity": "critical | warning | info | good",
  "title": "...",
  "description": "...",
  "evidence": "...",
  "recommendation": "..."
}
```

`runAudit(scanResult)` returns:
```json
{
  "overallScore": 0,
  "categoryScores": { "seo": 0, "performance": 0, "...": 0 },
  "findings": [ /* one per check, across all categories */ ],
  "summary": {
    "totalChecks": 0,
    "bySeverity": { "critical": 0, "warning": 0, "info": 0, "good": 0 },
    "weakestCategory": "...",
    "strongestCategory": "...",
    "topIssues": [ /* up to 5 critical/warning findings */ ]
  }
}
```

## AI recommendation engine

`server/services/aiAnalyzer.js` sends a **bounded, curated set of real
facts** — never the raw scan, never full link/button lists, never anything
Claude wasn't given — to the Claude API, and turns the response into
validated recommendations. Key properties:

- **Server-side only.** The API key (`ANTHROPIC_API_KEY`) is read once via
  `process.env` inside this file and is never sent to, or readable by, the
  browser. Nothing in `public/` references it.
- **Grounded, not invented.** The prompt instructs Claude to reason only
  from the supplied facts and findings, and `server/services/ai/promptBuilder.js`
  only extracts real, already-detected values (counts, booleans, truncated
  strings) — never fabricated statistics.
- **No guarantees.** The prompt explicitly forbids promising rankings,
  traffic, or conversion increases. This is enforced twice: once by
  instruction, and again defensively in `server/services/ai/responseValidator.js`,
  which drops any individual recommendation containing guarantee-style
  language and replaces the executive summary with a safe, fact-based
  fallback if it slips through.
- **Malformed JSON handled safely.** Claude's response is parsed
  defensively (markdown code fences are stripped if present), and if the
  JSON is unparseable or structurally invalid, a typed error is thrown
  instead of crashing or forwarding garbage. Individual malformed
  recommendation entries are dropped rather than invalidating the whole
  response; index references (for top improvements / quick wins / long-term
  items) are remapped so they never point at a dropped or out-of-range
  entry.
- **Facts vs. AI output are kept separate in the response**, never merged:

```json
{
  "generatedAt": "2026-01-01T00:00:00.000Z",
  "model": "claude-sonnet-5",
  "basedOn": {
    "overallScore": 0,
    "categoryScores": { "...": 0 },
    "totalChecks": 0,
    "checksPassed": 0,
    "findingsAnalyzed": 0
  },
  "executiveSummary": "AI-generated overview...",
  "recommendations": [
    {
      "category": "seo | performance | mobile | accessibility | content | ux | conversion",
      "priority": "high | medium | low",
      "problem": "...",
      "whyItMatters": "...",
      "recommendedFix": "...",
      "example": "...",
      "expectedImpact": "..."
    }
  ],
  "topImprovements": [ /* up to 5 recommendation objects, highest impact first */ ],
  "quickWins": [ /* recommendation objects flagged as fast/low-effort */ ],
  "longTermImprovements": [ /* recommendation objects flagged as structural/bigger effort */ ],
  "disclaimer": "These recommendations are generated by AI... not guarantees of search ranking, traffic, or conversion improvements."
}
```

## "Fix with AI"

Where the full analysis above suggests *what* to improve across the whole
page, "Fix with AI" generates one concrete, copy-ready fix for a single
finding — the feature behind the "Fix with AI" button on each finding card
in the dashboard. `server/services/fixGenerator.js` supports 9 fix types:

| Fix type | What it produces |
|---|---|
| `title` | An improved `<title>` tag |
| `meta_description` | An improved meta description |
| `headline` | An improved H1 / main headline |
| `cta` | Improved call-to-action button/link text |
| `alt_text` | Suggested alt text for a specific detected image (the AI can't see the image — it infers only from the filename/context, and says so) |
| `seo_content` | A combined title + meta description package |
| `faq_content` | 3–5 draft FAQ question/answer pairs |
| `landing_copy` | Draft hero headline + supporting copy |
| `html_snippet` | A minimal HTML snippet (canonical tag, labeled input, viewport tag, etc.) with placeholder values for anything not in the detected data |

The dashboard auto-selects the fix type based on which finding was
clicked, but also offers a dropdown to switch types and regenerate — useful
for `faq_content`/`landing_copy`, which aren't tied to one specific
deterministic finding. Findings with no meaningful content fix (e.g.
HTTPS status, response time) show a plain "not available for this issue"
message instead of opening the modal.

**Nothing is ever applied automatically.** The modal only offers **Copy**
and **Regenerate** — there is no "Apply to my site" action anywhere in this
codebase. The user reviews the suggestion and copies it into their own site
themselves.

**Integrity check:** the `finding` (and, for `alt_text`, the `imageSrc`)
submitted to `POST /api/fix/generate` must exactly match real, previously
stored data for that `scanId` — a client can't submit a fabricated
"finding" and have the AI treat it as real. See `fixRoutes.js`.

## Audit report

`report.html` renders a professional, print-friendly report entirely from
that scan's real API data — nothing on the page is hardcoded, and there
are no fabricated metrics or testimonials anywhere. It includes:

- SiteFix AI branding, the audited URL, the audit date, and the report
  generation date
- The overall 0–100 score and all 7 category scores
- An executive summary (AI-generated when available)
- **Critical Issues** and **Warnings** — full detail (evidence,
  recommendation) for every finding at those severities, straight from
  `audit.findings`
- **Recommendations** — a consolidated checklist of every non-passing
  finding's deterministic recommendation, across all severities
- **AI Fixes** — the full AI-generated recommendation list from
  `POST /api/audit/analyze` (problem, why it matters, recommended fix,
  example, expected impact, priority)
- **Top 5 Priorities** and **Quick Wins** — the AI's `topImprovements` /
  `quickWins`, or, if AI analysis isn't available, a deterministic
  fallback built from `audit.summary.topIssues` (clearly labeled as such)

**Generating the AI sections:** if the scan doesn't already have a stored
AI analysis (i.e. nobody has called `/api/audit/analyze` for it yet), the
report page requests one automatically on load, so a freshly-scanned site
still gets a complete report. If that call fails for any reason — no API
key configured, rate-limited, a timeout — the report **still renders in
full**: every AI-only section shows a plain, honest note explaining AI
analysis is unavailable (including the real server error message) instead
of a blank section or a broken page.

**Print / PDF:** the "Download / Print Report" button calls the browser's
native `window.print()` — there is no PDF-generation dependency. A
dedicated print stylesheet (`@media print` in `style.css`) hides the site
header, nav, and action bar, removes card shadows/borders, and adds
`page-break-inside: avoid` on findings and sections so they don't get cut
across a page boundary. To save as PDF, choose "Save as PDF" as the
destination in the browser's print dialog.

## Audit history

Audits are now persisted in SQLite (`data/sitefix.db`) instead of an
in-memory `Map`, so they survive a server restart — verified by scanning a
site, killing the server process entirely, starting a brand new one, and
confirming `GET /api/audit/history` still returns the earlier scans.

**Stored per audit:** scan ID, website URL, timestamp, overall score,
category scores, scan data, findings, and AI recommendations — exactly
what was asked for, nothing more. **No API keys or other secrets are ever
written to the database**; there is no column for one, and
`server/services/db/sqliteRepository.js` never reads `process.env` at all.

**Modular by design:** everything above `server/services/db/` (routes,
`scanStore.js`) only ever calls four functions — `createScan`, `getScan`,
`updateScan`, `listRecent` — and only ever sees plain JS objects, never SQL
or a driver-specific type. `server/services/db/index.js` is the single
swap point: it reads `DB_DRIVER` from the environment (defaults to, and
today only supports, `sqlite`) and requires the matching repository
module. Moving to Postgres or MongoDB later means writing a new
`postgresRepository.js`/`mongoRepository.js` that implements those same
four functions with the same shapes, and adding one line to the `switch`
in `db/index.js` — no route or service code outside `server/services/db/`
needs to change.

**"Recent Audits"** on the dashboard (`dashboard.html`/`dashboard.js`)
fetches `GET /api/audit/history` on every page load — regardless of
whether a specific `scanId` is loading, missing, or errored — so it's
always available as a way back into a previous audit. Clicking an entry
navigates to `dashboard.html?scanId=...`, reusing the exact same load path
as any other audit; the entry matching the one currently on screen is
visually highlighted. If the history request itself fails, the panel just
stays hidden — it never breaks or blocks the rest of the page.

## Running the tests

```bash
npm test
```

Uses Node's built-in test runner (`node --test`, no extra dependency) — 141
tests, none of which make a real network or Claude API call (and none of
which touch the real `data/sitefix.db` — the database tests force an
in-memory SQLite instance via `SQLITE_DB_PATH=':memory:'`). Coverage
includes: the scoring helpers and every check's boundary conditions,
full-engine determinism and weighting, both AI features' fact/context
extraction and truncation logic, (via a mocked `fetch`) both response
validators' handling of malformed JSON, invalid enums, and guarantee-
language filtering, both generators' handling of missing API keys,
timeouts, rate-limiting, and network failures, and the SQLite repository's
create/read/update/list behavior, partial-update merging, history
ordering/limits, and confirmation that no injected "secret" value ever
appears in a stored or retrieved record. The fix modal's, the report
page's, and the "Recent Audits" panel's frontend behavior — open/loading/
success/error states, Copy/Regenerate, the finding-to-fix-type mapping,
focus handling, the report's auto-analyze-on-load flow and its graceful
fallback when AI analysis fails, current-audit highlighting, and
HTML-escaping — were additionally verified against real captured scan
data using a temporary jsdom harness during development (not part of the
shipped `npm test` suite, which stays dependency-free).

## Notes

- The URL is percent-encoded on the way out and re-validated + rendered as
  plain text (never HTML) everywhere it's read back from a query string.
- `server/services/websiteScanner.js` is the single entry point for page
  data; `server/services/auditEngine.js` turns that into scores; and
  `server/services/aiAnalyzer.js` turns both into recommendations. All
  three have stable, independent output shapes.
