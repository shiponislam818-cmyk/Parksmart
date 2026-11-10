const express = require('express');
const db = require('../db/pool');
const { validate, VEHICLE_TYPES, VEHICLE_LABELS } = require('../utils/validate');
const { ah, badRequest, notFound, conflict } = require('../utils/errors');
const { authenticate, requireRole } = require('../middleware/auth');
const { audit } = require('../services/audit');
const { displayPlate, plateKey, isValidPlate } = require('../utils/plate');
const { getSettings, activeRateRule } = require('../services/settings');
const { setSlotStatus, emitAfter } = require('../services/slots');
const { activateReservation } = require('../services/scheduler');
const { TODAY_DHAKA } = require('../services/billing');
const { dateOnly } = require('../utils/format');

const router = express.Router();
router.use(authenticate, requireRole('driver'));

// ---------- Vehicles ----------
router.get('/vehicles', ah(async (req, res) => {
  const { rows } = await db.query('SELECT * FROM vehicles WHERE owner_id = $1 ORDER BY created_at', [req.user.id]);
  res.json(rows);
}));

router.post('/vehicles', ah(async (req, res) => {
  const d = validate(req.body, {
    plate: { type: 'string', required: true, max: 60, label: 'number plate' },
    type: { type: 'string', required: true, enum: VEHICLE_TYPES, label: 'vehicle type' },
  });
  if (!isValidPlate(d.plate)) throw badRequest('Enter a valid number plate, e.g. "Sylhet Metro-Ga 11-2345".');
  const key = plateKey(d.plate);
  const count = (await db.query('SELECT count(*) AS n FROM vehicles WHERE owner_id = $1', [req.user.id])).rows[0].n;
  if (count >= 10) throw badRequest('You can register at most 10 vehicles.');
  const vehicle = await db.withTransaction(async (c) => {
    const ex = (await c.query('SELECT * FROM vehicles WHERE plate_normalised = $1 FOR UPDATE', [key])).rows[0];
    if (ex && ex.owner_id === req.user.id) throw conflict('This vehicle is already in your list.');
    if (ex && ex.owner_id) throw conflict('This plate is registered to another account. Contact the parking office if it is yours.');
    let v;
    if (ex) {
      v = (await c.query('UPDATE vehicles SET owner_id = $2, type = $3, plate_number = $4 WHERE id = $1 RETURNING *', [ex.id, req.user.id, d.type, displayPlate(d.plate)])).rows[0];
    } else {
      v = (await c.query('INSERT INTO vehicles (plate_number, plate_normalised, type, owner_id) VALUES ($1, $2, $3, $4) RETURNING *', [displayPlate(d.plate), key, d.type, req.user.id])).rows[0];
    }
    await audit(c, { userId: req.user.id, action: 'vehicle_register', target: `vehicle:${v.id}`, details: { plate: v.plate_number, type: v.type } });
    return v;
  });
  res.status(201).json(vehicle);
}));

router.delete('/vehicles/:id', ah(async (req, res) => {
  const v = (await db.query('SELECT * FROM vehicles WHERE id = $1 AND owner_id = $2', [req.params.id, req.user.id])).rows[0];
  if (!v) throw notFound('Vehicle not found.');
  const busy = (await db.query(
    `SELECT (SELECT count(*) FROM reservations WHERE vehicle_id = $1 AND status IN ('booked','active')) AS r,
            (SELECT count(*) FROM monthly_passes WHERE vehicle_id = $1 AND status IN ('active','pending') AND end_date >= ${TODAY_DHAKA}) AS p`,
    [v.id]
  )).rows[0];
  if (busy.r > 0 || busy.p > 0) throw conflict('This vehicle has an upcoming reservation or a valid pass. Cancel the reservation or wait for the pass to end first.');
  await db.query('UPDATE vehicles SET owner_id = NULL WHERE id = $1', [v.id]);
  await audit(null, { userId: req.user.id, action: 'vehicle_remove', target: `vehicle:${v.id}` });
  res.json({ ok: true });
}));

