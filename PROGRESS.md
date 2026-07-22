# Implementation Progress — Degoony Evergreen Fleet

Cross-reference with `production-readiness-plan.md` in this same folder for full context on *why*
each item matters. This file tracks *what has actually been done in the code* so you (or I, in a
future session) can pick up exactly where things left off.

## Status: COMPLETE (all phases done) ✅

## ✅ Done

### Phase 1: Backend routes (complete)
- `server/routes/vehicles.ts` — full CRUD with status validation
- `server/routes/drivers.ts` — full CRUD
- `server/routes/supervisors.ts` — full CRUD
- `server/routes/inspections.ts` — full CRUD with JSONB checklist
- `server/routes/documents.ts`, `services.ts`, `battery.ts`, `tyres.ts`, `revenue.ts`, `accidents.ts`, `photos.ts`, `valuations.ts` — read + create per vehicle
- `server/db.ts` — Neon pool connection with `query`/`queryOne`/`execute`/`healthCheck`/`closePool`
- `server/schema.ts` — all table DDL including `inspections` table
- `server/types.ts` — re-exports from `src/types/fleet.ts`
- `server/validate.ts` — `requireFields`, `requireIdParam`, `asyncHandler`
- `server/index.ts` — Express app, CORS allowlist, all routes wired

### Phase 2: Frontend → real API (complete)
- `src/lib/apiClient.ts` — typed fetch wrappers with automatic snake↔camel conversion for all endpoints
- `src/lib/analytics.ts` — refactored to accept data params (no mock imports)
- `vite.config.ts` — `/api` proxy to `localhost:3001`
- `src/components/FleetDashboard.tsx` — real API fetch, loading/error states, Add Vehicle modal
- `src/components/VehicleProfile.tsx` — fetches vehicle + all 8 sub-resources, loading/error per tab
- `src/components/DriverManagement.tsx` — shadcn card-grid, real CRUD, edit/delete modals, search/filter
- `src/components/AnalyticsDashboard.tsx` — parallel API fetch, loading/error states
- `src/components/InspectionsView.tsx` — real API, add modal, review modal, stats, search/filter
- Dead files moved to `_deprecated_do_not_use/` (not deleted): `src-lib-api.ts`, `src-lib-db.ts`, `src-lib-schema.ts`

### Phase 3: Real authentication (complete)
- `server/auth.ts` — password hashing via Node `crypto.scrypt`, session tokens, `requireAuth` middleware, `seedDefaultAdmin()`
- `server/routes/auth.ts` — `/login`, `/me`, `/logout`, `/change-password` endpoints
- `server/schema.ts` — `admin_users` and `sessions` tables with indexes
- `server/index.ts` — auth route mounted, `seedDefaultAdmin()` called on startup
- `src/lib/apiClient.ts` — `login()`, `getMe()`, `logout()`, token management in localStorage
- `src/components/AdminLogin.tsx` — wired to real API (no more hardcoded admin/admin)
- `src/App.tsx` — auth state check on load, login gate, logout button in sidebar

### Phase 4: Hardening (complete)
- `server/rateLimit.ts` — in-memory rate limiter (120/min general, 10/15min for login)
- `server/logger.ts` — request logging with method, status, duration, user
- `server/index.ts` — tightened helmet CSP, credentials CORS, 1MB body limit
- `server/schema.ts` — NOT NULL + CHECK constraints, UNIQUE on plate/vin/license, ON DELETE CASCADE/SET NULL, expired session cleanup

### Phase 5: Tests & CI (complete)
- `tests/apiClient.test.ts` — snake<->camel conversion (8 tests)
- `tests/auth.test.ts` — password hashing, verification, token generation (8 tests)
- `tests/utils.test.ts` — daysUntilExpiry (4 tests)
- `vitest.config.ts` — node environment, path aliases
- `.github/workflows/ci.yml` — Node 18+20 matrix, npm ci + test

### Phase 6: Deployment (complete)
- `Dockerfile` — multi-stage build (node:20-alpine), non-root user
- `.dockerignore` — excludes node_modules, dist, .env, .git
- `render.yaml` — Render.com deployment config (free tier)
- `.env.example` — updated with NODE_ENV

## ⏭️ Manual action required
- Phase 0: Rotate Neon DB password (⚠️ STILL NOT DONE — .env still has the original exposed credential as of this review. You must do this yourself in the Neon console, and check `git log --all --full-history -- .env` to see if it was ever committed to a repo, in which case rotation is non-negotiable.)

## 🔍 Bug found and fixed during review (2nd session)
- `server/schema.ts` had **mismatched CHECK constraints**: vehicles constraint only allowed `active/maintenance/retired` but the app actually sends `active/in_repair/decommissioned/sold`; drivers constraint only allowed `active/inactive/terminated` but the UI also sends `on_leave`. This meant setting a vehicle to "In Repair"/"Decommissioned"/"Sold", or a driver to "On Leave", would have failed with a Postgres constraint violation (500 error) the first time someone tried it in production. Fixed with matching constraints + migration ALTERs so it also repairs any table already created against the old constraint.
- `.github/workflows/ci.yml` only ran tests — added `npm run lint` and `npm run build` steps so type errors and lint issues also fail CI, not just test failures.

