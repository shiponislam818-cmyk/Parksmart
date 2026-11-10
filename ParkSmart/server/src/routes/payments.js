const express = require('express');
const db = require('../db/pool');
const { dateOnly } = require('../utils/format');
const { validate } = require('../utils/validate');
const { ah, notFound, conflict, forbidden } = require('../utils/errors');
const { authenticate } = require('../middleware/auth');
const { audit } = require('../services/audit');
const { emitAfter } = require('../services/slots');
const { SESSION_SELECT, buildReceipt, settleSessionPayment, findValidPass, nextReceiptNo } = require('../services/billing');
const { receiptPdf } = require('../services/pdf');

const router = express.Router();
router.use(authenticate);

const isStaff = (u) => u.role === 'admin' || u.role === 'operator';

async function loadPayment(id) {
  const { rows } = await db.query(
    `SELECT pay.*, mp.user_id AS pass_user_id, v.owner_id AS session_owner_id
     FROM payments pay
     LEFT JOIN monthly_passes mp ON mp.id = pay.pass_id
     LEFT JOIN parking_sessions p ON p.id = pay.session_id
     LEFT JOIN vehicles v ON v.id = p.vehicle_id
     WHERE pay.id = $1`,
    [id]
  );
  return rows[0];
}

function canSee(user, pay) {
  if (isStaff(user)) return true;
  return pay.pass_user_id === user.id || pay.session_owner_id === user.id;
}

// payment summary used by the sandbox gateway page
router.get('/:id', ah(async (req, res) => {
  const pay = await loadPayment(req.params.id);
  if (!pay || !canSee(req.user, pay)) throw notFound('Payment not found.');
  let purpose = '';
  if (pay.session_id) {
    const s = (await db.query(`${SESSION_SELECT} WHERE p.id = $1`, [pay.session_id])).rows[0];
    purpose = `Parking — ${s.plate_number}, ${s.facility_name} slot ${s.slot_code}`;
  } else {
    const p = (await db.query(
      `SELECT mp.*, v.plate_number, f.name AS facility_name FROM monthly_passes mp JOIN vehicles v ON v.id = mp.vehicle_id JOIN facilities f ON f.id = mp.facility_id WHERE mp.id = $1`,
      [pay.pass_id]
    )).rows[0];
    purpose = `Monthly pass — ${p.plate_number}, ${p.facility_name} (${dateOnly(p.start_date)} to ${dateOnly(p.end_date)})`;
  }
  res.json({
    id: pay.id, amount: pay.amount, method: pay.method, status: pay.status, receipt_no: pay.receipt_no,
    kind: pay.session_id ? 'parking' : 'pass', session_id: pay.session_id, pass_id: pay.pass_id, purpose, created_at: pay.created_at,
  });
}));

/**
 * Sandbox gateway result (C-2: test mode only, no real money).
 * outcome "success" -> Paid (session closed / pass activated); "failure" -> Failed (slot stays Occupied).
 */
router.post('/:id/sandbox', ah(async (req, res) => {
  const { outcome } = validate(req.body, { outcome: { type: 'string', required: true, enum: ['success', 'failure'] } });
  const pre = await loadPayment(req.params.id);
  if (!pre || !canSee(req.user, pre)) throw notFound('Payment not found.');
  if (pre.session_id && !isStaff(req.user)) throw forbidden('Parking payments are confirmed at the exit gate.');
  if (pre.pass_id && pre.pass_user_id !== req.user.id) throw forbidden('Only the pass holder can pay for this pass.');

  const out = await db.withTransaction(async (c) => {
    const pay = (await c.query('SELECT * FROM payments WHERE id = $1 FOR UPDATE', [pre.id])).rows[0];
    if (pay.status !== 'pending') throw conflict(`This payment is already ${pay.status}. Start a new payment if needed.`);

    if (outcome === 'failure') {
      const failed = (await c.query(`UPDATE payments SET status = 'failed' WHERE id = $1 RETURNING *`, [pay.id])).rows[0];
      if (pay.pass_id) await c.query(`UPDATE monthly_passes SET status = 'cancelled' WHERE id = $1 AND status = 'pending'`, [pay.pass_id]);
      await audit(c, { userId: req.user.id, action: 'payment_failed', target: `payment:${pay.id}`, details: { amount: pay.amount, session_id: pay.session_id, pass_id: pay.pass_id } });
      return { payment: failed };
    }

    if (pay.session_id) {
      const session = (await c.query(`${SESSION_SELECT} WHERE p.id = $1 FOR UPDATE OF p`, [pay.session_id])).rows[0];
      if (session.status !== 'open') throw conflict('This session was already closed (paid another way).');
      const pass = await findValidPass(c, session.vehicle_id, session.facility_id);
      return settleSessionPayment(c, pay, session, { userId: req.user.id, lostTicket: session.is_lost_ticket, passId: pass ? pass.id : null });
    }

    // monthly pass purchase / renewal (FR-RES-06)
    const receiptNo = await nextReceiptNo(c);
    const paid = (await c.query(`UPDATE payments SET status = 'paid', paid_at = now(), receipt_no = $2 WHERE id = $1 RETURNING *`, [pay.id, receiptNo])).rows[0];
    await c.query(`UPDATE monthly_passes SET status = 'active' WHERE id = $1`, [pay.pass_id]);
    await audit(c, { userId: req.user.id, action: 'payment', target: `payment:${pay.id}`, details: { pass_id: pay.pass_id, amount: pay.amount, method: 'online', receipt_no: receiptNo } });
    return { payment: paid };
  });

  if (out.slot) emitAfter(out.slot);
  res.json({ payment: out.payment });
}));

router.get('/:id/receipt', ah(async (req, res) => {
  const pay = await loadPayment(req.params.id);
  if (!pay || !canSee(req.user, pay)) throw notFound('Receipt not found.');
  if (pay.status !== 'paid') throw conflict('No receipt: this payment is not paid.');
  res.json(await buildReceipt(pay.id));
}));

router.get('/:id/receipt.pdf', ah(async (req, res) => {
  const pay = await loadPayment(req.params.id);
  if (!pay || !canSee(req.user, pay)) throw notFound('Receipt not found.');
  if (pay.status !== 'paid') throw conflict('No receipt: this payment is not paid.');
  const receipt = await buildReceipt(pay.id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${receipt.receipt_no}.pdf"`);
  receiptPdf(receipt, res);
}));

module.exports = router;
