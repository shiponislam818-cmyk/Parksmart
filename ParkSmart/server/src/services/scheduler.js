const db = require('../db/pool');
const config = require('../config');
const { setSlotStatus, emitAfter } = require('./slots');
const { audit } = require('./audit');
const { sendPassReminder } = require('./email');
const { TODAY_DHAKA } = require('./billing');

/**
 * FR-RES-03: at window start, put the reservation's slot on hold (Reserved).
 * If its slot is not free (a walk-in took it), move the reservation to another free slot of the same type.
 * Runs inside the caller's transaction; returns slots to broadcast.
 */
async function activateReservation(c, r) {
  let slot = (await c.query('SELECT * FROM slots WHERE id = $1 FOR UPDATE', [r.slot_id])).rows[0];
  if (!slot || slot.is_deleted || slot.status !== 'free') {
    const vt = (await c.query('SELECT type FROM vehicles WHERE id = $1', [r.vehicle_id])).rows[0].type;
    slot = (await c.query(
      `SELECT s.* FROM slots s JOIN zones z ON z.id = s.zone_id
       WHERE s.facility_id = $1 AND s.vehicle_type = $2 AND s.status = 'free' AND NOT s.is_deleted AND NOT z.is_deleted
       ORDER BY z.sort_order, z.id, s.sequence_no, s.id LIMIT 1 FOR UPDATE OF s SKIP LOCKED`,
      [r.facility_id, vt]
    )).rows[0];
    if (!slot) return []; // retry on the next tick until the hold period ends
    await c.query('UPDATE reservations SET slot_id = $2 WHERE id = $1', [r.id, slot.id]);
  }
  await c.query(`UPDATE reservations SET status = 'active' WHERE id = $1`, [r.id]);
  const updated = await setSlotStatus(c, slot.id, 'reserved', { cause: `reservation:${r.id}` });
  return [updated];
}

async function activateDueReservations() {
  const due = (await db.query(
    `SELECT id FROM reservations WHERE status = 'booked' AND start_time <= now()
       AND now() < start_time + make_interval(mins => hold_minutes) ORDER BY start_time`
  )).rows;
  const changed = [];
  for (const { id } of due) {
    const slots = await db.withTransaction(async (c) => {
      const r = (await c.query(`SELECT * FROM reservations WHERE id = $1 AND status = 'booked' FOR UPDATE SKIP LOCKED`, [id])).rows[0];
      return r ? activateReservation(c, r) : [];
    });
    changed.push(...slots);
  }
  emitAfter(changed);
  return changed.length;
}

/** FR-RES-04: expire reservations whose hold period ended without entry; free the slot. */
async function expireReservations() {
  const due = (await db.query(
    `SELECT id FROM reservations WHERE status IN ('booked', 'active') AND now() >= start_time + make_interval(mins => hold_minutes)`
  )).rows;
  const changed = [];
  for (const { id } of due) {
    const slots = await db.withTransaction(async (c) => {
      const r = (await c.query(`SELECT * FROM reservations WHERE id = $1 AND status IN ('booked','active') FOR UPDATE SKIP LOCKED`, [id])).rows[0];
      if (!r) return [];
      await c.query(`UPDATE reservations SET status = 'expired' WHERE id = $1`, [r.id]);
      await audit(c, { action: 'reservation_expired', target: `reservation:${r.id}` });
      if (r.status === 'active') {
        const s = (await c.query('SELECT * FROM slots WHERE id = $1 FOR UPDATE', [r.slot_id])).rows[0];
        if (s && s.status === 'reserved') return [await setSlotStatus(c, s.id, 'free', { cause: `reservation_expired:${r.id}` })];
      }
      return [];
    });
    changed.push(...slots);
  }
  emitAfter(changed);
  return due.length;
}

/** Expire finished passes and send renewal reminders 3 days before expiry (FR-RES-07). */
async function passHousekeeping() {
  await db.query(`UPDATE monthly_passes SET status = 'expired' WHERE status = 'active' AND end_date < ${TODAY_DHAKA}`);
  // stale unpaid passes (abandoned sandbox checkout) are cancelled after 1 hour
  await db.query(
    `WITH stale AS (
       UPDATE monthly_passes SET status = 'cancelled' WHERE status = 'pending' AND created_at < now() - interval '1 hour' RETURNING id)
     UPDATE payments SET status = 'failed' WHERE status = 'pending' AND pass_id IN (SELECT id FROM stale)`
  );
  const due = (await db.query(
    `SELECT mp.*, u.email, u.name, v.plate_number, f.name AS facility_name
     FROM monthly_passes mp JOIN users u ON u.id = mp.user_id JOIN vehicles v ON v.id = mp.vehicle_id JOIN facilities f ON f.id = mp.facility_id
     WHERE mp.status = 'active' AND NOT mp.reminder_sent AND mp.end_date - ${TODAY_DHAKA} <= 3
       AND NOT EXISTS (SELECT 1 FROM monthly_passes n WHERE n.vehicle_id = mp.vehicle_id AND n.facility_id = mp.facility_id
                       AND n.status = 'active' AND n.start_date > mp.end_date)`
  )).rows;
  for (const p of due) {
    try {
      await sendPassReminder(p);
      await db.query('UPDATE monthly_passes SET reminder_sent = TRUE WHERE id = $1', [p.id]);
      await audit(null, { userId: p.user_id, action: 'pass_reminder_sent', target: `pass:${p.id}` });
    } catch (e) {
      console.error('[scheduler] reminder email failed:', e.message);
    }
  }
}

let timer = null;
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    await expireReservations();
    await activateDueReservations();
    await passHousekeeping();
  } catch (e) {
    console.error('[scheduler]', e.message);
  } finally {
    running = false;
  }
}

function startScheduler() {
  tick();
  timer = setInterval(tick, config.schedulerIntervalMs);
  return timer;
}

function stopScheduler() {
  if (timer) clearInterval(timer);
}

module.exports = { startScheduler, stopScheduler, tick, activateReservation, expireReservations, activateDueReservations };
