import { useCallback, useEffect, useState } from 'react';
import { History, Save } from 'lucide-react';
import { api } from '../../lib/api';
import { bdt, fmtDateTime, VEHICLE_LABELS, VEHICLE_ORDER } from '../../lib/format';
import { Alert, Button, Field, Loading, Modal, useAsync, useToast } from '../../components/ui';

const FIELDS = [
  ['first_hour', 'First-hour charge (BDT)'],
  ['per_hour', 'Per started hour after (BDT)'],
  ['daily_cap', 'Daily cap per 24 h (BDT, 0 = none)'],
  ['grace_minutes', 'Grace period (minutes)'],
  ['lost_ticket_penalty', 'Lost-ticket penalty (BDT)'],
  ['monthly_pass_price', 'Monthly pass price (BDT)'],
];

/** UC-05: rate rules (FR-BIL-01, 03) and reservation policy settings (FR-RES-03) */
export default function Rates() {
  const [rates, setRates] = useState(null);
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');
  const [history, setHistory] = useState(null);

  const load = useCallback(async () => {
    try {
      const [r, s] = await Promise.all([api('/rates'), api('/settings')]);
      setRates(r); setSettings(s); setError('');
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const openHistory = async () => {
    try { setHistory(await api('/rates/history')); } catch (e) { setError(e.message); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div><span className="eyebrow">Setup</span><h1>Rates & policies</h1><p>A rate change applies to new entries only — vehicles already parked keep the rate in force at their entry.</p></div>
        <div className="page-actions"><button type="button" className="btn" onClick={openHistory}><History size={16} /><span>Rate history</span></button></div>
      </div>
      <Alert onRetry={load}>{error}</Alert>
      {!rates ? <Loading /> : (
        <div className="grid grid-3">
          {VEHICLE_ORDER.map((t) => <RateCard key={t} type={t} rule={rates.find((r) => r.vehicle_type === t)} onSaved={load} />)}
        </div>
      )}
      {settings && <SettingsCard settings={settings} onSaved={setSettings} />}
      {history && (
        <Modal title="Rate history" wide onClose={() => setHistory(null)}>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Type</th><th>First h</th><th>Per h</th><th>Cap</th><th>Grace</th><th>Lost</th><th>Pass</th><th>From</th><th>To</th><th>By</th></tr></thead>
              <tbody>
                {history.map((r) => (
                  <tr key={r.id}>
                    <td>{VEHICLE_LABELS[r.vehicle_type]}</td><td>{r.first_hour}</td><td>{r.per_hour}</td><td>{r.daily_cap}</td><td>{r.grace_minutes}m</td>
                    <td>{r.lost_ticket_penalty}</td><td>{r.monthly_pass_price}</td><td className="nowrap">{fmtDateTime(r.effective_from)}</td>
                    <td className="nowrap">{r.effective_to ? fmtDateTime(r.effective_to) : <span className="badge b-active">Active</span>}</td><td>{r.created_by_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </div>
  );
}

function RateCard({ type, rule, onSaved }) {
  const toast = useToast();
  const empty = { first_hour: '', per_hour: '', daily_cap: '', grace_minutes: '', lost_ticket_penalty: '', monthly_pass_price: '' };
  const [f, setF] = useState(rule ? { ...rule } : empty);
  const { busy, error, run } = useAsync();
  useEffect(() => { setF(rule ? { ...rule } : empty); }, [rule]); // eslint-disable-line react-hooks/exhaustive-deps

  const example = rule ? `${bdt(rule.first_hour)} first hour, then ${bdt(rule.per_hour)}/hour; 3 h 25 m = ${bdt(Math.min(Number(rule.daily_cap) || Infinity, Number(rule.first_hour) + 3 * Number(rule.per_hour)))}` : 'No active rate — entries of this type are blocked.';
  const save = (e) => {
    e.preventDefault();
    run(async () => {
      const body = Object.fromEntries(FIELDS.map(([k]) => [k, Number(f[k])]));
      await api(`/rates/${type}`, { method: 'PUT', body });
      toast(`${VEHICLE_LABELS[type]} rate updated`);
      onSaved();
    });
  };
  return (
    <form className="glass card stack" onSubmit={save}>
      <div className="card-head" style={{ marginBottom: 0 }}><h3>{VEHICLE_LABELS[type]}</h3>{rule && <span className="small muted">since {fmtDateTime(rule.effective_from)}</span>}</div>
      <p className="small muted">{example}</p>
      <Alert>{error}</Alert>
      <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
        {FIELDS.map(([k, label]) => (
          <Field key={k} label={label} htmlFor={`${type}-${k}`}>
            <input id={`${type}-${k}`} className="input" type="number" min="0" step={k === 'grace_minutes' ? 1 : 0.01} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} required />
          </Field>
        ))}
      </div>
      <Button type="submit" className="btn-primary" busy={busy}><Save size={16} /><span>Save new rate</span></Button>
    </form>
  );
}

function SettingsCard({ settings, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState(settings);
  const { busy, error, run } = useAsync();
  const save = (e) => {
    e.preventDefault();
    run(async () => {
      const body = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, Number(v)]));
      onSaved(await api('/settings', { method: 'PUT', body }));
      toast('Reservation policy saved');
    });
  };
  return (
    <form className="glass card stack" onSubmit={save}>
      <h3>Reservation policy</h3>
      <Alert>{error}</Alert>
      <div className="form-grid">
        <Field label="Hold period after window start (minutes)" htmlFor="st-hold"><input id="st-hold" className="input" type="number" min="5" max="120" value={f.reservation_hold_minutes} onChange={(e) => setF({ ...f, reservation_hold_minutes: e.target.value })} /></Field>
        <Field label="Maximum window (hours)" htmlFor="st-max"><input id="st-max" className="input" type="number" min="1" max="72" value={f.reservation_max_hours} onChange={(e) => setF({ ...f, reservation_max_hours: e.target.value })} /></Field>
        <Field label="Book up to (days ahead)" htmlFor="st-days"><input id="st-days" className="input" type="number" min="1" max="60" value={f.reservation_advance_days} onChange={(e) => setF({ ...f, reservation_advance_days: e.target.value })} /></Field>
      </div>
      <div><Button type="submit" className="btn-primary" busy={busy}><Save size={16} /><span>Save policy</span></Button></div>
    </form>
  );
}
