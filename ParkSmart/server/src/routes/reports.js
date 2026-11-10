const express = require('express');
const db = require('../db/pool');
const { ah, badRequest } = require('../utils/errors');
const { authenticate, requireRole } = require('../middleware/auth');
const { VEHICLE_LABELS } = require('../utils/validate');
const { tablePdf } = require('../services/pdf');
const { bdt, dateOnly } = require('../utils/format');
const { TODAY_DHAKA } = require('../services/billing');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function range(q) {
  const today = new Date(Date.now() + 6 * 3600000).toISOString().slice(0, 10);
  const to = q.to || today;
  const from = q.from || new Date(new Date(`${to}T00:00:00Z`).getTime() - 29 * 86400000).toISOString().slice(0, 10);
  if (!DAY_RE.test(from) || !DAY_RE.test(to)) throw badRequest('Dates must be in YYYY-MM-DD format.');
  if (from > to) throw badRequest('"From" date must be on or before the "To" date.');
  return { from, to };
}

// SQL bounds for a Dhaka-local date range [from 00:00, to+1 00:00)
const FROM_SQL = `($1::date::timestamp AT TIME ZONE 'Asia/Dhaka')`;
const TO_SQL = `(($2::date + 1)::timestamp AT TIME ZONE 'Asia/Dhaka')`;

// ---------- Dashboard tiles (FR-REP-01, UI-03) ----------
router.get('/dashboard', ah(async (req, res) => {
  const occupancy = (await db.query(
    `SELECT f.id AS facility_id, f.name AS facility, z.id AS zone_id, z.label AS zone, z.sort_order,
            count(s.*) FILTER (WHERE s.status = 'occupied') AS occupied,
            count(s.*) FILTER (WHERE s.status = 'reserved') AS reserved,
            count(s.*) FILTER (WHERE s.status = 'out_of_service') AS out_of_service,
            count(s.*) AS total
     FROM facilities f JOIN zones z ON z.facility_id = f.id AND NOT z.is_deleted
     LEFT JOIN slots s ON s.zone_id = z.id AND NOT s.is_deleted
     WHERE f.is_active GROUP BY f.id, f.name, z.id, z.label, z.sort_order ORDER BY f.name, z.sort_order, z.id`
  )).rows;
  const facilities = [];
  for (const r of occupancy) {
    let f = facilities.find((x) => x.facility_id === r.facility_id);
    if (!f) { f = { facility_id: r.facility_id, facility: r.facility, occupied: 0, total: 0, zones: [] }; facilities.push(f); }
    f.occupied += r.occupied;
    f.total += r.total;
    f.zones.push({ zone_id: r.zone_id, zone: r.zone, occupied: r.occupied, reserved: r.reserved, out_of_service: r.out_of_service, total: r.total });
  }
  const today = `(${TODAY_DHAKA}::timestamp AT TIME ZONE 'Asia/Dhaka')`;
  const revenue = (await db.query(
    `SELECT COALESCE(sum(amount), 0) AS total,
            COALESCE(sum(amount) FILTER (WHERE method = 'cash'), 0) AS cash,
            COALESCE(sum(amount) FILTER (WHERE method = 'online'), 0) AS online
     FROM payments WHERE status = 'paid' AND paid_at >= ${today}`
  )).rows[0];
  const entries = (await db.query(
    `SELECT count(*) AS entries,
            (SELECT COALESCE(round(avg(extract(epoch FROM exit_time - entry_time) / 60)), 0) FROM parking_sessions WHERE status = 'closed' AND exit_time >= ${today}) AS avg_stay_minutes,
            (SELECT count(*) FROM parking_sessions WHERE status = 'open') AS parked_now
     FROM parking_sessions WHERE entry_time >= ${today}`
  )).rows[0];
  const passes = (await db.query(
    `SELECT count(*) FILTER (WHERE start_date <= ${TODAY_DHAKA}) AS active,
            count(*) FILTER (WHERE end_date - ${TODAY_DHAKA} BETWEEN 0 AND 6) AS expiring_week
     FROM monthly_passes WHERE status = 'active' AND end_date >= ${TODAY_DHAKA}`
  )).rows[0];
  const hourly = (await db.query(
    `SELECT extract(hour FROM entry_time AT TIME ZONE 'Asia/Dhaka')::int AS hour, count(*) AS entries
     FROM parking_sessions WHERE entry_time >= ${today} GROUP BY 1 ORDER BY 1`
  )).rows;
  const byType = (await db.query(
    `SELECT p.vehicle_type, count(*) AS sessions, COALESCE(sum(pay.amount), 0) AS revenue
     FROM parking_sessions p LEFT JOIN payments pay ON pay.session_id = p.id AND pay.status = 'paid'
     WHERE p.entry_time >= date_trunc('month', now() AT TIME ZONE 'Asia/Dhaka') AT TIME ZONE 'Asia/Dhaka'
     GROUP BY p.vehicle_type ORDER BY p.vehicle_type`
  )).rows;
  const totalSlots = facilities.reduce((a, f) => a + f.total, 0);
  const occupied = facilities.reduce((a, f) => a + f.occupied, 0);
  res.json({
    occupancy: { occupied, total: totalSlots, percent: totalSlots ? Math.round((occupied / totalSlots) * 100) : 0, facilities },
    revenue_today: revenue,
    entries_today: entries.entries,
    avg_stay_minutes: entries.avg_stay_minutes,
    parked_now: entries.parked_now,
    passes,
    hourly: Array.from({ length: 24 }, (_, h) => ({ hour: h, entries: (hourly.find((x) => x.hour === h) || {}).entries || 0 })),
    by_type_month: byType,
  });
}));

