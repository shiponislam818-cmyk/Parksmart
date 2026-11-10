const db = require('../db/pool');
const { dateOnly } = require('../utils/format');
const { calculateFee, formatDuration } = require('./feeEngine');
const { setSlotStatus } = require('./slots');
const { audit } = require('./audit');

const TODAY_DHAKA = `(now() AT TIME ZONE 'Asia/Dhaka')::date`;

const SESSION_SELECT = `
  SELECT p.*, v.plate_number, v.plate_normalised, v.owner_id,
         s.code AS slot_code, s.zone_id, z.label AS zone_label, f.name AS facility_name,
         r.first_hour, r.per_hour, r.daily_cap, r.grace_minutes, r.lost_ticket_penalty,
         ou.name AS operator_name
  FROM parking_sessions p
  JOIN vehicles v ON v.id = p.vehicle_id
  JOIN slots s ON s.id = p.slot_id
  JOIN zones z ON z.id = s.zone_id
  JOIN facilities f ON f.id = p.facility_id
  JOIN rate_rules r ON r.id = p.rate_rule_id
  JOIN users ou ON ou.id = p.operator_id`;

/** Valid monthly pass for this vehicle at this facility today (FR-EXT-05). */
async function findValidPass(runner, vehicleId, facilityId) {
  const { rows } = await runner.query(
    `SELECT * FROM monthly_passes WHERE vehicle_id = $1 AND facility_id = $2 AND status = 'active'
       AND start_date <= ${TODAY_DHAKA} AND end_date >= ${TODAY_DHAKA} ORDER BY end_date DESC LIMIT 1`,
    [vehicleId, facilityId]
  );
  return rows[0] || null;
}

/**
 * Build the exit quote for an open session using the rate rule stored at entry (FR-BIL-03).
 * A valid monthly pass waives the time fee; a lost-ticket penalty still applies (OI-2).
 */
async function quoteSession(runner, session, { lostTicket = false, at = new Date() } = {}) {
  const rule = {
    first_hour: session.first_hour, per_hour: session.per_hour, daily_cap: session.daily_cap, grace_minutes: session.grace_minutes,
  };
  const fee = calculateFee(session.entry_time, at, rule, { lostTicketPenalty: lostTicket ? session.lost_ticket_penalty : 0 });
  const pass = await findValidPass(runner, session.vehicle_id, session.facility_id);
  const timeFee = pass ? 0 : fee.timeFee;
  const lines = pass ? [`Monthly pass #${pass.id} (valid to ${dateOnly(pass.end_date)}): time fee waived`, ...(fee.penalty ? [`Lost-ticket penalty: BDT ${fee.penalty}`] : [])] : fee.lines;
  return {
    session_id: session.id,
    exit_time: at.toISOString(),
    minutes: fee.minutes,
    duration: formatDuration(fee.minutes),
    time_fee: timeFee,
    calculated_time_fee: fee.timeFee,
    penalty: fee.penalty,
    total: Math.round((timeFee + fee.penalty) * 100) / 100,
    within_grace: fee.withinGrace,
    cap_applied: fee.capApplied,
    pass: pass ? { id: pass.id, end_date: pass.end_date } : null,
    lost_ticket: lostTicket,
    lines,
  };
}

async function nextReceiptNo(c) {
  const { rows } = await c.query(
    `SELECT 'R-' || to_char(now() AT TIME ZONE 'Asia/Dhaka', 'YYYYMMDD') || '-' || nextval('receipt_seq') AS no`
  );
  return rows[0].no;
}

/**
 * Mark payment paid, close the session and free the slot — one transaction (NFR-REL-01, FR-EXT-04).
 * Returns the freed slot so the caller can broadcast it after COMMIT.
 */
