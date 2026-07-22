// Entry point for Render, Docker, and local `npm run server` — a single
// long-running Node process that both listens on a port and serves the API.
import { app, dbReady } from './app.js';
import { closePool } from './db.js';

const PORT = process.env.PORT || 3001;

// Wait for schema + seed to complete before accepting traffic.
dbReady.then(() => {
  app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
});

process.on('SIGTERM', async () => { await closePool(); process.exit(0); });
process.on('SIGINT', async () => { await closePool(); process.exit(0); });