// ---------- Revenue (FR-REP-02) ----------
async function revenueReport(q) {
  const { from, to } = range(q);
  const group = ['day', 'week', 'month'].includes(q.group) ? q.group : 'day';
  const rows = (await db.query(
    `WITH pays AS (
       SELECT pay.amount, pay.method, pay.paid_at, COALESCE(p.vehicle_type, v2.type) AS vehicle_type,
              CASE WHEN pay.pass_id IS NOT NULL THEN 'pass_sale' ELSE 'parking' END AS source
       FROM payments pay
       LEFT JOIN parking_sessions p ON p.id = pay.session_id
       LEFT JOIN monthly_passes mp ON mp.id = pay.pass_id
       LEFT JOIN vehicles v2 ON v2.id = mp.vehicle_id
       WHERE pay.status = 'paid' AND pay.paid_at >= ${FROM_SQL} AND pay.paid_at < ${TO_SQL})
     SELECT to_char(date_trunc($3, paid_at AT TIME ZONE 'Asia/Dhaka'), 'YYYY-MM-DD') AS period,
            vehicle_type, method, source, count(*) AS payments, sum(amount) AS amount
     FROM pays GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 3, 4`,
    [from, to, group]
  )).rows;
  const totals = { amount: 0, payments: 0, by_type: {}, by_method: {} };
  for (const r of rows) {
    totals.amount += r.amount;
    totals.payments += r.payments;
    totals.by_type[r.vehicle_type] = (totals.by_type[r.vehicle_type] || 0) + r.amount;
    totals.by_method[r.method] = (totals.by_method[r.method] || 0) + r.amount;
  }
  return { from, to, group, rows, totals };
}

router.get('/revenue', ah(async (req, res) => res.json(await revenueReport(req.query))));