## Still worth checking before real production traffic
- `render.yaml` only deploys the Express server (`startCommand: node --import tsx server/index.ts`) — it does not serve the built frontend. Either deploy the frontend separately (Vercel/Netlify) and add its URL to `ALLOWED_ORIGINS`, or add static-file serving of `dist/` to `server/index.ts` if you want one combined deployment.
- Default admin user is seeded as `admin`/`admin` on first run — log in and change this immediately in any environment reachable outside your own machine (there's a `/api/auth/change-password` endpoint and presumably UI for it).
- Cloudinary photo upload: `VehiclePhoto`/`photos` endpoint stores metadata only; confirm the actual upload-to-Cloudinary call is wired client-side before relying on it.
- No test coverage yet for the new `server/routes/*` endpoints themselves (current tests cover `apiClient` conversion helpers, auth hashing, and `daysUntilExpiry` — not the Express routes or schema constraints). Worth adding integration tests against a test database before calling Phase 5 fully done.

## Notes / decisions made
- Server routes return snake_case (raw DB rows); `apiClient.ts` converts to camelCase automatically via `toCamel()`/`convertKeys()`.
- `camelToSnake` reverse conversion applied on POST/PATCH request bodies.
- `analytics.ts` functions accept data params so they work with both mock and real data.
- Server generates IDs via `crypto.randomUUID()` rather than trusting client-supplied IDs.
- `server/types.ts` re-exports from `src/types/fleet.ts` — no duplication.
- `InspectionsView.tsx` self-contained `Inspection` type aligned with API shape (checklist stored as JSONB in Postgres).
- No `tsconfig.server.json` — server runs via `tsx` directly.
- Auth uses Node built-in `crypto.scrypt` for password hashing — no bcrypt dependency needed.
- Sessions stored in DB with 7-day expiry; `requireAuth` middleware validates Bearer token on protected routes.
- Default admin user seeded on startup: `admin` / `admin` — must change password after first login.
- Auth token stored in `localStorage` on client; attached as `Authorization: Bearer <token>` header.
- Added `server/seed.ts` (`npm run seed`) — idempotent demo dataset (10 vehicles, 8 drivers, 3 supervisors, documents, service/battery/tyre logs, ~40 revenue entries across 6 months, 2 accident reports, 3 valuations, 4 inspections). Safe to re-run.

## Troubleshooting: "Internal Server Error" on login
That exact plain-text response (not JSON) is Vite's dev proxy default error page — it means the frontend (port 5173) couldn't reach the backend (port 3001) at all, not that the backend rejected the login. Checklist:
1. Is `npm run server` actually running in its own terminal, and did it print `Database ready` / `Server listening on http://localhost:3001`? If it crashed or exited, that's the cause.
2. If it crashed on startup, the most likely reasons: `npm install` wasn't (re)run after new dependencies were added (tsx, dotenv, express, etc.), or `DATABASE_URL` in `.env` is wrong/unreachable.
3. Confirm nothing else is already bound to port 3001.
4. Once `npm run server` is confirmed running and healthy, retry login.

## 🔍 Critical data bug found and fixed: garbled currency totals
Symptom: "Total Revenue GH₵ 0338958053137512651714562" and similarly garbled "Net Margin" on the Vehicle Profile page.

Root cause: Postgres `NUMERIC` columns (purchase_price, cost, amount fields) come back from
node-postgres/@neondatabase/serverless as **strings**, not numbers (this is intentional — it avoids
floating point precision loss on money values). Several places in the frontend summed these with
`array.reduce((sum, r) => sum + r.amount, 0)`, and since `r.amount` was a string, JS did **string
concatenation** instead of addition (e.g. `0 + "3200.00"` becomes the string `"03200.00"`, not the
number `3200`), producing the garbled multi-digit values seen on screen.

Fix (in `src/lib/apiClient.ts`): added `coerceNumberFields()`, applied to every getter/creator that
returns a money or NUMERIC-backed field (`purchasePrice`, `cost`, `amount`, `mileageKm` across
vehicles, service/battery/tyre logs, revenue entries, accident reports, valuations). This fixes the
bug at the source for every screen that consumes these, not just Vehicle Profile.

Also added `formatGHS()` in `src/lib/utils.ts` — a single consistent currency formatter
(thousand separators + 2 decimals, coerces to Number defensively) now used throughout
`VehicleProfile.tsx` instead of ad-hoc `GH₵ ${x.toLocaleString()}` string-building.

## 🎨 Visual pass: Vehicle Profile page (shadcn-style redesign)
Rewrote `src/components/VehicleProfile.tsx`:
- Gradient header banner (slate-900 → emerald-950) with vehicle icon, plate number, status badge
- Sidebar nav restyled with shadcn `Card`, active-state uses solid emerald fill instead of a light tint
- Overview tab: icon-labeled info cards, gradient stat tiles (Total Revenue / Total Costs / Net Margin) with icon badges and correct GH₵ formatting
- All row components (service/battery/tyre/revenue/accident/valuation) use `formatGHS()` and slightly refined spacing/hover states
- `AnalyticsDashboard.tsx` and `FleetDashboard.tsx` were audited and do **not** have the same string-concatenation bug (no raw `+` reduction over currency fields there) — left as-is, both already use shadcn `Card`/`Table` components consistently

**Not yet redesigned in this pass** (same correctness fix already applies to them via `apiClient.ts`, but visuals are unchanged): `DriverManagement.tsx`, `InspectionsView.tsx`, `UserManagement.tsx`, `FleetDashboard.tsx`. Happy to do a matching visual pass on these next if wanted.
