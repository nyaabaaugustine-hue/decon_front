/**
 * Demo data seed script.
 *
 * Populates the database with a realistic fleet so the dashboard has something
 * meaningful to show (for demos, stakeholder review, etc.). Safe to re-run —
 * uses ON CONFLICT DO NOTHING with fixed IDs, so it won't duplicate rows.
 *
 * Usage:  npm run seed
 * (make sure `npm run server` has been run at least once already, or run this
 * after it, so the schema/tables exist — this script also calls
 * initializeSchema() itself first, so it's safe to run standalone too.)
 */
import { execute, closePool } from './db.js';
import { initializeSchema } from './schema.js';

async function seed() {
  console.log('Initializing schema...');
  await initializeSchema();

  console.log('Seeding supervisors...');
  const supervisors = [
    ['sup-1', 'Kwame Mensah', '+233 24 111 2222', 'Greater Accra'],
    ['sup-2', 'Ama Boateng', '+233 20 333 4444', 'Ashanti'],
    ['sup-3', 'Yaw Owusu', '+233 27 555 6666', 'Western'],
  ];
  for (const [id, fullName, phone, region] of supervisors) {
    await execute(
      `INSERT INTO supervisors (id, full_name, phone, region) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [id, fullName, phone, region]
    );
  }

  console.log('Seeding drivers...');
  const drivers = [
    ['drv-1', 'Kofi Asante', '+233 24 100 2001', 'B.123456', 'sup-1', '2022-03-15', 'active'],
    ['drv-2', 'Akosua Frimpong', '+233 24 100 2002', 'B.123457', 'sup-1', '2023-01-20', 'active'],
    ['drv-3', 'Ekow Danso', '+233 24 100 2003', 'B.123458', 'sup-2', '2021-06-10', 'active'],
    ['drv-4', 'Adwoa Nyarko', '+233 24 100 2004', 'B.123459', 'sup-2', '2023-09-05', 'active'],
    ['drv-5', 'Kwabena Tuffour', '+233 24 100 2005', 'B.123460', 'sup-3', '2022-11-30', 'active'],
    ['drv-6', 'Abena Sarpong', '+233 24 100 2006', 'B.123461', 'sup-3', '2024-02-14', 'on_leave'],
    ['drv-7', 'Kojo Antwi', '+233 24 100 2007', 'B.123462', 'sup-1', '2020-05-18', 'active'],
    ['drv-8', 'Efua Baah', '+233 24 100 2008', 'B.123463', 'sup-2', '2024-06-01', 'active'],
  ];
  for (const [id, fullName, phone, license, supervisorId, hireDate, status] of drivers) {
    await execute(
      `INSERT INTO drivers (id, full_name, phone, license_number, supervisor_id, hire_date, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
      [id, fullName, phone, license, supervisorId, hireDate, status]
    );
  }

  console.log('Seeding vehicles...');
  const vehicles = [
    ['veh-1', 'GR-2841-21', 'Toyota', 'Hilux', 2021, 'JTEBN14J1M0123456', '2021-05-10', 380000, 'active', 'drv-1'],
    ['veh-2', 'AS-5532-22', 'Isuzu', 'D-Max', 2022, 'JTEBN14J2M0123457', '2022-08-22', 420000, 'active', 'drv-3'],
    ['veh-3', 'WR-1198-20', 'Mitsubishi', 'L200', 2020, 'JTEBN14J3M0123458', '2020-03-15', 310000, 'in_repair', 'drv-4'],
    ['veh-4', 'GR-7765-23', 'Ford', 'Ranger', 2023, 'JTEBN14J4M0123459', '2023-11-01', 480000, 'active', 'drv-2'],
    ['veh-5', 'AS-3301-19', 'Nissan', 'Navara', 2019, 'JTEBN14J5M0123460', '2019-07-18', 290000, 'active', 'drv-5'],
    ['veh-6', 'WR-9023-24', 'Toyota', 'Land Cruiser', 2024, 'JTEBN14J6M0123461', '2024-01-20', 620000, 'active', 'drv-6'],
    ['veh-7', 'GR-4471-18', 'Toyota', 'Hiace', 2018, 'JTEBN14J7M0123462', '2018-09-12', 210000, 'decommissioned', null],
    ['veh-8', 'AS-6602-23', 'Isuzu', 'D-Max', 2023, 'JTEBN14J8M0123463', '2023-04-03', 435000, 'active', 'drv-7'],
    ['veh-9', 'GR-1029-17', 'Toyota', 'Hilux', 2017, 'JTEBN14J9M0123464', '2017-02-25', 260000, 'sold', null],
    ['veh-10', 'WR-8845-22', 'Ford', 'Ranger', 2022, 'JTEBN14J0M0123465', '2022-06-14', 455000, 'active', 'drv-8'],
  ];
  for (const [id, plate, make, model, year, vin, purchaseDate, price, status, driverId] of vehicles) {
    await execute(
      `INSERT INTO vehicles (id, plate_number, make, model, year, vin, purchase_date, purchase_price, status, current_driver_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (id) DO NOTHING`,
      [id, plate, make, model, year, vin, purchaseDate, price, status, driverId]
    );
  }

  console.log('Seeding vehicle documents...');
  const documents = [
    ['doc-1', 'veh-1', 'insurance_policy', 'hilux_insurance_2025.pdf', '2025-01-01', '2026-01-01', null],
    ['doc-2', 'veh-1', 'registration_certificate', 'hilux_registration.pdf', '2021-05-10', '2026-05-10', null],
    ['doc-3', 'veh-2', 'insurance_policy', 'dmax_insurance_2025.pdf', '2025-02-15', '2026-02-15', null],
    ['doc-4', 'veh-3', 'insurance_policy', 'l200_insurance_2024.pdf', '2024-03-01', '2025-08-15', 'Renewal overdue'],
    ['doc-5', 'veh-4', 'purchase_invoice', 'ranger_invoice.pdf', '2023-11-01', null, null],
    ['doc-6', 'veh-6', 'insurance_policy', 'landcruiser_insurance.pdf', '2025-06-01', '2026-06-01', null],
    ['doc-7', 'veh-8', 'registration_certificate', 'dmax2_registration.pdf', '2023-04-03', '2026-08-10', null],
  ];
  for (const [id, vehicleId, docType, fileName, issueDate, expiryDate, notes] of documents) {
    await execute(
      `INSERT INTO vehicle_documents (id, vehicle_id, doc_type, file_name, issue_date, expiry_date, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
      [id, vehicleId, docType, fileName, issueDate, expiryDate, notes]
    );
  }

  console.log('Seeding service logs...');
  const services = [
    ['svc-1', 'veh-1', '2025-04-10', 42000, 'Routine Service', 'Oil filter, air filter', 'AutoCare Accra', 850],
    ['svc-2', 'veh-2', '2025-05-22', 38500, 'Brake Service', 'Front brake pads', 'Kumasi Motors', 620],
    ['svc-3', 'veh-3', '2025-06-01', 61000, 'Engine Repair', 'Timing belt, water pump', 'Western Auto Works', 3200],
    ['svc-4', 'veh-4', '2025-06-18', 15200, 'Routine Service', 'Oil change', 'AutoCare Accra', 400],
    ['svc-5', 'veh-6', '2025-07-05', 8900, 'Routine Service', 'Oil filter, tyre rotation', 'AutoCare Accra', 700],
    ['svc-6', 'veh-8', '2025-05-30', 22000, 'Suspension', 'Front shocks', 'Kumasi Motors', 1450],
  ];
  for (const [id, vehicleId, date, mileage, type, parts, workshop, cost] of services) {
    await execute(
      `INSERT INTO service_logs (id, vehicle_id, service_date, mileage_km, service_type, parts_replaced, workshop, cost)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
      [id, vehicleId, date, mileage, type, parts, workshop, cost]
    );
  }

  console.log('Seeding battery logs...');
  const batteries = [
    ['bat-1', 'veh-1', '2023-05-10', null, 'Exide', 'Battery World Accra', 1200],
    ['bat-2', 'veh-2', '2022-08-22', '2024-09-01', 'Bosch', 'Kumasi Auto Parts', 1350],
    ['bat-3', 'veh-4', '2023-11-01', null, 'Exide', 'Battery World Accra', 1400],
  ];
  for (const [id, vehicleId, installDate, replacementDate, brand, supplier, cost] of batteries) {
    await execute(
      `INSERT INTO battery_logs (id, vehicle_id, install_date, replacement_date, brand, supplier, cost)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
      [id, vehicleId, installDate, replacementDate, brand, supplier, cost]
    );
  }

  console.log('Seeding tyre logs...');
  const tyres = [
    ['tyr-1', 'veh-1', 'FL', '2024-01-10', null, 'Michelin', 450],
    ['tyr-2', 'veh-1', 'FR', '2024-01-10', null, 'Michelin', 450],
    ['tyr-3', 'veh-2', 'RL', '2024-03-15', null, 'Bridgestone', 420],
    ['tyr-4', 'veh-2', 'RR', '2024-03-15', null, 'Bridgestone', 420],
    ['tyr-5', 'veh-6', 'SPARE', '2024-01-20', null, 'Michelin', 460],
  ];
  for (const [id, vehicleId, position, installDate, replacementDate, brand, cost] of tyres) {
    await execute(
      `INSERT INTO tyre_logs (id, vehicle_id, position, install_date, replacement_date, brand, cost)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
      [id, vehicleId, position, installDate, replacementDate, brand, cost]
    );
  }

  console.log('Seeding revenue entries...');
  const routes = [
    ['Accra - Tema', 'Ghana Ports Authority'],
    ['Accra - Kumasi', 'Melcom Ltd'],
    ['Kumasi - Takoradi', 'Unilever Ghana'],
    ['Accra - Cape Coast', 'Fan Milk PLC'],
    ['Tema - Aflao', 'Blue Skies'],
  ];
  let revIdx = 1;
  const revenueEntries: any[] = [];
  const vehicleDriverPairs = [
    ['veh-1', 'drv-1'], ['veh-2', 'drv-3'], ['veh-4', 'drv-2'],
    ['veh-5', 'drv-5'], ['veh-6', 'drv-6'], ['veh-8', 'drv-7'], ['veh-10', 'drv-8'],
  ];
  for (let month = 1; month <= 6; month++) {
    for (const [vehicleId, driverId] of vehicleDriverPairs) {
      const [route, client] = routes[revIdx % routes.length];
      const amount = 2500 + Math.round(Math.random() * 4000);
      const day = String(1 + (revIdx % 27)).padStart(2, '0');
      const tripDate = `2025-0${month}-${day}`;
      revenueEntries.push([
        `rev-${revIdx}`, vehicleId, driverId, tripDate,
        `TRP-2025-${String(revIdx).padStart(4, '0')}`, route, client, amount,
      ]);
      revIdx++;
    }
  }
  for (const [id, vehicleId, driverId, tripDate, tripRef, route, client, amount] of revenueEntries) {
    await execute(
      `INSERT INTO revenue_entries (id, vehicle_id, driver_id, trip_date, trip_reference, route, client, amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
      [id, vehicleId, driverId, tripDate, tripRef, route, client, amount]
    );
  }

  console.log('Seeding accident reports...');
  const accidents = [
    ['acc-1', 'veh-3', 'drv-4', '2025-05-28', 'Rear-end collision at Takoradi roundabout, minor bumper damage', 2100, true],
    ['acc-2', 'veh-9', null, '2024-11-12', 'Windscreen cracked by debris on Accra-Kumasi highway', 350, false],
  ];
  for (const [id, vehicleId, driverId, date, description, cost, atFault] of accidents) {
    await execute(
      `INSERT INTO accident_reports (id, vehicle_id, driver_id, accident_date, description, cost, driver_at_fault)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
      [id, vehicleId, driverId, date, description, cost, atFault]
    );
  }

  console.log('Seeding valuations...');
  const valuations = [
    ['val-1', 'veh-1', '2025-05-01', 'AutoTrader Ghana', 310000, 'Good condition, normal wear'],
    ['val-2', 'veh-6', '2025-06-15', 'Dealer Appraisal', 590000, 'Excellent condition, low mileage'],
    ['val-3', 'veh-7', '2025-01-10', 'AutoTrader Ghana', 95000, 'High mileage, decommissioned'],
  ];
  for (const [id, vehicleId, date, source, amount, notes] of valuations) {
    await execute(
      `INSERT INTO valuations (id, vehicle_id, valuation_date, source, amount, condition_notes)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
      [id, vehicleId, date, source, amount, notes]
    );
  }

  console.log('Seeding inspections...');
  const checklistPass = JSON.stringify([
    { item: 'Brakes', status: 'ok' }, { item: 'Lights', status: 'ok' },
    { item: 'Tyres', status: 'ok' }, { item: 'Fluids', status: 'ok' },
  ]);
  const checklistFlagged = JSON.stringify([
    { item: 'Brakes', status: 'ok' }, { item: 'Lights', status: 'ok' },
    { item: 'Tyres', status: 'flagged', note: 'Rear left tread wearing low' }, { item: 'Fluids', status: 'ok' },
  ]);
  const inspections = [
    ['insp-1', 'veh-1', 'Kofi Asante', '2025-07-01', 'pass', checklistPass, '', 2],
    ['insp-2', 'veh-2', 'Ekow Danso', '2025-07-03', 'pass', checklistPass, '', 1],
    ['insp-3', 'veh-3', 'Adwoa Nyarko', '2025-06-30', 'fail', checklistFlagged, 'Sent to workshop', 3],
    ['insp-4', 'veh-6', 'Abena Sarpong', '2025-07-10', 'flagged', checklistFlagged, 'Monitor tyre wear', 2],
  ];
  for (const [id, vehicleId, driverName, date, status, checklist, notes, photoCount] of inspections) {
    await execute(
      `INSERT INTO inspections (id, vehicle_id, driver_name, inspection_date, overall_status, checklist, notes, photo_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
      [id, vehicleId, driverName, date, status, checklist, notes, photoCount]
    );
  }

  console.log('\n✅ Demo data seeded successfully.');
  console.log(`   ${supervisors.length} supervisors, ${drivers.length} drivers, ${vehicles.length} vehicles`);
  console.log(`   ${documents.length} documents, ${services.length} service logs, ${revenueEntries.length} revenue entries`);
  console.log(`   ${accidents.length} accident reports, ${valuations.length} valuations, ${inspections.length} inspections`);

  await closePool();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
