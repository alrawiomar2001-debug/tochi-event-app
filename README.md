# tochi.event — Studio Ops Dashboard

A small operations dashboard for an event-management business: inventory
items, appointments, sales, expenses, revenue and profit — with two roles:

- **Owner** — sees everything, including Expenses and Profit, and manages team accounts.
- **Staff** — can add/edit items, appointments and sales, but cannot see Expenses, Profit, or the Team tab.

Event types are tagged, not separate catalogs: **Wedding, Engagement, Birthday, Baby welcoming.**

## Stack

Plain Node.js + Express backend, a JSON file as the database (`data/db.json`,
created automatically), and a vanilla HTML/CSS/JS frontend — no build step,
no external database server to install. Good for a small team (4–8 events a
month); if the studio grows a lot, swap `db.js` for a real database without
touching the routes or frontend, since they only talk to `db.js`'s small API.

The only external package is **Express** itself — password hashing, login
tokens and `.env` loading are implemented with Node's built-in `crypto`
module in `lib/` instead of extra dependencies, so there's less that can
fail to install in a locked-down environment.

## Getting started (for Claude Code, or anyone at a terminal)

```bash
npm install
cp .env.example .env
# open .env and set JWT_SECRET to a long random string

npm run seed
# follow the prompts to create the first Owner account

npm start
# open http://localhost:3000 and sign in with the account you just created
```

Once signed in as Owner, go to the **Team** tab to add staff accounts (or
additional owners). Each person gets their own email + password login —
that's the whole "who can see what" system, enforced on the server, not
just hidden in the UI.

## Project layout

```
server.js              Express app entry point
db.js                  Tiny JSON-file data store (users, items, appointments, sales, expenses)
lib/passwords.js       Password hashing (Node crypto/scrypt, no dependency)
lib/authToken.js       Signed, expiring login tokens (Node crypto/HMAC, no dependency)
lib/loadEnv.js         Minimal .env file loader (no dependency)
middleware/auth.js     Login-token verification + owner-only guard
routes/auth.js         Login, current user, team management
routes/crud.js         Generic list/create/update/delete routes for items/appointments/sales/expenses
scripts/seed.js        Interactive script to create the first Owner account
public/                Frontend: index.html, styles.css, app.js
data/db.json           Created on first run — all the studio's data lives here
```

## Notes for whoever deploys this

- **Change `JWT_SECRET`** before putting this anywhere other than your own laptop — it's what makes login tokens unforgeable.
- **Back up `data/db.json`** regularly (it's the entire database — copy it somewhere safe, e.g. a daily cron job or cloud sync).
- The server has no built-in HTTPS — put it behind a reverse proxy (nginx, Caddy) or a host that terminates TLS for you before using it over the internet.
- Passwords are hashed with scrypt (Node's built-in `crypto`); nothing sensitive is stored in plain text.
- This was intentionally kept to one dependency (`express`) so it installs and runs anywhere Node.js runs, including inside Claude Code.

## Extending it

- Swap the JSON file store for Postgres/SQLite by rewriting `db.js`'s five methods (`list/get/create/update/remove`) — nothing else needs to change.
- Add a "reports" export (CSV/Excel) by reading `data/db.json` and running it through a spreadsheet library.
- Add email notifications for upcoming appointments with a small cron job that reads `/api/appointments`.