// ---------- Peak hours & average stay (FR-REP-03) ----------
async function trafficReport(q) {
  const { from, to } = range(q);
  const hourly = (await db.query(
    `SELECT extract(hour FROM entry_time AT TIME ZONE 'Asia/Dhaka')::int AS hour, count(*) AS entries
     FROM parking_sessions WHERE entry_time >= ${FROM_SQL} AND entry_time < ${TO_SQL}
     GROUP BY 1 ORDER BY 1`,
    [from, to]
  )).rows;
  const stay = (await db.query(
    `SELECT vehicle_type, count(*) AS sessions, round(avg(extract(epoch FROM exit_time - entry_time) / 60)) AS avg_minutes
     FROM parking_sessions WHERE status = 'closed' AND entry_time >= ${FROM_SQL} AND entry_time < ${TO_SQL}
     GROUP BY ROLLUP (vehicle_type) ORDER BY vehicle_type NULLS LAST`,
    [from, to]
  )).rows;
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, entries: (hourly.find((x) => x.hour === h) || {}).entries || 0 }));
  const overall = stay.find((s) => s.vehicle_type === null) || { sessions: 0, avg_minutes: 0 };
  const peak = hours.reduce((a, b) => (b.entries > a.entries ? b : a), hours[0]);
  return {
    from, to, hours,
    peak_hour: peak.entries ? peak.hour : null,
    avg_stay_minutes: overall.avg_minutes || 0,
    closed_sessions: overall.sessions || 0,
    by_type: stay.filter((s) => s.vehicle_type !== null),
  };
}

router.get('/traffic', ah(async (req, res) => res.json(await trafficReport(req.query))));

// ---------- Export (FR-REP-04) ----------
function csvEscape(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(columns, rows) {
  return [columns.map((c) => csvEscape(c.label)).join(','), ...rows.map((r) => columns.map((c) => csvEscape(r[c.key])).join(','))].join('\r\n');
}
const hourLabel = (h) => `${((h + 11) % 12) + 1}:00 ${h < 12 ? 'AM' : 'PM'}`;
const METHOD = { cash: 'Cash', online: 'Online (sandbox)', pass: 'Monthly pass' };

router.get('/export', ah(async (req, res) => {
  const format = req.query.format === 'pdf' ? 'pdf' : 'csv';
  const report = req.query.report === 'traffic' ? 'traffic' : 'revenue';
  let spec;
  if (report === 'revenue') {
    const r = await revenueReport(req.query);
    spec = {
      title: 'Revenue report',
      subtitle: `${dateOnly(r.from)} to ${dateOnly(r.to)} · grouped by ${r.group} · total ${bdt(r.totals.amount)}`,
      columns: [
        { key: 'period', label: `Period (${r.group})`, width: 1.3, format: (v) => (v ? dateOnly(v) : 'Total') },
        { key: 'vehicle_type', label: 'Vehicle type', width: 1.3, format: (v) => VEHICLE_LABELS[v] || v || '' },
        { key: 'method', label: 'Method', width: 1.2, format: (v) => METHOD[v] || v || '' },
        { key: 'source', label: 'Source', width: 1, format: (v) => (v === 'pass_sale' ? 'Pass sale' : v === 'parking' ? 'Parking' : '') },
        { key: 'payments', label: 'Payments', width: 0.8, align: 'right' },
        { key: 'amount', label: 'Amount', width: 1.1, align: 'right', format: (v) => bdt(v) },
      ],
      rows: r.rows,
      totals: { period: null, payments: r.totals.payments, amount: r.totals.amount },
      csvRows: r.rows.map((x) => ({ ...x, vehicle_type: VEHICLE_LABELS[x.vehicle_type] || x.vehicle_type, method: METHOD[x.method] || x.method })),
    };
  } else {
    const t = await trafficReport(req.query);
    spec = {
      title: 'Peak hours and average stay',
      subtitle: `${dateOnly(t.from)} to ${dateOnly(t.to)} · peak hour ${t.peak_hour === null ? '—' : hourLabel(t.peak_hour)} · average stay ${t.avg_stay_minutes} min over ${t.closed_sessions} closed sessions`,
      columns: [
        { key: 'hour', label: 'Hour of day', width: 1, format: (v) => hourLabel(v) },
        { key: 'entries', label: 'Entries', width: 1, align: 'right' },
      ],
      rows: t.hours,
      csvRows: t.hours.map((h) => ({ hour: hourLabel(h.hour), entries: h.entries })),
    };
  }
  const name = `parksmart-${report}-${req.query.from || 'last30'}-${req.query.to || 'today'}`;
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
    return res.send(`﻿${toCsv(spec.columns, spec.csvRows)}`);
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${name}.pdf"`);
  tablePdf(spec, res);
}));

module.exports = router;