// ---------- Reservations (FR-RES-02..05) ----------
const RES_SELECT = `
  SELECT r.*, v.plate_number, v.type AS vehicle_type, s.code AS slot_code, z.label AS zone_label, f.name AS facility_name
  FROM reservations r JOIN vehicles v ON v.id = r.vehicle_id JOIN slots s ON s.id = r.slot_id
  JOIN zones z ON z.id = s.zone_id JOIN facilities f ON f.id = r.facility_id`;

router.get('/reservations', ah(async (req, res) => {
  const { rows } = await db.query(`${RES_SELECT} WHERE r.user_id = $1 ORDER BY r.start_time DESC LIMIT 100`, [req.user.id]);
  res.json(rows);
}));

router.post('/reservations', ah(async (req, res) => {
  const d = validate(req.body, {
    vehicle_id: { type: 'int', required: true, label: 'vehicle' },
    facility_id: { type: 'int', required: true, label: 'facility' },
    start_time: { type: 'date', required: true, label: 'start time' },
    end_time: { type: 'date', required: true, label: 'end time' },
  });
  const st = await getSettings();
  const now = Date.now();
  if (d.start_time.getTime() < now - 60 * 1000) throw badRequest('Start time is in the past. Choose a time from now onwards.');
  if (d.start_time.getTime() > now + st.reservation_advance_days * 86400000) throw badRequest(`You can book at most ${st.reservation_advance_days} days ahead.`);
  if (d.end_time <= d.start_time) throw badRequest('End time must be after the start time.');
  if (d.end_time - d.start_time > st.reservation_max_hours * 3600000) throw badRequest(`A reservation can be at most ${st.reservation_max_hours} hours long.`);

  const vehicle = (await db.query('SELECT * FROM vehicles WHERE id = $1 AND owner_id = $2', [d.vehicle_id, req.user.id])).rows[0];
  if (!vehicle) throw badRequest('Choose one of your registered vehicles (add it under My vehicles first).');
  const fac = (await db.query('SELECT * FROM facilities WHERE id = $1 AND is_active', [d.facility_id])).rows[0];
  if (!fac) throw badRequest('This facility is not available for booking.');

  const clash = (await db.query(
    `SELECT 1 FROM reservations WHERE vehicle_id = $1 AND status IN ('booked','active') AND start_time < $3 AND end_time > $2`,
    [vehicle.id, d.start_time, d.end_time]
  )).rows[0];
  if (clash) throw conflict('This vehicle already has a reservation overlapping that time. Cancel it or pick another time.');

  const result = await db.withTransaction(async (c) => {
    const startsNow = d.start_time.getTime() <= now;
    const slot = (await c.query(
      `SELECT s.* FROM slots s JOIN zones z ON z.id = s.zone_id
       WHERE s.facility_id = $1 AND s.vehicle_type = $2 AND NOT s.is_deleted AND NOT z.is_deleted
         AND ${startsNow ? `s.status = 'free'` : `s.status <> 'out_of_service'`}
         AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.slot_id = s.id AND r.status IN ('booked','active')
                         AND r.start_time < $4 AND r.end_time > $3)
       ORDER BY z.sort_order, z.id, s.sequence_no, s.id LIMIT 1 FOR UPDATE OF s SKIP LOCKED`,
      [d.facility_id, vehicle.type, d.start_time, d.end_time]
    )).rows[0];
    if (!slot) throw conflict(`No ${VEHICLE_LABELS[vehicle.type]} slot is free for that time at ${fac.name}. Try another time or facility.`);
    const r = (await c.query(
      `INSERT INTO reservations (user_id, vehicle_id, facility_id, slot_id, start_time, end_time, hold_minutes)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.user.id, vehicle.id, d.facility_id, slot.id, d.start_time, d.end_time, st.reservation_hold_minutes]
    )).rows[0];
    await audit(c, { userId: req.user.id, action: 'reservation_create', target: `reservation:${r.id}`, details: { plate: vehicle.plate_number, slot: slot.code, start: d.start_time, end: d.end_time } });
    const changed = startsNow ? await activateReservation(c, r) : [];
    return { id: r.id, changed };
  });
  emitAfter(result.changed);
  const { rows } = await db.query(`${RES_SELECT} WHERE r.id = $1`, [result.id]);
  res.status(201).json(rows[0]);
}));

router.post('/reservations/:id/cancel', ah(async (req, res) => {
  const out = await db.withTransaction(async (c) => {
    const r = (await c.query('SELECT * FROM reservations WHERE id = $1 AND user_id = $2 FOR UPDATE', [req.params.id, req.user.id])).rows[0];
    if (!r) throw notFound('Reservation not found.');
    if (!['booked', 'active'].includes(r.status)) throw conflict(`This reservation is already ${r.status}.`);
    await c.query(`UPDATE reservations SET status = 'cancelled' WHERE id = $1`, [r.id]);
    await audit(c, { userId: req.user.id, action: 'reservation_cancel', target: `reservation:${r.id}` });
    if (r.status === 'active') {
      const s = (await c.query('SELECT * FROM slots WHERE id = $1 FOR UPDATE', [r.slot_id])).rows[0];
      if (s.status === 'reserved') return [await setSlotStatus(c, s.id, 'free', { userId: req.user.id, cause: `reservation_cancelled:${r.id}` })];
    }
    return [];
  });
  emitAfter(out);
  res.json({ ok: true });
}));

// ---------- Monthly passes (FR-RES-06, 07) ----------
router.get('/passes', ah(async (req, res) => {
  const { rows } = await db.query(
    `SELECT mp.*, v.plate_number, v.type AS vehicle_type, f.name AS facility_name,
            (mp.end_date - ${TODAY_DHAKA}) AS days_left,
            (SELECT pay.id FROM payments pay WHERE pay.pass_id = mp.id AND pay.status = 'paid' LIMIT 1) AS payment_id,
            (SELECT pay.id FROM payments pay WHERE pay.pass_id = mp.id AND pay.status = 'pending' LIMIT 1) AS pending_payment_id,
            EXISTS (SELECT 1 FROM monthly_passes n WHERE n.vehicle_id = mp.vehicle_id AND n.facility_id = mp.facility_id
                    AND n.status = 'active' AND n.start_date > mp.end_date) AS renewed
     FROM monthly_passes mp JOIN vehicles v ON v.id = mp.vehicle_id JOIN facilities f ON f.id = mp.facility_id
     WHERE mp.user_id = $1 ORDER BY mp.created_at DESC`,
    [req.user.id]
  );
  res.json(rows.map((p) => ({ ...p, renewal_due: p.status === 'active' && p.days_left <= 3 && !p.renewed })));
}));

async function createPass(userId, vehicleId, facilityId) {
  const vehicle = (await db.query('SELECT * FROM vehicles WHERE id = $1 AND owner_id = $2', [vehicleId, userId])).rows[0];
  if (!vehicle) throw badRequest('Choose one of your registered vehicles.');
  const fac = (await db.query('SELECT * FROM facilities WHERE id = $1 AND is_active', [facilityId])).rows[0];
  if (!fac) throw badRequest('This facility is not available.');
  const rule = await activeRateRule(db, vehicle.type);
  if (!rule || !(rule.monthly_pass_price > 0)) throw conflict(`Monthly passes are not on sale for ${VEHICLE_LABELS[vehicle.type]} yet.`);

  return db.withTransaction(async (c) => {
    await c.query('SELECT id FROM vehicles WHERE id = $1 FOR UPDATE', [vehicle.id]);
    // abandon earlier unpaid attempts for the same vehicle/facility
    const stale = (await c.query(
      `UPDATE monthly_passes SET status = 'cancelled' WHERE vehicle_id = $1 AND facility_id = $2 AND status = 'pending' RETURNING id`,
      [vehicle.id, fac.id]
    )).rows.map((r) => r.id);
    if (stale.length) await c.query(`UPDATE payments SET status = 'failed' WHERE status = 'pending' AND pass_id = ANY($1)`, [stale]);
    const latest = (await c.query(
      `SELECT max(end_date) AS end_date FROM monthly_passes WHERE vehicle_id = $1 AND facility_id = $2 AND status = 'active' AND end_date >= ${TODAY_DHAKA}`,
      [vehicle.id, fac.id]
    )).rows[0].end_date;
    // a renewal starts the day after the current pass ends; at most one month ahead is allowed
    const pass = (await c.query(
      `WITH s AS (SELECT COALESCE($4::date + 1, ${TODAY_DHAKA}) AS d)
       INSERT INTO monthly_passes (user_id, vehicle_id, facility_id, start_date, end_date, price)
       SELECT $1, $2, $3, s.d, (s.d + interval '1 month' - interval '1 day')::date, $5 FROM s RETURNING *`,
      [userId, vehicle.id, fac.id, latest, rule.monthly_pass_price]
    )).rows[0];
    const ahead = (await c.query(`SELECT ($1::date - ${TODAY_DHAKA}) AS d`, [pass.start_date])).rows[0].d;
    if (ahead > 7) throw conflict(`This pass is valid until ${dateOnly(latest)}. You can renew from 7 days before it ends.`);
    const payment = (await c.query(
      `INSERT INTO payments (pass_id, amount, base_fee, method, status) VALUES ($1, $2, $2, 'online', 'pending') RETURNING *`,
      [pass.id, pass.price]
    )).rows[0];
    await audit(c, { userId, action: latest ? 'pass_renew_started' : 'pass_purchase_started', target: `pass:${pass.id}`, details: { plate: vehicle.plate_number, facility: fac.name, price: pass.price, start: pass.start_date, end: pass.end_date } });
    return { pass, payment, gateway_url: `/pay/${payment.id}` };
  });
}

router.post('/passes', ah(async (req, res) => {
  const d = validate(req.body, {
    vehicle_id: { type: 'int', required: true, label: 'vehicle' },
    facility_id: { type: 'int', required: true, label: 'facility' },
  });
  res.status(201).json(await createPass(req.user.id, d.vehicle_id, d.facility_id));
}));

router.post('/passes/:id/renew', ah(async (req, res) => {
  const p = (await db.query('SELECT * FROM monthly_passes WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id])).rows[0];
  if (!p) throw notFound('Pass not found.');
  res.status(201).json(await createPass(req.user.id, p.vehicle_id, p.facility_id));
}));

// ---------- History & receipts (FR-RES-08) ----------
router.get('/history', ah(async (req, res) => {
  const sessions = (await db.query(
    `SELECT p.id, p.entry_time, p.exit_time, p.status, p.fee, p.is_lost_ticket, p.vehicle_type, v.plate_number,
            s.code AS slot_code, z.label AS zone_label, f.name AS facility_name,
            (SELECT pay.id FROM payments pay WHERE pay.session_id = p.id AND pay.status = 'paid' LIMIT 1) AS payment_id,
            (SELECT pay.receipt_no FROM payments pay WHERE pay.session_id = p.id AND pay.status = 'paid' LIMIT 1) AS receipt_no,
            (SELECT pay.method FROM payments pay WHERE pay.session_id = p.id AND pay.status = 'paid' LIMIT 1) AS method
     FROM parking_sessions p JOIN vehicles v ON v.id = p.vehicle_id JOIN slots s ON s.id = p.slot_id
     JOIN zones z ON z.id = s.zone_id JOIN facilities f ON f.id = p.facility_id
     WHERE v.owner_id = $1 ORDER BY p.entry_time DESC LIMIT 200`,
    [req.user.id]
  )).rows;
  const passPayments = (await db.query(
    `SELECT pay.id AS payment_id, pay.receipt_no, pay.amount, pay.paid_at, mp.start_date, mp.end_date, v.plate_number, f.name AS facility_name
     FROM payments pay JOIN monthly_passes mp ON mp.id = pay.pass_id JOIN vehicles v ON v.id = mp.vehicle_id JOIN facilities f ON f.id = mp.facility_id
     WHERE mp.user_id = $1 AND pay.status = 'paid' ORDER BY pay.paid_at DESC`,
    [req.user.id]
  )).rows;
  res.json({ sessions, pass_payments: passPayments });
}));

module.exports = router;
