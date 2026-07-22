/**
 * Database configuration constants for Neon PostgreSQL.
 *
 * Centralizes pagination limits, search defaults, Neon pool tuning,
 * and other tunable knobs so they're consistent across all routes.
 */
export const DB_CONFIG = {
  // ── Pagination ──────────────────────────────────────────────────────────────
  pagination: {
    /** Default page size when the client omits ?limit=N */
    defaultLimit: 50,
    /** Hard upper bound — clients asking for more than this get silently capped */
    maxLimit: 1000,
    /** Keyset-pagination cursor column */
    cursorColumn: 'id' as const,
    /** Default sort direction for list endpoints */
    defaultOrder: 'DESC' as const,
  },

  // ── Search ──────────────────────────────────────────────────────────────────
  search: {
    /** Default number of search results returned */
    defaultLimit: 20,
    /** Maximum search results (prevents runaway queries) */
    maxLimit: 100,
    /** Minimum query length before we bother running a search */
    minQueryLength: 2,
    /** Maximum length of a search term (prevents abuse) */
    maxQueryLength: 500,
    /** Full-text search configuration name (english, simple, etc.) */
    textSearchConfig: 'english' as const,
  },

  // ── Neon connection pool tuning ────────────────────────────────────────────
  pool: {
    /** Maximum simultaneous connections in the pool */
    maxConnections: 20,
    /** Close idle connections after N milliseconds */
    idleTimeoutMs: 30_000,
    /** Wait N milliseconds for a connection from the pool before timing out */
    connectionTimeoutMs: 10_000,
    /** Maximum number of connection retries on transient failure */
    maxRetries: 3,
    /** Delay between retries (ms) */
    retryDelayMs: 250,
    /** Allow the pool to queue requests when all connections are busy */
    allowExitOnIdle: false,
  },

  // ── Neon-specific connection pooler settings ──────────────────────────────
  /** Use the Neon pooled connection string (append ?pgbouncer=true or use -pooler host) */
  usePooler: true,
  /** Enable Neon's fetch connection cache for serverless environments */
  fetchConnectionCache: true,

  // ── Performance targets ────────────────────────────────────────────────────
  performance: {
    /** Target query execution time (ms) */
    targetQueryTimeMs: 50,
    /** Target search execution time (ms) */
    targetSearchTimeMs: 30,
    /** Target cache hit ratio (0-1) */
    targetCacheHitRatio: 0.95,
  },

  // ── Session management ─────────────────────────────────────────────────────
  session: {
    /** Session TTL (days) */
    ttlDays: 7,
    /** Cleanup interval for expired sessions (ms) */
    cleanupIntervalMs: 60 * 60 * 1000, // 1 hour
  },
} as const;

/**
 * SQL column-name helpers.
 * Centralised so route files don't hardcode column lists everywhere.
 */
export const TABLE_COLUMNS = {
  vehicles: [
    'id', 'plate_number', 'make', 'model', 'year', 'vin',
    'purchase_date', 'purchase_price', 'status', 'current_driver_id',
    'created_at', 'updated_at',
  ],
  drivers: [
    'id', 'full_name', 'phone', 'license_number', 'supervisor_id',
    'hire_date', 'status', 'photo_url', 'created_at', 'updated_at',
  ],
  supervisors: [
    'id', 'full_name', 'phone', 'region', 'created_at', 'updated_at',
  ],
  documents: [
    'id', 'vehicle_id', 'doc_type', 'file_name', 'issue_date',
    'expiry_date', 'notes', 'created_at', 'updated_at',
  ],
  serviceLogs: [
    'id', 'vehicle_id', 'service_date', 'mileage_km', 'service_type',
    'parts_replaced', 'workshop', 'cost', 'created_at', 'updated_at',
  ],
  batteryLogs: [
    'id', 'vehicle_id', 'install_date', 'replacement_date',
    'brand', 'supplier', 'cost', 'created_at', 'updated_at',
  ],
  tyreLogs: [
    'id', 'vehicle_id', 'position', 'install_date', 'replacement_date',
    'brand', 'cost', 'created_at', 'updated_at',
  ],
  revenueEntries: [
    'id', 'vehicle_id', 'driver_id', 'trip_date', 'trip_reference',
    'route', 'client', 'amount', 'created_at', 'updated_at',
  ],
  accidents: [
    'id', 'vehicle_id', 'driver_id', 'accident_date', 'description',
    'cost', 'driver_at_fault', 'created_at', 'updated_at',
  ],
  photos: [
    'id', 'vehicle_id', 'category', 'caption', 'taken_at', 'image_url',
    'created_at', 'updated_at',
  ],
  valuations: [
    'id', 'vehicle_id', 'valuation_date', 'source', 'amount',
    'condition_notes', 'created_at', 'updated_at',
  ],
  inspections: [
    'id', 'vehicle_id', 'driver_name', 'inspection_date', 'overall_status',
    'checklist', 'notes', 'photo_count', 'created_at', 'updated_at',
  ],
} as const;
