const express = require('express');
const db = require('../db/pool');
const { validate, VEHICLE_TYPES } = require('../utils/validate');
const { ah, badRequest, notFound, conflict } = require('../utils/errors');
const { authenticate, requireRole } = require('../middleware/auth');
const { audit } = require('../services/audit');
const { SLOT_SELECT, setSlotStatus, emitAfter } = require('../services/slots');
const { emitLayoutChanged } = require('../realtime');

const router = express.Router();
router.use(authenticate);

const adminOnly = requireRole('admin');
const staff = requireRole('admin', 'operator');

// ---------- Facilities (FR-SLOT-01) ----------

router.get('/facilities', ah(async (req, res) => {
  const includeInactive = req.user.role === 'admin' && req.query.all === '1';
  const { rows } = await db.query(
    `SELECT f.*,
       (SELECT count(*) FROM slots s WHERE s.facility_id = f.id AND NOT s.is_deleted) AS slot_count,
       (SELECT count(*) FROM zones z WHERE z.facility_id = f.id AND NOT z.is_deleted) AS zone_count
     FROM facilities f ${includeInactive ? '' : 'WHERE f.is_active'} ORDER BY f.name`
  );
  res.json(rows);
}));

const facilitySchema = {
  name: { type: 'string', required: true, min: 2, max: 100 },
  address: { type: 'string', max: 200, default: '' },
  opening_hours: { type: 'string', max: 100, default: '24 hours', label: 'opening hours' },
};

router.post('/facilities', adminOnly, ah(async (req, res) => {
  const d = validate(req.body, facilitySchema);
  const { rows } = await db.query(
    'INSERT INTO facilities (name, address, opening_hours) VALUES ($1, $2, $3) RETURNING *',
    [d.name, d.address, d.opening_hours]
  );
  await audit(null, { userId: req.user.id, action: 'facility_create', target: `facility:${rows[0].id}`, details: d });
  res.status(201).json(rows[0]);
}));

router.put('/facilities/:id', adminOnly, ah(async (req, res) => {
  const d = validate(req.body, facilitySchema);
  const { rows } = await db.query(
    'UPDATE facilities SET name = $2, address = $3, opening_hours = $4 WHERE id = $1 RETURNING *',
    [req.params.id, d.name, d.address, d.opening_hours]
  );
  if (!rows[0]) throw notFound('Facility not found.');
  await audit(null, { userId: req.user.id, action: 'facility_update', target: `facility:${rows[0].id}`, details: d });
  res.json(rows[0]);
}));

router.patch('/facilities/:id/active', adminOnly, ah(async (req, res) => {
  const { is_active } = validate(req.body, { is_active: { type: 'bool', required: true } });
  if (!is_active) {
    const busy = await db.query(
      `SELECT (SELECT count(*) FROM parking_sessions WHERE facility_id = $1 AND status = 'open') AS sessions,
              (SELECT count(*) FROM reservations WHERE facility_id = $1 AND status IN ('booked','active')) AS reservations`,
      [req.params.id]
    );
    const b = busy.rows[0];
    if (b.sessions > 0 || b.reservations > 0) {
      throw conflict(`Cannot deactivate: ${b.sessions} vehicle(s) parked and ${b.reservations} reservation(s) pending. Wait until they exit or are cancelled.`);
    }
  }
  const { rows } = await db.query('UPDATE facilities SET is_active = $2 WHERE id = $1 RETURNING *', [req.params.id, is_active]);
  if (!rows[0]) throw notFound('Facility not found.');
  await audit(null, { userId: req.user.id, action: is_active ? 'facility_activate' : 'facility_deactivate', target: `facility:${rows[0].id}` });
  res.json(rows[0]);
}));

// ---------- Zones (FR-SLOT-02) ----------

router.get('/facilities/:id/zones', ah(async (req, res) => {
  const { rows } = await db.query(
    `SELECT z.*, (SELECT count(*) FROM slots s WHERE s.zone_id = z.id AND NOT s.is_deleted) AS slot_count
     FROM zones z WHERE z.facility_id = $1 AND NOT z.is_deleted ORDER BY z.sort_order, z.id`,
    [req.params.id]
  );
  res.json(rows);
}));

const zoneSchema = {
  label: { type: 'string', required: true, min: 1, max: 60 },
  sort_order: { type: 'int', min: 0, max: 999, default: 1, label: 'sort order' },
};

