import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar } from 'react-chartjs-2';
import { BadgeCheck, Car, CircleDollarSign, Gauge, RefreshCw } from 'lucide-react';
import { api, download } from '../../lib/api';
import { useLiveSlots } from '../../lib/socket';
import { bdt, dhakaToday, fmtMinutes, hourLabel, VEHICLE_LABELS } from '../../lib/format';
import { ACCENT, baseOptions, barStyle, TYPE_COLORS } from '../../lib/charts';
import { Alert, Button, Loading, useToast } from '../../components/ui';

/** UI-03 / FR-REP-01: admin dashboard */
export default function Dashboard() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try { setD(await api('/reports/dashboard')); setError(''); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useLiveSlots(() => load(), load);

  const exportMonth = async (format) => {
    try {
      await download(`/reports/export?report=revenue&format=${format}&group=day&from=${dhakaToday().slice(0, 8)}01&to=${dhakaToday()}`, `revenue.${format}`);
    } catch (e) { toast(e.message, 'error'); }
  };

  if (!d) return <div className="page">{error ? <Alert onRetry={load}>{error}</Alert> : <Loading />}</div>;
  const rt = d.revenue_today;
  const cashPct = rt.total ? Math.round((rt.cash / rt.total) * 100) : 0;

  return (
    <div className="page">
      <div className="page-head">
        <div><span className="eyebrow">Administrator</span><h1>Dashboard</h1><p>Live occupancy and today's activity across all facilities</p></div>
        <div className="page-actions">
          <Button busy={busy} onClick={load}><RefreshCw size={16} /><span>Refresh</span></Button>
          <Link className="btn btn-primary" to="/admin/reports"><span>Full reports</span></Link>
        </div>
      </div>
      <Alert onRetry={load}>{error}</Alert>
      <div className="grid grid-4 stagger">
        <div className="glass stat">
          <span className="icon-bubble"><Gauge size={20} /></span>
          <span className="label">Occupancy now</span>
          <span className="value">{d.occupancy.percent}%</span>
          <span className="sub">{d.occupancy.occupied} of {d.occupancy.total} slots</span>
          <div className="meter" style={{ marginTop: 6 }}><i style={{ width: `${d.occupancy.percent}%` }} /></div>
        </div>
        <div className="glass stat">
          <span className="icon-bubble"><CircleDollarSign size={20} /></span>
          <span className="label">Today's revenue</span>
          <span className="value">{bdt(rt.total)}</span>
          <span className="sub">Cash {cashPct}% · Online {rt.total ? 100 - cashPct : 0}%</span>
        </div>
        <div className="glass stat">
          <span className="icon-bubble"><Car size={20} /></span>
          <span className="label">Entries today</span>
          <span className="value">{d.entries_today}</span>
          <span className="sub">Avg stay {fmtMinutes(d.avg_stay_minutes)} · {d.parked_now} parked now</span>
        </div>
        <div className="glass stat">
          <span className="icon-bubble"><BadgeCheck size={20} /></span>
          <span className="label">Active passes</span>
          <span className="value">{d.passes.active}</span>
          <span className="sub">{d.passes.expiring_week} expire this week</span>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="glass card">
          <div className="card-head"><h3>Entries per hour today (peak hours)</h3></div>
          <div className="chart-box">
            <Bar
              data={{ labels: d.hourly.map((h) => hourLabel(h.hour)), datasets: [{ label: 'Entries', data: d.hourly.map((h) => h.entries), backgroundColor: ACCENT, ...barStyle }] }}
              options={{ ...baseOptions('Entries'), plugins: { ...baseOptions().plugins, legend: { display: false } } }}
            />
          </div>
        </div>
        <div className="glass card">
          <div className="card-head">
            <h3>Revenue by vehicle type (this month)</h3>
            <div className="row">
              <button type="button" className="btn btn-sm" onClick={() => exportMonth('csv')}><span>Export CSV</span></button>
              <button type="button" className="btn btn-sm" onClick={() => exportMonth('pdf')}><span>Export PDF</span></button>
            </div>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Type</th><th className="right">Sessions</th><th className="right">Revenue</th></tr></thead>
              <tbody>
                {d.by_type_month.length === 0 && <tr><td colSpan={3} className="empty">No sessions this month yet.</td></tr>}
                {d.by_type_month.map((r) => (
                  <tr key={r.vehicle_type}>
                    <td><span className="row" style={{ gap: 8 }}><i style={{ width: 10, height: 10, borderRadius: 3, background: TYPE_COLORS[r.vehicle_type], display: 'inline-block' }} />{VEHICLE_LABELS[r.vehicle_type]}</span></td>
                    <td className="right">{r.sessions.toLocaleString('en-IN')}</td>
                    <td className="right">{bdt(r.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="glass card">
        <div className="card-head"><h3>Occupancy per facility and floor</h3><Link to="/map">Open live map →</Link></div>
        <div className="grid grid-2">
          {d.occupancy.facilities.map((f) => (
            <div key={f.facility_id} className="stack" style={{ gap: 8 }}>
              <div className="row between"><b>{f.facility}</b><span className="muted small">{f.occupied}/{f.total} · {f.total ? Math.round((f.occupied / f.total) * 100) : 0}%</span></div>
              {f.zones.map((z) => {
                const pct = z.total ? Math.round((z.occupied / z.total) * 100) : 0;
                return (
                  <div key={z.zone_id} className="stack" style={{ gap: 4 }}>
                    <div className="row between small"><span>{z.zone}</span><span className="muted">{z.occupied}/{z.total} occupied ({pct}%){z.reserved ? ` · ${z.reserved} reserved` : ''}{z.out_of_service ? ` · ${z.out_of_service} out` : ''}</span></div>
                    <div className="meter"><i style={{ width: `${pct}%` }} /></div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
