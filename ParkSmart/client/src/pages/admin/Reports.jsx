import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import { Download, FileText, RefreshCw } from 'lucide-react';
import { api, download, qs } from '../../lib/api';
import { bdt, dhakaToday, fmtDate, fmtMinutes, hourLabel, METHOD_LABELS, VEHICLE_LABELS, VEHICLE_ORDER } from '../../lib/format';
import { ACCENT, baseOptions, barStyle, TYPE_COLORS } from '../../lib/charts';
import { Alert, Button, Field, Loading, Tabs, useToast } from '../../components/ui';

/** FR-REP-02..04: revenue, peak hours, average stay, CSV/PDF export */
export default function Reports() {
  const toast = useToast();
  const [range, setRange] = useState({ from: dhakaToday(-29), to: dhakaToday(), group: 'day' });
  const [applied, setApplied] = useState(range);
  const [rev, setRev] = useState(null);
  const [traffic, setTraffic] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState('chart');

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [r, t] = await Promise.all([api(`/reports/revenue${qs(applied)}`), api(`/reports/traffic${qs({ from: applied.from, to: applied.to })}`)]);
      setRev(r); setTraffic(t); setError('');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }, [applied]);
  useEffect(() => { load(); }, [load]);

  const exp = async (report, format) => {
    try { await download(`/reports/export${qs({ report, format, ...applied })}`, `${report}.${format}`); toast(`${format.toUpperCase()} downloaded`); } catch (e) { toast(e.message, 'error'); }
  };

  const periods = useMemo(() => (rev ? [...new Set(rev.rows.map((r) => r.period))] : []), [rev]);
  const typesPresent = useMemo(() => (rev ? VEHICLE_ORDER.filter((t) => rev.rows.some((r) => r.vehicle_type === t)) : []), [rev]);

  const quick = (days) => { const r = { ...range, from: dhakaToday(-(days - 1)), to: dhakaToday() }; setRange(r); setApplied(r); };

  return (
    <div className="page">
      <div className="page-head">
        <div><span className="eyebrow">Reports</span><h1>Revenue & traffic</h1><p>All times in Asia/Dhaka. Pass-covered exits count as BDT 0.</p></div>
      </div>
      <form className="glass card form-row" onSubmit={(e) => { e.preventDefault(); setApplied(range); }}>
        <Field label="From" htmlFor="rp-from"><input id="rp-from" className="input" type="date" value={range.from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value })} required /></Field>
        <Field label="To" htmlFor="rp-to"><input id="rp-to" className="input" type="date" value={range.to} min={range.from} onChange={(e) => setRange({ ...range, to: e.target.value })} required /></Field>
        <Field label="Group revenue by" htmlFor="rp-group">
          <select id="rp-group" className="input" value={range.group} onChange={(e) => setRange({ ...range, group: e.target.value })}>
            <option value="day">Day</option><option value="week">Week</option><option value="month">Month</option>
          </select>
        </Field>
        <Button type="submit" className="btn-primary" busy={busy}><RefreshCw size={16} /><span>Apply</span></Button>
        <span className="spacer" />
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className="btn btn-sm" onClick={() => quick(1)}>Today</button>
          <button type="button" className="btn btn-sm" onClick={() => quick(7)}>7 days</button>
          <button type="button" className="btn btn-sm" onClick={() => quick(30)}>30 days</button>
        </div>
      </form>
      <Alert onRetry={load}>{error}</Alert>
      {!rev || !traffic ? (!error && <Loading />) : (
        <>
          <div className="grid grid-4 stagger">
            <div className="glass stat"><span className="label">Revenue</span><span className="value">{bdt(rev.totals.amount)}</span><span className="sub">{rev.totals.payments} payments</span></div>
            <div className="glass stat"><span className="label">By method</span><span className="sub" style={{ fontSize: '.9rem' }}>{Object.entries(rev.totals.by_method).map(([m, a]) => <div key={m}>{METHOD_LABELS[m]}: <b>{bdt(a)}</b></div>)}{!Object.keys(rev.totals.by_method).length && '—'}</span></div>
            <div className="glass stat"><span className="label">Peak hour</span><span className="value">{traffic.peak_hour === null ? '—' : hourLabel(traffic.peak_hour)}</span><span className="sub">most entries in range</span></div>
            <div className="glass stat"><span className="label">Average stay</span><span className="value" style={{ fontSize: '1.6rem' }}>{fmtMinutes(traffic.avg_stay_minutes)}</span><span className="sub">{traffic.closed_sessions} completed sessions</span></div>
          </div>

          <div className="glass card">
            <div className="card-head">
              <h3>Revenue by {applied.group}, split by vehicle type</h3>
              <div className="row">
                <Tabs value={view} onChange={setView} tabs={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }]} />
                <button type="button" className="btn btn-sm" onClick={() => exp('revenue', 'csv')}><Download size={14} /><span>CSV</span></button>
                <button type="button" className="btn btn-sm" onClick={() => exp('revenue', 'pdf')}><FileText size={14} /><span>PDF</span></button>
              </div>
            </div>
            {rev.rows.length === 0 ? <p className="empty">No paid revenue in this range.</p> : view === 'chart' ? (
              <div className="chart-box">
                <Bar
                  data={{
                    labels: periods.map((p) => fmtDate(p)),
                    datasets: typesPresent.map((t) => ({
                      label: VEHICLE_LABELS[t],
                      data: periods.map((p) => rev.rows.filter((r) => r.period === p && r.vehicle_type === t).reduce((a, r) => a + r.amount, 0)),
                      backgroundColor: TYPE_COLORS[t],
                      ...barStyle,
                      borderWidth: { top: 2, left: 0, right: 0, bottom: 0 },
                      borderRadius: 4,
                    })),
                  }}
                  options={{
                    ...baseOptions('BDT'),
                    scales: { ...baseOptions().scales, x: { ...baseOptions().scales.x, stacked: true }, y: { ...baseOptions('BDT').scales.y, stacked: true } },
                    plugins: { ...baseOptions().plugins, tooltip: { ...baseOptions().plugins.tooltip, callbacks: { label: (c) => `${c.dataset.label}: ${bdt(c.parsed.y)}` } } },
                  }}
                />
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Period</th><th>Vehicle type</th><th>Method</th><th>Source</th><th className="right">Payments</th><th className="right">Amount</th></tr></thead>
                  <tbody>
                    {rev.rows.map((r) => (
                      <tr key={`${r.period}-${r.vehicle_type}-${r.method}-${r.source}`}>
                        <td>{fmtDate(r.period)}</td><td>{VEHICLE_LABELS[r.vehicle_type]}</td><td>{METHOD_LABELS[r.method]}</td>
                        <td>{r.source === 'pass_sale' ? 'Pass sale' : 'Parking'}</td><td className="right">{r.payments}</td><td className="right">{bdt(r.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="grid grid-2">
            <div className="glass card">
              <div className="card-head">
                <h3>Peak hours (entries per hour of day)</h3>
                <div className="row">
                  <button type="button" className="btn btn-sm" onClick={() => exp('traffic', 'csv')}><Download size={14} /><span>CSV</span></button>
                  <button type="button" className="btn btn-sm" onClick={() => exp('traffic', 'pdf')}><FileText size={14} /><span>PDF</span></button>
                </div>
              </div>
              <div className="chart-box">
                <Bar
                  data={{ labels: traffic.hours.map((h) => hourLabel(h.hour)), datasets: [{ label: 'Entries', data: traffic.hours.map((h) => h.entries), backgroundColor: ACCENT, ...barStyle }] }}
                  options={{ ...baseOptions('Entries'), plugins: { ...baseOptions().plugins, legend: { display: false } } }}
                />
              </div>
            </div>
            <div className="glass card">
              <div className="card-head"><h3>Average stay by vehicle type</h3></div>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Type</th><th className="right">Completed sessions</th><th className="right">Average stay</th></tr></thead>
                  <tbody>
                    {traffic.by_type.length === 0 && <tr><td colSpan={3} className="empty">No completed sessions in range.</td></tr>}
                    {traffic.by_type.map((s) => (
                      <tr key={s.vehicle_type}><td>{VEHICLE_LABELS[s.vehicle_type]}</td><td className="right">{s.sessions}</td><td className="right">{fmtMinutes(s.avg_minutes)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