router.post('/facilities/:id/zones', adminOnly, ah(async (req, res) => {
  const d = validate(req.body, zoneSchema);
  const f = await db.query('SELECT id FROM facilities WHERE id = $1', [req.params.id]);
  if (!f.rows[0]) throw notFound('Facility not found.');
  const { rows } = await db.query(
    'INSERT INTO zones (facility_id, label, sort_order) VALUES ($1, $2, $3) RETURNING *',
    [req.params.id, d.label, d.sort_order]
  );
  await audit(null, { userId: req.user.id, action: 'zone_create', target: `zone:${rows[0].id}`, details: d });
  emitLayoutChanged(Number(req.params.id));
  res.status(201).json(rows[0]);
}));

router.put('/zones/:id', adminOnly, ah(async (req, res) => {
  const d = validate(req.body, zoneSchema);
  const { rows } = await db.query(
    'UPDATE zones SET label = $2, sort_order = $3 WHERE id = $1 AND NOT is_deleted RETURNING *',
    [req.params.id, d.label, d.sort_order]
  );
  if (!rows[0]) throw notFound('Zone not found.');
  await audit(null, { userId: req.user.id, action: 'zone_update', target: `zone:${rows[0].id}`, details: d });
  emitLayoutChanged(rows[0].facility_id);
  res.json(rows[0]);
}));

// FR-SLOT-08: refuse when any slot in the zone has an active session or reservation
router.delete('/zones/:id', adminOnly, ah(async (req, res) => {
  const result = await db.withTransaction(async (c) => {
    const z = (await c.query('SELECT * FROM zones WHERE id = $1 AND NOT is_deleted FOR UPDATE', [req.params.id])).rows[0];
    if (!z) throw notFound('Zone not found.');
    const busy = (await c.query(
      `SELECT (SELECT count(*) FROM parking_sessions p JOIN slots s ON s.id = p.slot_id WHERE s.zone_id = $1 AND p.status = 'open') AS sessions,
              (SELECT count(*) FROM reservations r JOIN slots s ON s.id = r.slot_id WHERE s.zone_id = $1 AND r.status IN ('booked','active')) AS reservations`,
      [z.id]
    )).rows[0];
    if (busy.sessions > 0 || busy.reservations > 0) {
      throw conflict(`Cannot delete zone "${z.label}": it has ${busy.sessions} parked vehicle(s) and ${busy.reservations} active reservation(s).`);
    }
    await c.query('UPDATE slots SET is_deleted = TRUE WHERE zone_id = $1', [z.id]);
    await c.query('UPDATE zones SET is_deleted = TRUE WHERE id = $1', [z.id]);
    await audit(c, { userId: req.user.id, action: 'zone_delete', target: `zone:${z.id}`, details: { label: z.label } });
    return z;
  });
  emitLayoutChanged(result.facility_id);
  res.json({ ok: true });
}));

// ---------- Slots (FR-SLOT-03..08) ----------

// Slot map for a facility: zones with their slots (FR-SLOT-05)
router.get('/facilities/:id/slots', ah(async (req, res) => {
  const params = [req.params.id];
  const where = ['s.facility_id = $1', 'NOT s.is_deleted', 'NOT z.is_deleted'];
  if (req.query.status) { params.push(req.query.status); where.push(`s.status = $${params.length}`); }
  if (req.query.vehicle_type) { params.push(req.query.vehicle_type); where.push(`s.vehicle_type = $${params.length}`); }
  const showPlates = req.user.role !== 'driver';
  const { rows } = await db.query(
    `SELECT s.id, s.zone_id, s.facility_id, s.code, s.sequence_no, s.vehicle_type, s.status, s.out_of_service_reason,
            z.label AS zone_label, z.sort_order AS zone_order
            ${showPlates ? `, p.id AS session_id, p.entry_time, v.plate_number` : ''}
     FROM slots s JOIN zones z ON z.id = s.zone_id
     ${showPlates ? `LEFT JOIN parking_sessions p ON p.slot_id = s.id AND p.status = 'open' LEFT JOIN vehicles v ON v.id = p.vehicle_id` : ''}
     WHERE ${where.join(' AND ')}
     ORDER BY z.sort_order, z.id, s.sequence_no, s.id`,
    params
  );
  res.json(rows);
}));

const slotTypeSpec = { type: 'string', required: true, enum: VEHICLE_TYPES, label: 'vehicle type' };

