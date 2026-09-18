# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`tochi.event` — an operations dashboard for a small event-management studio:
inventory items, appointments, events (with revenue), expenses, and profit,
with two roles:

- **Owner** — sees everything, including Expenses and Profit, and manages team accounts.
- **Staff** — can add/edit items, appointments and events, but cannot see Expenses, Profit, or the Team tab.

Event types are tags, not separate catalogs: **Wedding, Engagement, Birthday, Baby welcoming.**

## Commands

```bash
npm install                 # install (only real dependency: express)
cp .env.example .env        # then set JWT_SECRET to a long random string
npm run seed                # interactive prompt to create the first Owner account
npm start                   # (same as `npm run dev`) runs node server.js on :3000
```

There is no build step, no linter, and no test suite configured — the
frontend is plain HTML/CSS/JS served statically, and there is nothing to
compile. Restart `npm start` after editing server-side files (`server.js`,
`routes/`, `middleware/`, `lib/`, `db.js`); frontend files under `public/`
are served as-is and only need a browser refresh.

## Architecture

**Data flow:** `public/app.js` (vanilla JS, no framework/bundler) calls the
JSON REST API under `/api/*` with a `Bearer` token from `localStorage`, gets
back plain objects, and re-renders the active tab by rebuilding its HTML
string. There is no client-side router or component framework — `renderAll()`
in `app.js` calls one `render<Tab>()` function per section (Overview,
Calendar, Items, Appointments, Events, Expenses, Team), each of which reads
from the in-memory `state` object and writes `innerHTML`.

**Storage:** `db.js` is a tiny file-backed JSON store (`data/db.json`,
auto-created), not a real database. Every request re-reads and re-writes the
whole file, serialized through an in-process write queue (`writeChain` in
`db.js`) so concurrent requests can't corrupt it — fine at this scale (a
handful of users, a few thousand records), not built for high concurrency.
`collection(name)` returns `{ list, get, create, update, remove }` for one
top-level array (`users`, `items`, `appointments`, `events`, `expenses`).
**To swap in a real database, rewrite only these five methods in `db.js`** —
routes and frontend never touch the file format directly.

**Auth:** hand-rolled, no external auth library.
- `lib/passwords.js` — scrypt-based hashing (Node's built-in `crypto`).
- `lib/authToken.js` — signed, expiring tokens (`base64url(payload).hmacSig`),
  a minimal hand-rolled JWT-equivalent since only this server ever issues or
  verifies one.
- `middleware/auth.js` — `requireAuth` reads the `Bearer` token and attaches
  `req.user = { id, role, name }`; `requireOwner` gates owner-only routes.
  Role-based visibility is enforced here, on the server — not just hidden in
  the UI.
- `routes/auth.js` also has `POST /api/auth/bootstrap`, which creates the
  first Owner account over HTTP and is a permanent no-op once any user
  exists (lets a fresh deploy be set up without shell/`npm run seed` access).

**Routes:** `routes/crud.js` exports one `crudRouter(name, { ownerOnly })`
factory used for `items`, `appointments`, `events`, and `expenses`
(`expenses` passes `ownerOnly: true`) — list/create/update/delete are
identical across these collections, so new fields on a collection typically
need no route changes, only frontend changes. `server.js` wires these routers
plus `routes/auth.js` and a single owner-only `GET /api/backup` (full JSON
snapshot, strips `users` so password hashes never leave the server).

**Frontend (`public/app.js`, single ~1900-line IIFE, no modules):** global
`state` holds the loaded collections; `CATEGORIES` / `EXPENSE_CATEGORIES` are
the fixed vocabularies (expense categories also grow with any custom value a
user has typed before, remembered by scanning existing `state.expenses`).
Money is formatted as IQD via `fmtMoney`. All HTML is built with string
concatenation and `escapeHtml` — there is no templating engine, so any new
UI follows the same pattern as the existing `render*` functions.

## Deployment notes (from README)

- `JWT_SECRET` must be changed before deploying anywhere but a local machine.
- `data/db.json` is the entire database — back it up regularly.
- No built-in HTTPS; put a reverse proxy in front for real deployments.
- `DATA_DIR` env var relocates `data/db.json` (e.g. a platform's persistent
  volume) so data survives restarts/redeploys.
