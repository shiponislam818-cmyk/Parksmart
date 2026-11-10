const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/pool');
const config = require('../config');
const { validate } = require('../utils/validate');
const { ah, badRequest, notFound, conflict } = require('../utils/errors');
const { authenticate, requireRole } = require('../middleware/auth');
const { audit } = require('../services/audit');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

const COLS = 'id, name, email, phone, role, is_active, locked_until, created_at';

// FR-AUTH-06: list accounts (filter by role / search)
router.get('/', ah(async (req, res) => {
  const { role, q } = req.query;
  const params = [];
  const where = [];
  if (role) { params.push(role); where.push(`role = $${params.length}`); }
  if (q) { params.push(`%${q}%`); where.push(`(name ILIKE $${params.length} OR email ILIKE $${params.length} OR phone ILIKE $${params.length})`); }
  const { rows } = await db.query(
    `SELECT ${COLS} FROM users ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY role, name`,
    params
  );
  res.json(rows);
}));

async function ensureUnique(email, phone, exceptId = 0) {
  const { rows } = await db.query(
    'SELECT email, phone FROM users WHERE id <> $3 AND ((email IS NOT NULL AND lower(email) = $1) OR (phone IS NOT NULL AND phone = $2))',
    [email || '', phone || '', exceptId]
  );
  if (rows.length) throw conflict('Another account already uses this email or phone number. Use a different one.');
}

// create Gate Operator or Administrator accounts
router.post('/', ah(async (req, res) => {
  const data = validate(req.body, {
    name: { type: 'string', required: true, min: 2, max: 80 },
    email: { type: 'email', required: true },
    phone: { type: 'phone' },
    role: { type: 'string', required: true, enum: ['admin', 'operator'] },
    password: { type: 'password', required: true },
  });
  await ensureUnique(data.email, data.phone);
  const hash = await bcrypt.hash(data.password, config.bcryptCost);
  const { rows } = await db.query(
    `INSERT INTO users (name, email, phone, role, password_hash) VALUES ($1, $2, $3, $4, $5) RETURNING ${COLS}`,
    [data.name, data.email, data.phone || null, data.role, hash]
  );
  await audit(null, { userId: req.user.id, action: 'user_create', target: `user:${rows[0].id}`, details: { role: data.role, email: data.email } });
  res.status(201).json(rows[0]);
}));

router.put('/:id', ah(async (req, res) => {
  const id = Number(req.params.id);
  const existing = (await db.query('SELECT * FROM users WHERE id = $1', [id])).rows[0];
  if (!existing) throw notFound('User not found. Refresh the list and try again.');
  const data = validate(req.body, {
    name: { type: 'string', required: true, min: 2, max: 80 },
    email: { type: 'email', required: true },
    phone: { type: 'phone' },
    role: { type: 'string', required: true, enum: ['admin', 'operator', 'driver'] },
    password: { type: 'password' },
  });
  if (existing.role === 'driver' && data.role !== 'driver') throw badRequest('Driver accounts cannot be converted to staff. Create a new staff account instead.');
  if (existing.role !== 'driver' && data.role === 'driver') throw badRequest('Staff accounts cannot be converted to drivers.');
  if (id === req.user.id && data.role !== 'admin') throw badRequest('You cannot remove your own administrator role.');
  await ensureUnique(data.email, data.phone, id);
  const hash = data.password ? await bcrypt.hash(data.password, config.bcryptCost) : null;
  const { rows } = await db.query(
    `UPDATE users SET name = $2, email = $3, phone = $4, role = $5,
       password_hash = COALESCE($6, password_hash),
       failed_logins = CASE WHEN $6::text IS NULL THEN failed_logins ELSE 0 END,
       locked_until = CASE WHEN $6::text IS NULL THEN locked_until ELSE NULL END
     WHERE id = $1 RETURNING ${COLS}`,
    [id, data.name, data.email, data.phone || null, data.role, hash]
  );
  await audit(null, {
    userId: req.user.id, action: 'user_update', target: `user:${id}`,
    details: { before: { name: existing.name, email: existing.email, phone: existing.phone, role: existing.role }, after: { name: data.name, email: data.email, phone: data.phone || null, role: data.role }, password_reset: Boolean(hash) },
  });
  res.json(rows[0]);
}));

router.patch('/:id/active', ah(async (req, res) => {
  const id = Number(req.params.id);
  const { is_active } = validate(req.body, { is_active: { type: 'bool', required: true } });
  if (id === req.user.id && !is_active) throw badRequest('You cannot deactivate your own account.');
  const { rows } = await db.query(
    `UPDATE users SET is_active = $2, failed_logins = 0, locked_until = NULL WHERE id = $1 RETURNING ${COLS}`,
    [id, is_active]
  );
  if (!rows[0]) throw notFound('User not found.');
  await audit(null, { userId: req.user.id, action: is_active ? 'user_reactivate' : 'user_deactivate', target: `user:${id}` });
  res.json(rows[0]);
}));

module.exports = router;