// individual or bulk creation, e.g. prefix "A-", from 1 to 40 -> A-01..A-40
router.post('/zones/:id/slots', adminOnly, ah(async (req, res) => {
  const zone = (await db.query('SELECT * FROM zones WHERE id = $1 AND NOT is_deleted', [req.params.id])).rows[0];
  if (!zone) throw notFound('Zone not found.');
  const bulk = req.body && req.body.mode === 'bulk';
  let codes;
  let vehicleType;
  if (bulk) {
    const d = validate(req.body, {
      prefix: { type: 'string', required: true, max: 10 },
      from: { type: 'int', required: true, min: 0, max: 9999 },
      to: { type: 'int', required: true, min: 0, max: 9999 },
      pad: { type: 'int', min: 1, max: 4, default: 2 },
      vehicle_type: slotTypeSpec,
    });
    if (d.to < d.from) throw badRequest('"To" must be greater than or equal to "From".');
    if (d.to - d.from >= 500) throw badRequest('Create at most 500 slots at a time.');
    codes = [];
    for (let i = d.from; i <= d.to; i++) codes.push(`${d.prefix}${String(i).padStart(d.pad, '0')}`.toUpperCase());
    vehicleType = d.vehicle_type;
  } else {
    const d = validate(req.body, { code: { type: 'string', required: true, max: 20 }, vehicle_type: slotTypeSpec });
    codes = [d.code.toUpperCase()];
    vehicleType = d.vehicle_type;
  }

  const created = await db.withTransaction(async (c) => {
    const existing = await c.query(
      'SELECT upper(code) AS code FROM slots WHERE facility_id = $1 AND NOT is_deleted AND upper(code) = ANY($2)',
      [zone.facility_id, codes]
    );
    if (existing.rows.length) {
      throw conflict(`Slot code${existing.rows.length > 1 ? 's' : ''} already used in this facility: ${existing.rows.slice(0, 8).map((r) => r.code).join(', ')}. Choose a different prefix or range.`);
    }
    const seqStart = (await c.query('SELECT COALESCE(max(sequence_no), 0) AS m FROM slots WHERE zone_id = $1 AND NOT is_deleted', [zone.id])).rows[0].m;
    const out = [];
    for (let i = 0; i < codes.length; i++) {
      const r = await c.query(
        'INSERT INTO slots (zone_id, facility_id, code, sequence_no, vehicle_type) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [zone.id, zone.facility_id, codes[i], seqStart + i + 1, vehicleType]
      );
      out.push(r.rows[0]);
    }
    await audit(c, { userId: req.user.id, action: 'slot_create', target: `zone:${zone.id}`, details: { codes: codes.length > 10 ? `${codes[0]}..${codes[codes.length - 1]}` : codes, count: codes.length, vehicle_type: vehicleType } });
    return out;
  });
  emitLayoutChanged(zone.facility_id);
  res.status(201).json(created);
}));

router.put('/slots/:id', adminOnly, ah(async (req, res) => {
  const d = validate(req.body, {
    code: { type: 'string', required: true, max: 20 },
    vehicle_type: slotTypeSpec,
    sequence_no: { type: 'int', min: 0, max: 99999, label: 'sequence number' },
  });
  const updated = await db.withTransaction(async (c) => {
    const slot = (await c.query('SELECT * FROM slots WHERE id = $1 AND NOT is_deleted FOR UPDATE', [req.params.id])).rows[0];
    if (!slot) throw notFound('Slot not found.');
    if (slot.vehicle_type !== d.vehicle_type && slot.status !== 'free' && slot.status !== 'out_of_service') {
      throw conflict(`Slot ${slot.code} is ${slot.status}; change its vehicle type only when it is free.`);
    }
    const dup = await c.query('SELECT 1 FROM slots WHERE facility_id = $1 AND upper(code) = upper($2) AND id <> $3 AND NOT is_deleted', [slot.facility_id, d.code, slot.id]);
    if (dup.rows.length) throw conflict(`Slot code ${d.code.toUpperCase()} is already used in this facility.`);
    const r = await c.query(
      'UPDATE slots SET code = $2, vehicle_type = $3, sequence_no = COALESCE($4, sequence_no) WHERE id = $1 RETURNING *',
      [slot.id, d.code.toUpperCase(), d.vehicle_type, d.sequence_no ?? null]
    );
    await audit(c, { userId: req.user.id, action: 'slot_update', target: `slot:${slot.id}`, details: { before: { code: slot.code, vehicle_type: slot.vehicle_type }, after: d } });
    return r.rows[0];
  });
  emitLayoutChanged(updated.facility_id);
  res.json(updated);
}));

