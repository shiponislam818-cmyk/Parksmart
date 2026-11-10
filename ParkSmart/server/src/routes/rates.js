const express = require('express');
const db = require('../db/pool');
const { validate, VEHICLE_TYPES } = require('../utils/validate');
const { ah, badRequest } = require('../utils/errors');
const { authenticate, requireRole } = require('../middleware/auth');
const { audit } = require('../services/audit');
const { getSettings, setSetting } = require('../services/settings');

const router = express.Router();
router.use(authenticate);

// active rules are readable by every signed-in role (drivers see prices, operators see fees)
router.get('/rates', ah(async (req, res) => {
  const { rows } = await db.query('SELECT * FROM rate_rules WHERE effective_to IS NULL ORDER BY vehicle_type');
  res.json(rows);
}));

router.get('/rates/history', requireRole('admin'), ah(async (req, res) => {
  const { rows } = await db.query(
    `SELECT r.*, u.name AS created_by_name FROM rate_rules r LEFT JOIN users u ON u.id = r.created_by
     ORDER BY r.vehicle_type, r.effective_from DESC`
  );
  res.json(rows);
}));

// FR-BIL-01 / FR-BIL-03: changing a rate closes the old rule and opens a new one, so
// parked vehicles keep the rule that was in force at their entry.
router.put('/rates/:vehicleType', requireRole('admin'), ah(async (req, res) => {
  const vehicleType = req.params.vehicleType;
  if (!VEHICLE_TYPES.includes(vehicleType)) throw badRequest('Unknown vehicle type.');
  const d = validate(req.body, {
    first_hour: { type: 'number', required: true, min: 0, max: 100000, label: 'first-hour charge' },
    per_hour: { type: 'number', required: true, min: 0, max: 100000, label: 'per-hour charge' },
    daily_cap: { type: 'number', required: true, min: 0, max: 1000000, label: 'daily cap' },
    grace_minutes: { type: 'int', required: true, min: 0, max: 240, label: 'grace minutes' },
    lost_ticket_penalty: { type: 'number', required: true, min: 0, max: 100000, label: 'lost-ticket penalty' },
    monthly_pass_price: { type: 'number', required: true, min: 0, max: 1000000, label: 'monthly pass price' },
  });
  if (d.daily_cap > 0 && d.daily_cap < d.first_hour) throw badRequest('Daily cap cannot be lower than the first-hour charge.');
  const rule = await db.withTransaction(async (c) => {
    const old = (await c.query('SELECT * FROM rate_rules WHERE vehicle_type = $1 AND effective_to IS NULL FOR UPDATE', [vehicleType])).rows[0];
    if (old) await c.query('UPDATE rate_rules SET effective_to = now() WHERE id = $1', [old.id]);
    const r = await c.query(
      `INSERT INTO rate_rules (vehicle_type, first_hour, per_hour, daily_cap, grace_minutes, lost_ticket_penalty, monthly_pass_price, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [vehicleType, d.first_hour, d.per_hour, d.daily_cap, d.grace_minutes, d.lost_ticket_penalty, d.monthly_pass_price, req.user.id]
    );
    const pick = (x) => x && { first_hour: x.first_hour, per_hour: x.per_hour, daily_cap: x.daily_cap, grace_minutes: x.grace_minutes, lost_ticket_penalty: x.lost_ticket_penalty, monthly_pass_price: x.monthly_pass_price };
    await audit(c, { userId: req.user.id, action: 'rate_change', target: `rate:${vehicleType}`, details: { before: pick(old), after: d } });
    return r.rows[0];
  });
  res.json(rule);
}));

router.get('/settings', ah(async (req, res) => {
  res.json(await getSettings());
}));

router.put('/settings', requireRole('admin'), ah(async (req, res) => {
  const d = validate(req.body, {
    reservation_hold_minutes: { type: 'int', required: true, min: 5, max: 120, label: 'reservation hold minutes' },
    reservation_max_hours: { type: 'int', required: true, min: 1, max: 72, label: 'maximum reservation window (hours)' },
    reservation_advance_days: { type: 'int', required: true, min: 1, max: 60, label: 'booking horizon (days)' },
  });
  const before = await getSettings();
  await db.withTransaction(async (c) => {
    for (const [k, v] of Object.entries(d)) await setSetting(c, k, v);
    await audit(c, { userId: req.user.id, action: 'settings_change', target: 'settings', details: { before, after: d } });
  });
  res.json(await getSettings());
}));

module.exports = router;
