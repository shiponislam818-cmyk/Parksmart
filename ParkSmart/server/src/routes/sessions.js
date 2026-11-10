const express = require('express');
const QRCode = require('qrcode');
const db = require('../db/pool');
const config = require('../config');
const { validate, VEHICLE_TYPES, VEHICLE_LABELS } = require('../utils/validate');
const { ah, badRequest, notFound, conflict, forbidden } = require('../utils/errors');
const { authenticate, requireRole } = require('../middleware/auth');
const { audit } = require('../services/audit');
const { displayPlate, plateKey, isValidPlate } = require('../utils/plate');
const { generateTicketCode, normaliseTicketInput } = require('../utils/ticketCode');
const { activeRateRule } = require('../services/settings');
const { lockNearestFreeSlot, suggestSlot, setSlotStatus, emitAfter } = require('../services/slots');
const { SESSION_SELECT, quoteSession, settleSessionPayment } = require('../services/billing');

const router = express.Router();
router.use(authenticate, requireRole('admin', 'operator'));

function guestUrl(code) {
  return `${config.clientUrl.replace(/\/$/, '')}/t/${encodeURIComponent(code)}`;
}

async function ticketPayload(sessionId) {
  const s = (await db.query(`${SESSION_SELECT} WHERE p.id = $1`, [sessionId])).rows[0];
  if (!s) return null;
  const url = guestUrl(s.ticket_code);
  // QR encodes only the guest-page URL (which contains the ticket code) — no personal data.
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 320, errorCorrectionLevel: 'M' });
  return {
    session_id: s.id, ticket_code: s.ticket_code, plate: s.plate_number, vehicle_type: s.vehicle_type,
    vehicle_label: VEHICLE_LABELS[s.vehicle_type], facility: s.facility_name, zone: s.zone_label, slot: s.slot_code,
    slot_id: s.slot_id, entry_time: s.entry_time, operator: s.operator_name, status: s.status, guest_url: url, qr,
  };
}

// suggested slot for the entry panel (FR-ENT-04 preview)
router.get('/suggest', ah(async (req, res) => {
  const d = validate(req.query, {
    facility_id: { type: 'int', required: true, label: 'facility' },
    vehicle_type: { type: 'string', required: true, enum: VEHICLE_TYPES, label: 'vehicle type' },
  });
  const slot = await suggestSlot(d.facility_id, d.vehicle_type);
  res.json({ slot });
}));

