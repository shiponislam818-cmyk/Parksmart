const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/pool');
const config = require('../config');
const { validate } = require('../utils/validate');
const { ah, badRequest, unauthorized, conflict } = require('../utils/errors');
const { signToken, authenticate } = require('../middleware/auth');
const { audit } = require('../services/audit');

const router = express.Router();

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, is_active: u.is_active };
}

// FR-AUTH-01: driver self-registration
router.post('/register', ah(async (req, res) => {
  const data = validate(req.body, {
    name: { type: 'string', required: true, min: 2, max: 80 },
    phone: { type: 'phone', required: true },
    email: { type: 'email', required: true },
    password: { type: 'password', required: true },
  });
  const dup = await db.query('SELECT email, phone FROM users WHERE lower(email) = $1 OR phone = $2', [data.email, data.phone]);
  if (dup.rows.length) {
    const which = dup.rows[0].email === data.email ? 'email' : 'phone number';
    throw conflict(`An account with this ${which} already exists. Log in instead, or use a different ${which}.`);
  }
  const hash = await bcrypt.hash(data.password, config.bcryptCost);
  const { rows } = await db.query(
    `INSERT INTO users (name, phone, email, role, password_hash) VALUES ($1, $2, $3, 'driver', $4) RETURNING *`,
    [data.name, data.phone, data.email, hash]
  );
  const user = rows[0];
  await audit(null, { userId: user.id, action: 'register', target: `user:${user.id}` });
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
}));

// FR-AUTH-02 / FR-AUTH-07: login by email or phone, lock after 5 failures for 15 minutes
router.post('/login', ah(async (req, res) => {
  const { identifier, password } = validate(req.body, {
    identifier: { type: 'string', required: true, label: 'email or phone' },
    password: { type: 'string', required: true },
  });
  const idEmail = identifier.toLowerCase();
  const idPhone = identifier.replace(/[\s-]/g, '');
  const { rows } = await db.query('SELECT * FROM users WHERE lower(email) = $1 OR phone = $2 LIMIT 1', [idEmail, idPhone]);
  const user = rows[0];
  const generic = 'Email/phone or password is incorrect. Check them and try again.';
  if (!user) throw unauthorized(generic);

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    const mins = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
    throw unauthorized(`Account locked after too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`);
  }
  if (!user.is_active) throw unauthorized('This account is deactivated. Contact an administrator.');

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    const failed = user.failed_logins + 1;
    const lock = failed >= MAX_FAILED;
    await db.query(
      `UPDATE users SET failed_logins = $2, locked_until = CASE WHEN $3 THEN now() + interval '${LOCK_MINUTES} minutes' ELSE locked_until END WHERE id = $1`,
      [user.id, lock ? 0 : failed, lock]
    );
    await audit(null, { userId: user.id, action: lock ? 'login_locked' : 'login_failed', target: `user:${user.id}` });
    if (lock) throw unauthorized(`Too many failed attempts. The account is locked for ${LOCK_MINUTES} minutes.`);
    throw unauthorized(`${generic} (${MAX_FAILED - failed} attempt${MAX_FAILED - failed === 1 ? '' : 's'} left before a 15-minute lock.)`);
  }

  await db.query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [user.id]);
  await audit(null, { userId: user.id, action: 'login', target: `user:${user.id}` });
  res.json({ token: signToken(user), user: publicUser(user) });
}));

router.get('/me', authenticate, ah(async (req, res) => {
  res.json({ user: publicUser(req.user) });
}));

// FR-AUTH-08: logout (token is discarded by the client; we record it)
router.post('/logout', authenticate, ah(async (req, res) => {
  await audit(null, { userId: req.user.id, action: 'logout', target: `user:${req.user.id}` });
  res.json({ ok: true });
}));

// FR-AUTH-09: change password after entering the current one
router.post('/change-password', authenticate, ah(async (req, res) => {
  const data = validate(req.body, {
    current_password: { type: 'string', required: true, label: 'current password' },
    new_password: { type: 'password', required: true, label: 'new password' },
  });
  const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!(await bcrypt.compare(data.current_password, rows[0].password_hash))) {
    throw badRequest('Current password is incorrect. Re-enter it and try again.');
  }
  if (data.current_password === data.new_password) throw badRequest('New password must be different from the current one.');
  const hash = await bcrypt.hash(data.new_password, config.bcryptCost);
  await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [req.user.id, hash]);
  await audit(null, { userId: req.user.id, action: 'password_change', target: `user:${req.user.id}` });
  res.json({ ok: true });
}));

module.exports = router;
