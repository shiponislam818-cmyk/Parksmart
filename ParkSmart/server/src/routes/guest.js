const express = require('express');
const db = require('../db/pool');
const { ah, notFound } = require('../utils/errors');
const { normaliseTicketInput } = require('../utils/ticketCode');
const { SESSION_SELECT, quoteSession } = require('../services/billing');
const { formatDuration } = require('../services/feeEngine');

const router = express.Router();

// simple per-IP throttle for the public endpoint (ticket codes are 130-bit, this just limits noise)
const hits = new Map();
router.use((req, res, next) => {
  const now = Date.now();
  const key = req.ip;
  const h = hits.get(key) || { n: 0, t: now };
  if (now - h.t > 60000) { h.n = 0; h.t = now; }
  h.n += 1;
  hits.set(key, h);
  if (h.n > 60) return res.status(429).json({ error: 'Too many requests. Wait a minute and refresh.' });
  next();
});

// FR-GST-01 / FR-GST-02: public, read-only, only this ticket's own data (no plate, no user data)
router.get('/tickets/:code', ah(async (req, res) => {
  const code = normaliseTicketInput(req.params.code);
  const s = code ? (await db.query(`${SESSION_SELECT} WHERE p.ticket_code = $1`, [code])).rows[0] : null;
  if (!s) throw notFound('Ticket not found. Check that you scanned the QR code on your ParkSmart ticket.');
  const base = {
    ticket_code: s.ticket_code, facility: s.facility_name, zone: s.zone_label, slot: s.slot_code,
    vehicle_type: s.vehicle_type, entry_time: s.entry_time, status: s.status,
  };
  if (s.status === 'closed') {
    const minutes = Math.ceil((new Date(s.exit_time) - new Date(s.entry_time)) / 60000);
    return res.json({ ...base, exit_time: s.exit_time, elapsed: formatDuration(minutes), fee: s.fee });
  }
  const q = await quoteSession(db, s, { lostTicket: false });
  res.json({ ...base, elapsed: q.duration, elapsed_minutes: q.minutes, fee: q.total, pass_applied: Boolean(q.pass), now: q.exit_time });
}));

module.exports = router;