// FR-SLOT-08
router.delete('/slots/:id', adminOnly, ah(async (req, res) => {
  const slot = await db.withTransaction(async (c) => {
    const s = (await c.query('SELECT * FROM slots WHERE id = $1 AND NOT is_deleted FOR UPDATE', [req.params.id])).rows[0];
    if (!s) throw notFound('Slot not found.');
    const busy = (await c.query(
      `SELECT (SELECT count(*) FROM parking_sessions WHERE slot_id = $1 AND status = 'open') AS sessions,
              (SELECT count(*) FROM reservations WHERE slot_id = $1 AND status IN ('booked','active')) AS reservations`,
      [s.id]
    )).rows[0];
    if (busy.sessions > 0) throw conflict(`Cannot delete slot ${s.code}: a vehicle is parked there. Process its exit first.`);
    if (busy.reservations > 0) throw conflict(`Cannot delete slot ${s.code}: it has an active reservation.`);
    await c.query('UPDATE slots SET is_deleted = TRUE WHERE id = $1', [s.id]);
    await audit(c, { userId: req.user.id, action: 'slot_delete', target: `slot:${s.id}`, details: { code: s.code } });
    return s;
  });
  emitLayoutChanged(slot.facility_id);
  res.json({ ok: true });
}));

// FR-SLOT-07: Free -> Out of Service (with reason) and back
router.patch('/slots/:id/service', staff, ah(async (req, res) => {
  const d = validate(req.body, {
    out_of_service: { type: 'bool', required: true },
    reason: { type: 'string', max: 200 },
  });
  const slot = await db.withTransaction(async (c) => {
    const s = (await c.query('SELECT * FROM slots WHERE id = $1 AND NOT is_deleted FOR UPDATE', [req.params.id])).rows[0];
    if (!s) throw notFound('Slot not found.');
    if (d.out_of_service) {
      if (s.status !== 'free') throw conflict(`Slot ${s.code} is ${s.status.replace(/_/g, ' ')}. Only a Free slot can be marked Out of Service.`);
      if (!d.reason) throw badRequest('Enter a reason for taking the slot out of service (e.g. "Pillar repair").');
      return setSlotStatus(c, s.id, 'out_of_service', { userId: req.user.id, reason: d.reason, cause: 'manual' });
    }
    if (s.status !== 'out_of_service') throw conflict(`Slot ${s.code} is not out of service.`);
    return setSlotStatus(c, s.id, 'free', { userId: req.user.id, cause: 'restored' });
  });
  emitAfter(slot);
  res.json(slot);
}));

// ---------- Live availability (FR-RES-01, FR-REP-01) ----------

router.get('/availability', ah(async (req, res) => {
  const { rows } = await db.query(
    `SELECT f.id AS facility_id, f.name AS facility_name, f.address, f.opening_hours, s.vehicle_type,
            count(*) FILTER (WHERE s.status = 'free') AS free,
            count(*) FILTER (WHERE s.status = 'occupied') AS occupied,
            count(*) FILTER (WHERE s.status = 'reserved') AS reserved,
            count(*) FILTER (WHERE s.status = 'out_of_service') AS out_of_service,
            count(*) AS total
     FROM facilities f
     JOIN slots s ON s.facility_id = f.id AND NOT s.is_deleted
     JOIN zones z ON z.id = s.zone_id AND NOT z.is_deleted
     WHERE f.is_active
     GROUP BY f.id, f.name, f.address, f.opening_hours, s.vehicle_type
     ORDER BY f.name, s.vehicle_type`
  );
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.facility_id)) {
      map.set(r.facility_id, { facility_id: r.facility_id, name: r.facility_name, address: r.address, opening_hours: r.opening_hours, types: {} });
    }
    map.get(r.facility_id).types[r.vehicle_type] = { free: r.free, occupied: r.occupied, reserved: r.reserved, out_of_service: r.out_of_service, total: r.total };
  }
  res.json([...map.values()]);
}));

// slot detail (used by the slot map modal)
router.get('/slots/:id', staff, ah(async (req, res) => {
  const { rows } = await db.query(`${SLOT_SELECT} WHERE s.id = $1`, [req.params.id]);
  if (!rows[0]) throw notFound('Slot not found.');
  const session = await db.query(
    `SELECT p.id, p.entry_time, p.ticket_code, v.plate_number FROM parking_sessions p JOIN vehicles v ON v.id = p.vehicle_id
     WHERE p.slot_id = $1 AND p.status = 'open'`,
    [req.params.id]
  );
  const reservation = await db.query(
    `SELECT r.id, r.start_time, r.end_time, r.status, v.plate_number FROM reservations r JOIN vehicles v ON v.id = r.vehicle_id
     WHERE r.slot_id = $1 AND r.status IN ('booked','active') ORDER BY r.start_time LIMIT 3`,
    [req.params.id]
  );
  res.json({ ...rows[0], session: session.rows[0] || null, reservations: reservation.rows });
}));

module.exports = router;
