const db = require('../db/pool');

const DEFAULTS = {
  reservation_hold_minutes: '15',
  reservation_max_hours: '12',
  reservation_advance_days: '7',
};

async function getSettings(runner = db) {
  const { rows } = await runner.query('SELECT key, value FROM settings');
  const out = { ...DEFAULTS };
  for (const r of rows) out[r.key] = r.value;
  return {
    reservation_hold_minutes: Number(out.reservation_hold_minutes),
    reservation_max_hours: Number(out.reservation_max_hours),
    reservation_advance_days: Number(out.reservation_advance_days),
  };
}

async function setSetting(runner, key, value) {
  await runner.query(
    'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
    [key, String(value)]
  );
}

/** The rate rule active for a vehicle type at a given moment (FR-BIL-03). */
async function activeRateRule(runner, vehicleType) {
  const { rows } = await runner.query('SELECT * FROM rate_rules WHERE vehicle_type = $1 AND effective_to IS NULL', [vehicleType]);
  return rows[0] || null;
}

module.exports = { getSettings, setSetting, activeRateRule, DEFAULTS };
