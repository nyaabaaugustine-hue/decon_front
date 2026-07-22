import { pool, execute } from './db.js';

// Bump this whenever the schema changes.  initializeSchema() checks this
// against the `schema_migrations` table — if the row already exists, the
// entire DDL/migration block is skipped (single round-trip instead of ~80).
const SCHEMA_VERSION = 3;

async function run(sql: string, label: string) {
  console.log(`  [schema] ${label}...`);
  await pool.query(sql);
  console.log(`  [schema] ${label} ✓`);
}

export async function initializeSchema(): Promise<void> {
  const t0 = Date.now();

  // Fast-fail: test database connectivity before running 50+ sequential
  // queries.  If the database is unreachable (e.g. DATABASE_URL missing on
  // Vercel), each query would hang for connectionTimeoutMillis — potentially
  // blocking the serverless function for minutes.  A single SELECT 1 with a
  // short timeout catches this immediately.
  if (!process.env.DATABASE_URL) {
    console.warn('  [schema] DATABASE_URL not set — skipping schema init');
    return;
  }

  try {
    await pool.query('SELECT 1');
  } catch {
    console.warn('  [schema] Cannot reach database — skipping schema init');
    return;
  }

  // Fast path — if the schema is already at the current version, skip
  // everything.  The table itself is created below (first boot only).
  try {
    const { rows } = await pool.query(
      'SELECT 1 FROM schema_migrations WHERE version = $1',
      [SCHEMA_VERSION],
    );
    if (rows.length > 0) {
      console.log(`  [schema] already at version ${SCHEMA_VERSION}, skipping (${Date.now() - t0}ms)`);
      return;
    }
  } catch {
    // schema_migrations table doesn't yet exist — fall through to full init
  }

  await run(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`, 'extensions');
  await run(`CREATE EXTENSION IF NOT EXISTS pg_trgm`, 'pg_trgm');

  await run(`
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
    $$ LANGUAGE plpgsql
  `, 'function update_updated_at');

  await run(`
    CREATE OR REPLACE FUNCTION log_audit_event()
    RETURNS TRIGGER AS $$
    DECLARE _changes JSONB;
    BEGIN
      _changes = jsonb_build_object('old', row_to_json(OLD), 'new', row_to_json(NEW));
      INSERT INTO audit_log (table_name, operation, record_id, changed_by, changes)
      VALUES (TG_TABLE_NAME, TG_OP, COALESCE(NEW.id::TEXT, OLD.id::TEXT),
              current_setting('app.current_user_id', TRUE), _changes);
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `, 'function log_audit_event');

  // Tables
  await run(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin','manager','viewer')),
      must_change_password BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `, 'table admin_users');

  await run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `, 'table sessions');

  await run(`
    CREATE TABLE IF NOT EXISTS supervisors (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      region TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    )
  `, 'table supervisors');

  await run(`
    CREATE TABLE IF NOT EXISTS drivers (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      license_number TEXT NOT NULL UNIQUE,
      supervisor_id TEXT REFERENCES supervisors(id) ON DELETE SET NULL,
      hire_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','on_leave','terminated')),
      photo_url TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    )
  `, 'table drivers');

  await run(`
    CREATE TABLE IF NOT EXISTS vehicles (
      id TEXT PRIMARY KEY,
      plate_number TEXT NOT NULL UNIQUE,
      make TEXT NOT NULL,
      model TEXT NOT NULL,
      year INTEGER NOT NULL CHECK (year >= 1990 AND year <= 2100),
      vin TEXT NOT NULL UNIQUE,
      purchase_date TEXT NOT NULL,
      purchase_price NUMERIC NOT NULL CHECK (purchase_price >= 0),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','in_repair','decommissioned','sold')),
      current_driver_id TEXT REFERENCES drivers(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    )
  `, 'table vehicles');

  await run(`
    CREATE TABLE IF NOT EXISTS vehicle_documents (
      id TEXT PRIMARY KEY,
      vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      doc_type TEXT NOT NULL,
      file_name TEXT NOT NULL,
      issue_date TEXT NOT NULL,
      expiry_date TEXT,
      notes TEXT,
      search_vector tsvector GENERATED ALWAYS AS (
        to_tsvector('english', COALESCE(file_name, '') || ' ' || COALESCE(doc_type, '') || ' ' || COALESCE(notes, ''))
      ) STORED,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `, 'table vehicle_documents');

  await run(`
    CREATE TABLE IF NOT EXISTS service_logs (
      id TEXT PRIMARY KEY,
      vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      service_date TEXT NOT NULL,
      mileage_km INTEGER NOT NULL CHECK (mileage_km >= 0),
      service_type TEXT NOT NULL,
      parts_replaced TEXT NOT NULL,
      workshop TEXT NOT NULL,
      cost NUMERIC NOT NULL CHECK (cost >= 0),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `, 'table service_logs');

  await run(`
    CREATE TABLE IF NOT EXISTS battery_logs (
      id TEXT PRIMARY KEY,
      vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      install_date TEXT NOT NULL,
      replacement_date TEXT,
      brand TEXT NOT NULL,
      supplier TEXT NOT NULL,
      cost NUMERIC NOT NULL CHECK (cost >= 0),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `, 'table battery_logs');

  await run(`
    CREATE TABLE IF NOT EXISTS tyre_logs (
      id TEXT PRIMARY KEY,
      vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      position TEXT NOT NULL,
      install_date TEXT NOT NULL,
      replacement_date TEXT,
      brand TEXT NOT NULL,
      cost NUMERIC NOT NULL CHECK (cost >= 0),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `, 'table tyre_logs');

  await run(`
    CREATE TABLE IF NOT EXISTS revenue_entries (
      id TEXT PRIMARY KEY,
      vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      driver_id TEXT REFERENCES drivers(id) ON DELETE SET NULL,
      trip_date TEXT NOT NULL,
      trip_reference TEXT NOT NULL,
      route TEXT NOT NULL,
      client TEXT NOT NULL,
      amount NUMERIC NOT NULL CHECK (amount >= 0),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `, 'table revenue_entries');

  await run(`
    CREATE TABLE IF NOT EXISTS accident_reports (
      id TEXT PRIMARY KEY,
      vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      driver_id TEXT REFERENCES drivers(id) ON DELETE SET NULL,
      accident_date TEXT NOT NULL,
      description TEXT NOT NULL,
      cost NUMERIC NOT NULL CHECK (cost >= 0),
      driver_at_fault BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `, 'table accident_reports');

  await run(`
    CREATE TABLE IF NOT EXISTS vehicle_photos (
      id TEXT PRIMARY KEY,
      vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      caption TEXT NOT NULL,
      taken_at TEXT NOT NULL,
      image_url TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `, 'table vehicle_photos');

  await run(`
    CREATE TABLE IF NOT EXISTS valuations (
      id TEXT PRIMARY KEY,
      vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      valuation_date TEXT NOT NULL,
      source TEXT NOT NULL,
      amount NUMERIC NOT NULL CHECK (amount >= 0),
      condition_notes TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `, 'table valuations');

  await run(`
    CREATE TABLE IF NOT EXISTS inspections (
      id TEXT PRIMARY KEY,
      vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      driver_name TEXT NOT NULL,
      inspection_date TEXT NOT NULL,
      overall_status TEXT NOT NULL CHECK (overall_status IN ('pass','fail','flagged')),
      checklist JSONB NOT NULL DEFAULT '[]',
      notes TEXT DEFAULT '',
      photo_count INTEGER DEFAULT 0 CHECK (photo_count >= 0),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `, 'table inspections');

  await run(`
    CREATE TABLE IF NOT EXISTS search_history (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
      query TEXT NOT NULL,
      result_count INTEGER NOT NULL DEFAULT 0,
      entity_type TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `, 'table search_history');

  await run(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id BIGSERIAL PRIMARY KEY,
      table_name TEXT NOT NULL,
      operation TEXT NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
      record_id TEXT NOT NULL,
      changed_by TEXT,
      changes JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `, 'table audit_log');

  // Events partitioned table
  await run(`
    CREATE TABLE IF NOT EXISTS events (
      id BIGSERIAL,
      event_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      data JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (id, created_at)
    ) PARTITION BY RANGE (created_at)
  `, 'table events');

  // Create monthly partitions
  await run(`
    DO $$
    DECLARE
      partition_name TEXT;
      start_date TEXT;
      end_date TEXT;
    BEGIN
      partition_name := 'events_' || to_char(CURRENT_DATE, 'YYYY_MM');
      start_date := to_char(CURRENT_DATE, 'YYYY-MM-01');
      end_date := to_char(CURRENT_DATE + INTERVAL '1 month', 'YYYY-MM-01');
      IF NOT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = partition_name AND n.nspname = 'public'
      ) THEN
        EXECUTE format(
          'CREATE TABLE %I PARTITION OF events FOR VALUES FROM (%L) TO (%L)',
          partition_name, start_date, end_date
        );
      END IF;

      partition_name := 'events_' || to_char(CURRENT_DATE + INTERVAL '1 month', 'YYYY_MM');
      start_date := to_char(CURRENT_DATE + INTERVAL '1 month', 'YYYY-MM-01');
      end_date := to_char(CURRENT_DATE + INTERVAL '2 months', 'YYYY-MM-01');
      IF NOT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = partition_name AND n.nspname = 'public'
      ) THEN
        EXECUTE format(
          'CREATE TABLE %I PARTITION OF events FOR VALUES FROM (%L) TO (%L)',
          partition_name, start_date, end_date
        );
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE WARNING 'Could not create event partition: %', SQLERRM;
    END $$;
  `, 'events partitions');

  // New fleet management tables
  await run(`
    CREATE TABLE IF NOT EXISTS vehicle_assignments (
      id TEXT PRIMARY KEY,
      vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      driver_id TEXT NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
      start_date TEXT NOT NULL,
      end_date TEXT,
      purpose TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
      notes TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `, 'table vehicle_assignments');

  await run(`
    CREATE TABLE IF NOT EXISTS work_orders (
      id TEXT PRIMARY KEY,
      vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','in_progress','completed','cancelled')),
      assigned_to TEXT DEFAULT '',
      estimated_cost NUMERIC DEFAULT 0 CHECK (estimated_cost >= 0),
      actual_cost NUMERIC DEFAULT 0 CHECK (actual_cost >= 0),
      due_date TEXT,
      completed_date TEXT,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `, 'table work_orders');

  await run(`
    CREATE TABLE IF NOT EXISTS fuel_entries (
      id TEXT PRIMARY KEY,
      vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      driver_id TEXT REFERENCES drivers(id) ON DELETE SET NULL,
      fuel_date TEXT NOT NULL,
      station TEXT NOT NULL DEFAULT '',
      fuel_type TEXT NOT NULL DEFAULT 'diesel',
      liters NUMERIC NOT NULL CHECK (liters > 0),
      cost_per_liter NUMERIC NOT NULL CHECK (cost_per_liter > 0),
      total_cost NUMERIC NOT NULL CHECK (total_cost >= 0),
      mileage_km INTEGER,
      fuel_card TEXT DEFAULT '',
      receipt_number TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `, 'table fuel_entries');

  await run(`
    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      vehicle_id TEXT REFERENCES vehicles(id) ON DELETE SET NULL,
      driver_id TEXT REFERENCES drivers(id) ON DELETE SET NULL,
      category TEXT NOT NULL CHECK (category IN ('fuel','maintenance','insurance','registration','repairs','salary','toll','parking','fine','other')),
      description TEXT NOT NULL,
      amount NUMERIC NOT NULL CHECK (amount >= 0),
      expense_date TEXT NOT NULL,
      receipt_url TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
      approved_by TEXT,
      notes TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `, 'table expenses');

  await run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES admin_users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'info' CHECK (type IN ('info','warning','alert','success')),
      category TEXT NOT NULL DEFAULT 'general',
      entity_type TEXT,
      entity_id TEXT,
      is_read BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `, 'table notifications');

  await run(`
    CREATE TABLE IF NOT EXISTS company_settings (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'general',
      description TEXT DEFAULT '',
      updated_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `, 'table company_settings');

  await run(`
    CREATE TABLE IF NOT EXISTS spare_parts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      part_number TEXT DEFAULT '',
      category TEXT NOT NULL DEFAULT 'general',
      quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
      min_quantity INTEGER NOT NULL DEFAULT 0 CHECK (min_quantity >= 0),
      unit_cost NUMERIC NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
      supplier TEXT DEFAULT '',
      location TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `, 'table spare_parts');

  await run(`
    CREATE TABLE IF NOT EXISTS service_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'workshop' CHECK (type IN ('workshop','dealer','tow','parts_store','other')),
      phone TEXT DEFAULT '',
      email TEXT DEFAULT '',
      address TEXT DEFAULT '',
      specialties TEXT DEFAULT '',
      rating NUMERIC DEFAULT 0,
      notes TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `, 'table service_providers');

  // Driver management tables
  await run(`
    CREATE TABLE IF NOT EXISTS driver_licenses (
      id TEXT PRIMARY KEY,
      driver_id TEXT NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
      license_class TEXT NOT NULL DEFAULT 'B',
      license_number TEXT NOT NULL,
      issue_date TEXT NOT NULL,
      expiry_date TEXT NOT NULL,
      issuing_authority TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'valid' CHECK (status IN ('valid','expiring_soon','expired','suspended')),
      notes TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `, 'table driver_licenses');

  await run(`
    CREATE TABLE IF NOT EXISTS driver_contracts (
      id TEXT PRIMARY KEY,
      driver_id TEXT NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
      contract_type TEXT NOT NULL DEFAULT 'full_time' CHECK (contract_type IN ('full_time','part_time','contract','probation')),
      start_date TEXT NOT NULL,
      end_date TEXT,
      education TEXT DEFAULT '',
      qualifications TEXT DEFAULT '',
      experience_years INTEGER DEFAULT 0 CHECK (experience_years >= 0),
      salary NUMERIC DEFAULT 0 CHECK (salary >= 0),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','terminated')),
      notes TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `, 'table driver_contracts');

  await run(`
    CREATE TABLE IF NOT EXISTS driver_evaluations (
      id TEXT PRIMARY KEY,
      driver_id TEXT NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
      evaluator_name TEXT NOT NULL DEFAULT '',
      evaluation_date TEXT NOT NULL,
      period TEXT DEFAULT '',
      safety_score INTEGER CHECK (safety_score BETWEEN 0 AND 100),
      punctuality_score INTEGER CHECK (punctuality_score BETWEEN 0 AND 100),
      driving_skill_score INTEGER CHECK (driving_skill_score BETWEEN 0 AND 100),
      overall_score INTEGER CHECK (overall_score BETWEEN 0 AND 100),
      strengths TEXT DEFAULT '',
      improvements TEXT DEFAULT '',
      comments TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','finalized')),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `, 'table driver_evaluations');

  // Indexes — batch into one statement per logical group
  await run(`
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at DESC);
    CREATE INDEX IF NOT EXISTS idx_drivers_supervisor ON drivers(supervisor_id);
    CREATE INDEX IF NOT EXISTS idx_vehicles_driver ON vehicles(current_driver_id);
  `, 'indexes batch 1 (sessions + FK)');

  await run(`
    CREATE INDEX IF NOT EXISTS idx_documents_vehicle ON vehicle_documents(vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_service_vehicle ON service_logs(vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_battery_vehicle ON battery_logs(vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_tyre_vehicle ON tyre_logs(vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_revenue_vehicle ON revenue_entries(vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_revenue_driver ON revenue_entries(driver_id);
    CREATE INDEX IF NOT EXISTS idx_accidents_vehicle ON accident_reports(vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_accidents_driver ON accident_reports(driver_id);
    CREATE INDEX IF NOT EXISTS idx_photos_vehicle ON vehicle_photos(vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_valuations_vehicle ON valuations(vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_inspections_vehicle ON inspections(vehicle_id);
  `, 'indexes batch 2 (child FK)');

  await run(`
    CREATE INDEX IF NOT EXISTS idx_service_vehicle_date ON service_logs(vehicle_id, service_date DESC);
    CREATE INDEX IF NOT EXISTS idx_battery_vehicle_date ON battery_logs(vehicle_id, install_date DESC);
    CREATE INDEX IF NOT EXISTS idx_tyre_vehicle_date ON tyre_logs(vehicle_id, install_date DESC);
    CREATE INDEX IF NOT EXISTS idx_revenue_vehicle_date ON revenue_entries(vehicle_id, trip_date DESC);
    CREATE INDEX IF NOT EXISTS idx_accidents_vehicle_date ON accident_reports(vehicle_id, accident_date DESC);
    CREATE INDEX IF NOT EXISTS idx_documents_vehicle_date ON vehicle_documents(vehicle_id, issue_date DESC);
    CREATE INDEX IF NOT EXISTS idx_photos_vehicle_date ON vehicle_photos(vehicle_id, taken_at DESC);
    CREATE INDEX IF NOT EXISTS idx_valuations_vehicle_date ON valuations(vehicle_id, valuation_date DESC);
    CREATE INDEX IF NOT EXISTS idx_inspections_vehicle_date ON inspections(vehicle_id, inspection_date DESC);
  `, 'indexes batch 3 (composite)');

  await run(`
    CREATE INDEX IF NOT EXISTS idx_vehicles_created ON vehicles(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_inspections_date ON inspections(inspection_date DESC);
    CREATE INDEX IF NOT EXISTS idx_vehicles_plate ON vehicles(plate_number) INCLUDE (make, model, status);
  `, 'indexes batch 4 (sort + covering)');

  await run(`
    CREATE INDEX IF NOT EXISTS idx_documents_search ON vehicle_documents USING GIN(search_vector);
    CREATE INDEX IF NOT EXISTS idx_revenue_client_route_search ON revenue_entries USING GIN(to_tsvector('english', client || ' ' || route));
    CREATE INDEX IF NOT EXISTS idx_vehicles_plate_trgm ON vehicles USING GIN(plate_number gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS idx_drivers_name_trgm ON drivers USING GIN(full_name gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS idx_drivers_license_trgm ON drivers USING GIN(license_number gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS idx_vehicles_vin_trgm ON vehicles USING GIN(vin gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS idx_inspections_checklist ON inspections USING GIN(checklist);
  `, 'indexes batch 5 (GIN/trigram)');

  await run(`
    CREATE INDEX IF NOT EXISTS idx_vehicles_active ON vehicles(id) WHERE status = 'active';
    CREATE INDEX IF NOT EXISTS idx_drivers_active ON drivers(id) WHERE status = 'active';
    CREATE INDEX IF NOT EXISTS idx_drivers_full_name ON drivers(full_name);
    CREATE INDEX IF NOT EXISTS idx_supervisors_full_name ON supervisors(full_name);
    CREATE INDEX IF NOT EXISTS idx_inspections_driver_date ON inspections(driver_name, inspection_date DESC);
    CREATE INDEX IF NOT EXISTS idx_revenue_driver_date ON revenue_entries(driver_id, trip_date DESC);
    CREATE INDEX IF NOT EXISTS idx_accidents_driver_date ON accident_reports(driver_id, accident_date DESC);
    CREATE INDEX IF NOT EXISTS idx_search_history_user ON search_history(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_search_history_query ON search_history(query);
    CREATE INDEX IF NOT EXISTS idx_search_history_created ON search_history(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_log_table ON audit_log(table_name, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_log_record ON audit_log(table_name, record_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_changed_by ON audit_log(changed_by);
    CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_events_entity ON events(entity_type, entity_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_events_data ON events USING GIN(data);
  `, 'indexes batch 6 (misc + driver-profile)');

  await run(`
    CREATE INDEX IF NOT EXISTS idx_assignments_vehicle ON vehicle_assignments(vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_assignments_driver ON vehicle_assignments(driver_id);
    CREATE INDEX IF NOT EXISTS idx_assignments_status ON vehicle_assignments(status);
    CREATE INDEX IF NOT EXISTS idx_work_orders_vehicle ON work_orders(vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(status);
    CREATE INDEX IF NOT EXISTS idx_work_orders_created ON work_orders(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_fuel_vehicle ON fuel_entries(vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_fuel_vehicle_date ON fuel_entries(vehicle_id, fuel_date DESC);
    CREATE INDEX IF NOT EXISTS idx_fuel_date ON fuel_entries(fuel_date DESC);
    CREATE INDEX IF NOT EXISTS idx_expenses_vehicle ON expenses(vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);
    CREATE INDEX IF NOT EXISTS idx_expenses_category_date ON expenses(category, expense_date DESC);
    CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
    CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_spare_parts_name ON spare_parts(name);
    CREATE INDEX IF NOT EXISTS idx_service_providers_name ON service_providers(name);
    CREATE INDEX IF NOT EXISTS idx_driver_licenses_driver ON driver_licenses(driver_id);
    CREATE INDEX IF NOT EXISTS idx_driver_licenses_expiry ON driver_licenses(expiry_date);
    CREATE INDEX IF NOT EXISTS idx_driver_licenses_status ON driver_licenses(status);
    CREATE INDEX IF NOT EXISTS idx_driver_contracts_driver ON driver_contracts(driver_id);
    CREATE INDEX IF NOT EXISTS idx_driver_contracts_status ON driver_contracts(status);
    CREATE INDEX IF NOT EXISTS idx_driver_evaluations_driver ON driver_evaluations(driver_id);
    CREATE INDEX IF NOT EXISTS idx_driver_evaluations_date ON driver_evaluations(evaluation_date DESC);
  `, 'indexes batch 7 (new tables)');

  // Triggers — updated_at for all tables + audit for select tables
  const allTables = [
    'admin_users', 'supervisors', 'drivers', 'vehicles',
    'vehicle_documents', 'service_logs', 'battery_logs', 'tyre_logs',
    'revenue_entries', 'accident_reports', 'vehicle_photos', 'valuations',
    'inspections', 'vehicle_assignments', 'work_orders', 'fuel_entries',
    'expenses', 'company_settings', 'spare_parts', 'service_providers',
    'driver_licenses', 'driver_contracts', 'driver_evaluations',
  ];
  const auditTables = ['admin_users', 'drivers', 'vehicles', 'vehicle_documents', 'accident_reports'];

  for (const tbl of allTables) {
    const hasAudit = auditTables.includes(tbl);
    const sql = `
      DROP TRIGGER IF EXISTS trg_${tbl}_updated_at ON ${tbl};
      CREATE TRIGGER trg_${tbl}_updated_at
      BEFORE UPDATE ON ${tbl}
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
    `;
    await run(sql, `trigger updated_at on ${tbl}`);
    if (hasAudit) {
      await run(`
        DROP TRIGGER IF EXISTS trg_${tbl}_audit ON ${tbl};
        CREATE TRIGGER trg_${tbl}_audit
        AFTER INSERT OR UPDATE OR DELETE ON ${tbl}
        FOR EACH ROW
        EXECUTE FUNCTION log_audit_event();
      `, `trigger audit on ${tbl}`);
    }
  }

  // RLS
  await run(`ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY`, 'RLS admin_users');
  await run(`ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY`, 'RLS vehicles');
  await run(`ALTER TABLE drivers ENABLE ROW LEVEL SECURITY`, 'RLS drivers');

  await run(`
    DROP POLICY IF EXISTS admin_users_self ON admin_users;
    CREATE POLICY admin_users_self
    ON admin_users FOR ALL
    USING (id = current_setting('app.current_user_id', TRUE)::TEXT)
    WITH CHECK (id = current_setting('app.current_user_id', TRUE)::TEXT)
  `, 'policy admin_users_self');

  await run(`
    DROP POLICY IF EXISTS vehicles_all_authenticated ON vehicles;
    CREATE POLICY vehicles_all_authenticated
    ON vehicles FOR SELECT USING (true)
  `, 'policy vehicles_all');

  await run(`
    DROP POLICY IF EXISTS drivers_all_authenticated ON drivers;
    CREATE POLICY drivers_all_authenticated
    ON drivers FOR SELECT USING (true)
  `, 'policy drivers_all');

  // Session cleanup
  await run(`DELETE FROM sessions WHERE expires_at < NOW()`, 'cleanup expired sessions');
  await run(`DELETE FROM sessions WHERE created_at < NOW() - INTERVAL '7 days'`, 'cleanup old sessions');

  // ANALYZE
  if (process.env.NODE_ENV !== 'production') {
    await run('ANALYZE', 'ANALYZE');
  }

  // Record that this version has been applied.  On next boot the fast-path
  // check above will skip the entire body and return in a single round-trip.
  await run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `, 'table schema_migrations');
  await pool.query(
    'INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING',
    [SCHEMA_VERSION],
  );

  console.log(`Schema initialized in ${Date.now() - t0}ms`);
}
