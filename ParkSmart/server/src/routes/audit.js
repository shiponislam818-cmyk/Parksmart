const express = require('express');
const db = require('../db/pool');
const { ah, badRequest } = require('../utils/errors');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

// FR-REP-07: filter by user, action and date range. Read-only — no edit/delete routes exist (FR-REP-06).
router.get('/', ah(async (req, res) => {
  const params = [];
  const where = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (req.query.user_id) add('a.user_id = ?', Number(req.query.user_id));
  if (req.query.action) add('a.action = ?', req.query.action);
  if (req.query.target) add('a.target ILIKE ?', `%${req.query.target}%`);
  for (const k of ['from', 'to']) {
    if (req.query[k] && !/^\d{4}-\d{2}-\d{2}$/.test(req.query[k])) throw badRequest('Dates must be in YYYY-MM-DD format.');
  }
  if (req.query.from) add(`a.created_at >= (?::date::timestamp AT TIME ZONE 'Asia/Dhaka')`, req.query.from);
  if (req.query.to) add(`a.created_at < ((?::date + 1)::timestamp AT TIME ZONE 'Asia/Dhaka')`, req.query.to);
  const page = Math.max(1, Number(req.query.page) || 1);
  const size = 50;
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (await db.query(`SELECT count(*) AS n FROM audit_log a ${w}`, params)).rows[0].n;
  const { rows } = await db.query(
    `SELECT a.*, u.name AS user_name, u.role AS user_role FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
     ${w} ORDER BY a.created_at DESC, a.id DESC LIMIT ${size} OFFSET ${(page - 1) * size}`,
    params
  );
  res.json({ rows, total, page, pages: Math.max(1, Math.ceil(total / size)) });
}));

router.get('/actions', ah(async (req, res) => {
  const { rows } = await db.query('SELECT DISTINCT action FROM audit_log ORDER BY action');
  res.json(rows.map((r) => r.action));
}));

module.exports = router;
