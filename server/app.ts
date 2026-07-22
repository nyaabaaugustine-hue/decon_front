import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { initializeSchema } from './schema.js';
import { healthCheck } from './db.js';
import { requestLogger } from './logger.js';
import { requirePasswordChanged } from './auth.js';
import vehiclesRouter from './routes/vehicles.js';
import driversRouter from './routes/drivers.js';
import documentsRouter from './routes/documents.js';
import servicesRouter from './routes/services.js';
import batteryRouter from './routes/battery.js';
import tyresRouter from './routes/tyres.js';
import revenueRouter from './routes/revenue.js';
import accidentsRouter from './routes/accidents.js';
import photosRouter from './routes/photos.js';
import valuationsRouter from './routes/valuations.js';
import inspectionsRouter from './routes/inspections.js';
import supervisorsRouter from './routes/supervisors.js';
import authRouter from './routes/auth.js';
import uploadsRouter from './routes/uploads.js';
import searchRouter from './routes/search.js';
import statsRouter from './routes/stats.js';
import auditLogsRouter from './routes/audit-logs.js';
import searchHistoryRouter from './routes/search-history.js';
import assignmentsRouter from './routes/assignments.js';
import workOrdersRouter from './routes/work-orders.js';
import fuelRouter from './routes/fuel.js';
import expensesRouter from './routes/expenses.js';
import notificationsRouter from './routes/notifications.js';
import settingsRouter from './routes/settings.js';
import sparePartsRouter from './routes/spare-parts.js';
import serviceProvidersRouter from './routes/service-providers.js';
import driverLicensesRouter from './routes/driver-licenses.js';
import driverContractsRouter from './routes/driver-contracts.js';
import driverEvaluationsRouter from './routes/driver-evaluations.js';
import { seedDefaultAdmin } from './auth.js';

dotenv.config();

export const app = express();

// ── Trust proxy (1 hop) ──────────────────────────────────────────────────────
// Required for `req.ip` to reflect the real client IP behind Render/Vercel's
// reverse proxy.  Without this, the rate limiter keys on the proxy's IP —
// all users share one bucket, causing self-inflicted lockouts.
app.set('trust proxy', 1);

// ── Security ──────────────────────────────────────────────────────────────────

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https://res.cloudinary.com'],
      // 'self' covers our own API; api.cloudinary.com is needed because the browser
      // uploads image bytes directly to Cloudinary using the signed params we hand it
      // (POST /api/uploads/cloudinary-signature) — the file itself never touches our server.
      connectSrc: ["'self'", 'https://api.cloudinary.com'],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const isProduction = process.env.NODE_ENV === 'production';
// Vite auto-increments the dev port (5173 -> 5174 -> 5175...) whenever the
// previous port is still occupied by another running instance. Hardcoding a
// single port in ALLOWED_ORIGINS meant every login broke the moment two dev
// servers were running at once. In non-production, trust any localhost/127.0.0.1
// origin regardless of port; production still only trusts the explicit allowlist.
const localhostOriginPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

// Vercel preview deployments each get a unique, unguessable *.vercel.app
// subdomain generated per-build — there's no way to know it ahead of time to
// add to ALLOWED_ORIGINS. When actually running on Vercel, trust any
// *.vercel.app origin so preview URLs work out of the box; every request still
// requires a valid Bearer token regardless of origin, so this doesn't weaken auth.
const vercelPreviewPattern = /^https:\/\/[a-z0-9-]+\.vercel\.app$/;

app.use(cors({
  origin: (origin, callback) => {
    if (
      !origin ||
      allowedOrigins.includes(origin) ||
      (!isProduction && localhostOriginPattern.test(origin)) ||
      (isVercel && vercelPreviewPattern.test(origin))
    ) {
      callback(null, true);
    } else {
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    }
  },
  credentials: true,
}));

app.use(express.json({ limit: '1mb' }));

// ── Logging & rate limiting ───────────────────────────────────────────────────
// NOTE: the in-memory rate limiter (server/rateLimit.ts) only works correctly
// on a single long-running process (Render/Docker/local). On Vercel each
// invocation may land on a different function instance, so counts reset
// unpredictably — it still runs (no harm), but don't rely on it as your only
// brute-force protection in a Vercel deployment.

app.use(requestLogger);
// Rate limiting is disabled in development to avoid lockouts during debugging.
if (!isProduction) {
  app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: 'Too many login attempts. Try again in 15 minutes.' }));
  app.use('/api', rateLimit({ windowMs: 60 * 1000, max: 120 }));
}

// ── Force password change enforcement ──────────────────────────────────────
// Blocks all API access (except auth endpoints) when a user's
// must_change_password flag is still true.  This enforces the forced password
// change server-side, not just via frontend redirect.
app.use('/api', requirePasswordChanged);

// ── Routes ────────────────────────────────────────────────────────────────────

app.use('/api/auth', authRouter);
app.use('/api/vehicles', vehiclesRouter);
app.use('/api/drivers', driversRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/services', servicesRouter);
app.use('/api/battery', batteryRouter);
app.use('/api/tyres', tyresRouter);
app.use('/api/revenue', revenueRouter);
app.use('/api/accidents', accidentsRouter);
app.use('/api/photos', photosRouter);
app.use('/api/valuations', valuationsRouter);
app.use('/api/inspections', inspectionsRouter);
app.use('/api/supervisors', supervisorsRouter);
app.use('/api/uploads', uploadsRouter);
app.use('/api/search', searchRouter);
app.use('/api/stats', statsRouter);
app.use('/api/audit-logs', auditLogsRouter);
app.use('/api/search-history', searchHistoryRouter);
app.use('/api/assignments', assignmentsRouter);
app.use('/api/work-orders', workOrdersRouter);
app.use('/api/fuel', fuelRouter);
app.use('/api/expenses', expensesRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/spare-parts', sparePartsRouter);
app.use('/api/service-providers', serviceProvidersRouter);
app.use('/api/driver-licenses', driverLicensesRouter);
app.use('/api/driver-contracts', driverContractsRouter);
app.use('/api/driver-evaluations', driverEvaluationsRouter);

app.get('/api/health', async (_req, res) => {
  const isHealthy = await healthCheck();
  res.json({ status: isHealthy ? 'ok' : 'error', timestamp: new Date().toISOString() });
});

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message });
});

// ── Database init ─────────────────────────────────────────────────────────────
// The promise is exported so that server/index.ts can await it before calling
// .listen(), ensuring tables are created before accepting traffic.
export const dbReady: Promise<void> = initializeSchema()
  .then(() => seedDefaultAdmin())
  .then(() => console.log('Database ready'))
  .catch((error) => {
    console.error('Schema init failed:', error.message);
  });
