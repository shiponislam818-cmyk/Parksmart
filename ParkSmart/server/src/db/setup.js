/**
 * Creates the database (if missing), applies schema.sql and seeds starter data.
 *   npm run db:setup         -> safe to re-run; seeds only an empty database
 *   npm run db:reset         -> DROPS all ParkSmart tables first (development only)
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const bcrypt = require('bcryptjs');
const config = require('../config');

const reset = process.argv.includes('--reset');

async function ensureDatabase() {
  const url = new URL(config.databaseUrl);
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const adminUrl = new URL(config.databaseUrl);
  adminUrl.pathname = '/postgres';
  const admin = new Client({ connectionString: adminUrl.toString() });
  try {
    await admin.connect();
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (!exists.rows.length) {
      await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, '')}"`);
      console.log(`Created database ${dbName}`);
    }
  } catch (e) {
    console.warn(`(Could not check/create database "${dbName}" automatically: ${e.message}. Assuming it exists.)`);
  } finally {
    await admin.end().catch(() => {});
  }
}

async function seed(c) {
  const hash = (p) => bcrypt.hashSync(p, config.bcryptCost);
  const users = [
    ['System Administrator', '01700000001', 'admin@parksmart.local', 'admin', 'Admin@1234'],
    ['Rahim Uddin', '01700000002', 'operator@parksmart.local', 'operator', 'Operator@1234'],
    ['Karim Ahmed', '01700000003', 'driver@parksmart.local', 'driver', 'Driver@1234'],
  ];
  const ids = {};
  for (const [name, phone, email, role, pw] of users) {
    const r = await c.query(
      'INSERT INTO users (name, phone, email, role, password_hash) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [name, phone, email, role, hash(pw)]
    );
    ids[role] = r.rows[0].id;
  }

  // sample rates (OI-1 — replace with the agreed values under Admin > Rates)
  const rates = [
    ['car', 30, 20, 300, 10, 200, 3000],
    ['motorcycle', 10, 5, 80, 10, 100, 800],
    ['microbus', 50, 30, 500, 10, 300, 4500],
  ];
  for (const r of rates) {
    await c.query(
      `INSERT INTO rate_rules (vehicle_type, first_hour, per_hour, daily_cap, grace_minutes, lost_ticket_penalty, monthly_pass_price, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [...r, ids.admin]
    );
  }

  const facilities = [
    {
      name: 'City Centre Mall', address: 'Zindabazar, Sylhet', hours: '8:00 AM – 11:00 PM',
      zones: [
        { label: 'Level 1', order: 1, groups: [['A-', 1, 20, 'car']] },
        { label: 'Level 2', order: 2, groups: [['B-', 1, 20, 'car'], ['C-', 1, 6, 'microbus']] },
        { label: 'Basement (Motorcycle)', order: 3, groups: [['M-', 1, 30, 'motorcycle']] },
      ],
    },
    {
      name: 'Amberkhana Plaza', address: 'Amberkhana, Sylhet', hours: '24 hours',
      zones: [
        { label: 'Ground Floor', order: 1, groups: [['G-', 1, 12, 'car'], ['GM-', 1, 15, 'motorcycle']] },
        { label: 'Roof Deck', order: 2, groups: [['R-', 1, 8, 'car'], ['RB-', 1, 4, 'microbus']] },
      ],
    },
  ];
  for (const f of facilities) {
    const fr = await c.query('INSERT INTO facilities (name, address, opening_hours) VALUES ($1, $2, $3) RETURNING id', [f.name, f.address, f.hours]);
    for (const z of f.zones) {
      const zr = await c.query('INSERT INTO zones (facility_id, label, sort_order) VALUES ($1, $2, $3) RETURNING id', [fr.rows[0].id, z.label, z.order]);
      let seq = 0;
      for (const [prefix, from, to, type] of z.groups) {
        for (let i = from; i <= to; i++) {
          seq += 1;
          await c.query(
            'INSERT INTO slots (zone_id, facility_id, code, sequence_no, vehicle_type) VALUES ($1, $2, $3, $4, $5)',
            [zr.rows[0].id, fr.rows[0].id, `${prefix}${String(i).padStart(2, '0')}`, seq, type]
          );
        }
      }
    }
  }

  await c.query(
    `INSERT INTO settings (key, value) VALUES ('reservation_hold_minutes', '15'), ('reservation_max_hours', '12'), ('reservation_advance_days', '7')
     ON CONFLICT (key) DO NOTHING`
  );
  // the sample driver's registered car
  await c.query(
    `INSERT INTO vehicles (plate_number, plate_normalised, type, owner_id) VALUES ('SYLHET METRO-GA 11-2345', 'SYLHETMETROGA112345', 'car', $1)`,
    [ids.driver]
  );
  await c.query(`INSERT INTO audit_log (user_id, action, target) VALUES ($1, 'system_seed', 'database')`, [ids.admin]);
}

async function main() {
  await ensureDatabase();
  const c = new Client({ connectionString: config.databaseUrl });
  await c.connect();
  try {
    if (reset) {
      console.log('Dropping existing ParkSmart tables...');
      await c.query(`DROP TABLE IF EXISTS audit_log, payments, parking_sessions, reservations, monthly_passes, rate_rules, vehicles, slots, zones, facilities, users, settings CASCADE;
                     DROP SEQUENCE IF EXISTS receipt_seq; DROP FUNCTION IF EXISTS audit_log_immutable CASCADE;`);
    }
    await c.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    console.log('Schema applied.');
    const n = (await c.query('SELECT count(*)::int AS n FROM users')).rows[0].n;
    if (n === 0) {
      await c.query('BEGIN');
      await seed(c);
      await c.query('COMMIT');
      console.log('Seed data inserted:');
      console.log('  Administrator  admin@parksmart.local     / Admin@1234');
      console.log('  Gate Operator  operator@parksmart.local  / Operator@1234');
      console.log('  Driver         driver@parksmart.local    / Driver@1234');
    } else {
      console.log(`Database already has ${n} user(s); seed skipped.`);
    }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('Database setup failed:', e.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

main();