async function settleSessionPayment(c, payment, session, { userId, lostTicket, passId }) {
  const receiptNo = await nextReceiptNo(c);
  const paid = (await c.query(
    `UPDATE payments SET status = 'paid', paid_at = now(), receipt_no = $2 WHERE id = $1 RETURNING *`,
    [payment.id, receiptNo]
  )).rows[0];
  await c.query(
    `UPDATE parking_sessions SET status = 'closed', exit_time = $2, fee = $3, is_lost_ticket = $4, pass_id = $5, exit_operator_id = $6
     WHERE id = $1`,
    [session.id, payment.quoted_exit_time || new Date(), paid.amount, Boolean(lostTicket), passId || null, userId]
  );
  // close any other pending online attempts for this session
  await c.query(`UPDATE payments SET status = 'failed' WHERE session_id = $1 AND status = 'pending' AND id <> $2`, [session.id, payment.id]);
  const slot = await setSlotStatus(c, session.slot_id, 'free', { userId, cause: 'exit_paid' });
  await audit(c, {
    userId, action: 'payment', target: `payment:${paid.id}`,
    details: { session_id: session.id, amount: paid.amount, method: paid.method, receipt_no: receiptNo, plate: session.plate_number },
  });
  await audit(c, {
    userId, action: 'vehicle_exit', target: `session:${session.id}`,
    details: { plate: session.plate_number, slot: session.slot_code, fee: paid.amount, lost_ticket: Boolean(lostTicket), pass_id: passId || null },
  });
  return { payment: paid, slot };
}

/** Receipt data (FR-BIL-08) for a paid payment. */
async function buildReceipt(paymentId) {
  const { rows } = await db.query(
    `SELECT pay.*, ou.name AS operator_name, ov.name AS overridden_by_name
     FROM payments pay LEFT JOIN users ou ON ou.id = pay.operator_id LEFT JOIN users ov ON ov.id = pay.overridden_by
     WHERE pay.id = $1`,
    [paymentId]
  );
  const pay = rows[0];
  if (!pay) return null;
  const receipt = {
    id: pay.id, receipt_no: pay.receipt_no, status: pay.status, method: pay.method, amount: pay.amount,
    base_fee: pay.base_fee, penalty: pay.penalty, original_amount: pay.original_amount,
    override_reason: pay.override_reason, overridden_by: pay.overridden_by_name,
    paid_at: pay.paid_at, created_at: pay.created_at, operator: pay.operator_name,
  };
  if (pay.session_id) {
    const s = (await db.query(`${SESSION_SELECT} WHERE p.id = $1`, [pay.session_id])).rows[0];
    const exitTime = s.exit_time || pay.quoted_exit_time;
    const minutes = exitTime ? Math.ceil((new Date(exitTime) - new Date(s.entry_time)) / 60000) : null;
    receipt.kind = 'parking';
    receipt.owner_id = s.owner_id;
    receipt.session = {
      id: s.id, plate: s.plate_number, vehicle_type: s.vehicle_type, facility: s.facility_name, zone: s.zone_label,
      slot: s.slot_code, entry_time: s.entry_time, exit_time: exitTime, duration: minutes !== null ? formatDuration(minutes) : null,
      ticket_code: s.ticket_code, is_lost_ticket: s.is_lost_ticket, pass_id: s.pass_id,
    };
    if (minutes !== null) {
      const fee = calculateFee(s.entry_time, exitTime, s, { lostTicketPenalty: Number(pay.penalty) });
      receipt.breakdown = s.pass_id ? [`Monthly pass #${s.pass_id}: time fee waived`, ...(Number(pay.penalty) ? [`Lost-ticket penalty: BDT ${pay.penalty}`] : [])] : fee.lines;
    }
    receipt.rate = { first_hour: s.first_hour, per_hour: s.per_hour, daily_cap: s.daily_cap, grace_minutes: s.grace_minutes };
  } else {
    const p = (await db.query(
      `SELECT mp.*, v.plate_number, v.type AS vehicle_type, f.name AS facility_name, u.name AS user_name
       FROM monthly_passes mp JOIN vehicles v ON v.id = mp.vehicle_id JOIN facilities f ON f.id = mp.facility_id JOIN users u ON u.id = mp.user_id
       WHERE mp.id = $1`,
      [pay.pass_id]
    )).rows[0];
    receipt.kind = 'pass';
    receipt.owner_id = p.user_id;
    receipt.pass = { id: p.id, plate: p.plate_number, vehicle_type: p.vehicle_type, facility: p.facility_name, start_date: p.start_date, end_date: p.end_date, holder: p.user_name };
    receipt.breakdown = [`Monthly pass ${dateOnly(p.start_date)} to ${dateOnly(p.end_date)}: BDT ${pay.amount}`];
  }
  return receipt;
}

module.exports = { SESSION_SELECT, TODAY_DHAKA, findValidPass, quoteSession, settleSessionPayment, nextReceiptNo, buildReceipt };