// ---------- Entry (UC-01, FR-ENT-01..10) ----------
router.post('/', ah(async (req, res) => {
  const d = validate(req.body, {
    facility_id: { type: 'int', required: true, label: 'facility' },
    plate: { type: 'string', required: true, max: 60, label: 'number plate' },
    vehicle_type: { type: 'string', required: true, enum: VEHICLE_TYPES, label: 'vehicle type' },
    slot_id: { type: 'int', label: 'slot' },
    client_request_id: { type: 'string', max: 80 },
  });
  if (!isValidPlate(d.plate)) throw badRequest('Enter a valid number plate, e.g. "Sylhet Metro-Ga 11-2345".');

  // NFR-REL-03: a retried request (same client_request_id) returns the original ticket instead of a duplicate
  if (d.client_request_id) {
    const prev = await db.query('SELECT id FROM parking_sessions WHERE client_request_id = $1', [d.client_request_id]);
    if (prev.rows[0]) return res.status(200).json({ ...(await ticketPayload(prev.rows[0].id)), replayed: true });
  }

  const plate = displayPlate(d.plate);
  const key = plateKey(d.plate);

  let result;
  try {
    result = await db.withTransaction(async (c) => {
      const fac = (await c.query('SELECT * FROM facilities WHERE id = $1', [d.facility_id])).rows[0];
      if (!fac || !fac.is_active) throw badRequest('This facility is not active. Choose another facility at the top of the gate screen.');

      const rule = await activeRateRule(c, d.vehicle_type);
      if (!rule) throw conflict(`No rate is set for ${VEHICLE_LABELS[d.vehicle_type]}. Ask an administrator to set one under Rates.`);

      // upsert the vehicle (plates are compared by their normalised key)
      const v = (await c.query(
        `INSERT INTO vehicles (plate_number, plate_normalised, type) VALUES ($1, $2, $3)
         ON CONFLICT (plate_normalised) DO UPDATE SET plate_normalised = EXCLUDED.plate_normalised
         RETURNING *`,
        [plate, key, d.vehicle_type]
      )).rows[0];
      await c.query('SELECT id FROM vehicles WHERE id = $1 FOR UPDATE', [v.id]);
      if (!v.owner_id && v.type !== d.vehicle_type) await c.query('UPDATE vehicles SET type = $2 WHERE id = $1', [v.id, d.vehicle_type]);

      // FR-ENT-03: already parked anywhere?
      const open = (await c.query(
        `SELECT s.code, z.label AS zone, f.name AS facility FROM parking_sessions p
         JOIN slots s ON s.id = p.slot_id JOIN zones z ON z.id = s.zone_id JOIN facilities f ON f.id = p.facility_id
         WHERE p.vehicle_id = $1 AND p.status = 'open'`,
        [v.id]
      )).rows[0];
      if (open) {
        throw conflict(`Plate already parked at ${open.facility}, ${open.zone}, slot ${open.code}. Process its exit (or lost ticket) before a new entry.`, { location: open });
      }

      let slot = null;
      let reservation = null;

      // FR-ENT-06: valid reservation for now -> its slot
      const resv = (await c.query(
        `SELECT r.* FROM reservations r
         WHERE r.vehicle_id = $1 AND r.facility_id = $2
           AND (r.status = 'active' OR (r.status = 'booked' AND now() >= r.start_time - interval '15 minutes'))
           AND now() < r.start_time + make_interval(mins => r.hold_minutes)
         ORDER BY r.start_time LIMIT 1 FOR UPDATE`,
        [v.id, d.facility_id]
      )).rows[0];
      if (resv && !d.slot_id) {
        const rs = (await c.query('SELECT * FROM slots WHERE id = $1 FOR UPDATE', [resv.slot_id])).rows[0];
        const usable = rs && !rs.is_deleted && rs.vehicle_type === d.vehicle_type &&
          (rs.status === 'free' || (rs.status === 'reserved' && resv.status === 'active'));
        if (usable) {
          slot = rs;
          reservation = resv;
        }
      }

      if (!slot && d.slot_id) {
        // FR-ENT-05: operator override with another Free slot of the matching type
        const os = (await c.query('SELECT * FROM slots WHERE id = $1 AND NOT is_deleted FOR UPDATE', [d.slot_id])).rows[0];
        if (!os || os.facility_id !== d.facility_id) throw badRequest('The chosen slot is not in this facility. Pick a slot from the list.');
        if (os.vehicle_type !== d.vehicle_type) throw conflict(`Slot ${os.code} is for ${VEHICLE_LABELS[os.vehicle_type]}, not ${VEHICLE_LABELS[d.vehicle_type]}. Pick a matching slot.`);
        if (os.status !== 'free') throw conflict(`Slot ${os.code} was just taken (${os.status.replace(/_/g, ' ')}). Pick another free slot.`);
        slot = os;
      }

      if (!slot) slot = await lockNearestFreeSlot(c, d.facility_id, d.vehicle_type);
      // FR-ENT-07
      if (!slot) throw conflict(`Facility full for ${VEHICLE_LABELS[d.vehicle_type]}. Direct the driver to another facility.`, { full: true });

      const ticket = generateTicketCode();
      const session = (await c.query(
        `INSERT INTO parking_sessions (vehicle_id, facility_id, slot_id, rate_rule_id, operator_id, reservation_id, vehicle_type, ticket_code, client_request_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [v.id, d.facility_id, slot.id, rule.id, req.user.id, reservation ? reservation.id : null, d.vehicle_type, ticket, d.client_request_id || null]
      )).rows[0];
      if (reservation) await c.query(`UPDATE reservations SET status = 'fulfilled' WHERE id = $1`, [reservation.id]);
      const updatedSlot = await setSlotStatus(c, slot.id, 'occupied', { userId: req.user.id, cause: 'entry' });
      await audit(c, {
        userId: req.user.id, action: 'vehicle_entry', target: `session:${session.id}`,
        details: { plate, vehicle_type: d.vehicle_type, slot: slot.code, facility_id: d.facility_id, reservation_id: reservation ? reservation.id : null, override: Boolean(d.slot_id) },
      });
      return { session, slot: updatedSlot, reservation };
    });
  } catch (err) {
    if (err.code === '23505') {
      // unique index fired: parallel request for the same plate, slot, or request id
      if (d.client_request_id) {
        const prev = await db.query('SELECT id FROM parking_sessions WHERE client_request_id = $1', [d.client_request_id]);
        if (prev.rows[0]) return res.status(200).json({ ...(await ticketPayload(prev.rows[0].id)), replayed: true });
      }
      throw conflict('This vehicle or slot was just registered at another gate. Refresh and check the slot map.');
    }
    throw err;
  }

  emitAfter(result.slot);
  res.status(201).json({ ...(await ticketPayload(result.session.id)), via_reservation: Boolean(result.reservation) });
}));

// list sessions (open ones for the gate / slot map; search by plate)
router.get('/', ah(async (req, res) => {
  const params = [];
  const where = [];
  if (req.query.status) { params.push(req.query.status); where.push(`p.status = $${params.length}`); }
  if (req.query.facility_id) { params.push(Number(req.query.facility_id)); where.push(`p.facility_id = $${params.length}`); }
  if (req.query.q) { params.push(`%${plateKey(req.query.q)}%`); where.push(`v.plate_normalised LIKE $${params.length}`); }
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const { rows } = await db.query(
    `${SESSION_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.entry_time DESC LIMIT ${limit}`,
    params
  );
  res.json(rows.map((s) => ({
    id: s.id, plate: s.plate_number, vehicle_type: s.vehicle_type, facility: s.facility_name, zone: s.zone_label, slot: s.slot_code,
    entry_time: s.entry_time, exit_time: s.exit_time, status: s.status, fee: s.fee, operator: s.operator_name, is_lost_ticket: s.is_lost_ticket,
  })));
}));

// ---------- Exit lookup (FR-EXT-01..03, FR-BIL-06) ----------
router.get('/lookup', ah(async (req, res) => {
  let session;
  const lost = Boolean(req.query.plate);
  if (req.query.code) {
    const code = normaliseTicketInput(req.query.code);
    if (!code) throw notFound('Unknown ticket. Check the code (it starts with "PS-") or use "Lost ticket" to search by plate.');
    session = (await db.query(`${SESSION_SELECT} WHERE p.ticket_code = $1`, [code])).rows[0];
    if (!session) throw notFound('Unknown ticket. Check the code or use "Lost ticket" to search by plate.');
  } else if (req.query.plate) {
    if (!isValidPlate(req.query.plate)) throw badRequest('Enter the full number plate to search for a lost ticket.');
    session = (await db.query(`${SESSION_SELECT} WHERE v.plate_normalised = $1 AND p.status = 'open'`, [plateKey(req.query.plate)])).rows[0];
    if (!session) throw notFound(`No parked vehicle found with plate ${displayPlate(req.query.plate)}. Check the plate and try again.`);
  } else {
    throw badRequest('Scan or type a ticket code, or enter a plate for a lost ticket.');
  }
  if (session.status !== 'open') {
    throw conflict(`This ticket is already closed (exited ${new Date(session.exit_time).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })}). Do not let the vehicle exit twice.`, { closed: true });
  }
  const quote = await quoteSession(db, session, { lostTicket: lost });
  const pending = (await db.query(
    `SELECT id, amount, created_at FROM payments WHERE session_id = $1 AND status = 'pending' ORDER BY id DESC LIMIT 1`,
    [session.id]
  )).rows[0];
  res.json({
    session: {
      id: session.id, plate: session.plate_number, vehicle_type: session.vehicle_type, facility: session.facility_name, facility_id: session.facility_id,
      zone: session.zone_label, slot: session.slot_code, entry_time: session.entry_time, ticket_code: session.ticket_code,
    },
    quote,
    rate: { first_hour: session.first_hour, per_hour: session.per_hour, daily_cap: session.daily_cap, grace_minutes: session.grace_minutes, lost_ticket_penalty: session.lost_ticket_penalty },
    pending_payment: pending || null,
  });
}));

// ---------- Exit + payment (UC-02, FR-EXT-04/05, FR-BIL-05..09) ----------
router.post('/:id/exit', ah(async (req, res) => {
  const d = validate(req.body, {
    method: { type: 'string', required: true, enum: ['cash', 'online'], label: 'payment method' },
    lost_ticket: { type: 'bool', default: false },
    override_amount: { type: 'number', min: 0, max: 1000000, label: 'override amount' },
    override_reason: { type: 'string', max: 300, label: 'override reason' },
  });
  const isOverride = d.override_amount !== undefined;
  if (isOverride) {
    // FR-BIL-07
    if (req.user.role !== 'admin') throw forbidden('Only an Administrator can override a fee.');
    if (!d.override_reason || d.override_reason.length < 3) throw badRequest('Enter a reason for the fee override (required).');
  }

  const out = await db.withTransaction(async (c) => {
    const session = (await c.query(`${SESSION_SELECT} WHERE p.id = $1 FOR UPDATE OF p`, [req.params.id])).rows[0];
    if (!session) throw notFound('Session not found.');
    if (session.status !== 'open') throw conflict('This ticket is already closed. Do not let the vehicle exit twice.');
    const quote = await quoteSession(c, session, { lostTicket: d.lost_ticket });
    const amount = isOverride ? d.override_amount : quote.total;
    const passId = quote.pass ? quote.pass.id : null;

    const zeroFee = amount === 0;
    const method = zeroFee ? (passId ? 'pass' : 'cash') : d.method;

    const payment = (await c.query(
      `INSERT INTO payments (session_id, amount, base_fee, penalty, original_amount, method, status, quoted_exit_time, override_reason, overridden_by, operator_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9, $10) RETURNING *`,
      [session.id, amount, quote.time_fee, quote.penalty, isOverride ? quote.total : null, method, quote.exit_time,
        isOverride ? d.override_reason : null, isOverride ? req.user.id : null, req.user.id]
    )).rows[0];

    if (isOverride) {
      await audit(c, {
        userId: req.user.id, action: 'fee_override', target: `session:${session.id}`,
        details: { plate: session.plate_number, calculated: quote.total, charged: amount, reason: d.override_reason },
      });
    }

    if (method === 'online') {
      // FR-BIL-09: stays Pending until the sandbox gateway answers; slot stays Occupied
      await c.query(`UPDATE payments SET status = 'failed' WHERE session_id = $1 AND status = 'pending' AND id <> $2`, [session.id, payment.id]);
      await c.query('UPDATE parking_sessions SET is_lost_ticket = $2 WHERE id = $1', [session.id, d.lost_ticket]);
      await audit(c, { userId: req.user.id, action: 'payment_initiated', target: `payment:${payment.id}`, details: { session_id: session.id, amount, method: 'online' } });
      return { payment, pending: true };
    }
    const settled = await settleSessionPayment(c, payment, session, { userId: req.user.id, lostTicket: d.lost_ticket, passId });
    return { ...settled, pending: false };
  });

  if (out.slot) emitAfter(out.slot);
  res.json({
    payment: out.payment,
    pending: out.pending,
    gateway_url: out.pending ? `/pay/${out.payment.id}` : null,
  });
}));

// ticket reprint
router.get('/:id/ticket', ah(async (req, res) => {
  const t = await ticketPayload(Number(req.params.id));
  if (!t) throw notFound('Ticket not found.');
  res.json(t);
}));

module.exports = router;
