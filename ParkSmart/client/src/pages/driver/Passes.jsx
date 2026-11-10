import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BadgeCheck, RefreshCcw } from 'lucide-react';
import { api } from '../../lib/api';
import { bdt, fmtDate, VEHICLE_LABELS } from '../../lib/format';
import { Alert, Button, Field, Loading, StatusBadge, useAsync } from '../../components/ui';

/** UC-09: buy or renew a monthly pass (FR-RES-06, 07), paid through the sandbox gateway */
export default function Passes() {
  const nav = useNavigate();
  const [passes, setPasses] = useState(null);
  const [vehicles, setVehicles] = useState([]);
  const [facilities, setFacilities] = useState([]);
  const [rates, setRates] = useState([]);
  const [f, setF] = useState({ vehicle_id: '', facility_id: '' });
  const { busy, error, run } = useAsync();
  const [renewing, setRenewing] = useState(null);

  const load = useCallback(() => api('/me/passes').then(setPasses).catch(() => setPasses([])), []);
  useEffect(() => {
    load();
    api('/me/vehicles').then((v) => { setVehicles(v); if (v[0]) setF((x) => ({ ...x, vehicle_id: x.vehicle_id || String(v[0].id) })); });
    api('/facilities').then((l) => { setFacilities(l); if (l[0]) setF((x) => ({ ...x, facility_id: x.facility_id || String(l[0].id) })); });
    api('/rates').then(setRates).catch(() => {});
  }, [load]);

  const vehicle = vehicles.find((v) => String(v.id) === String(f.vehicle_id));
  const price = vehicle && (rates.find((r) => r.vehicle_type === vehicle.type) || {}).monthly_pass_price;

  const buy = (e) => {
    e.preventDefault();
    run(async () => {
      const r = await api('/me/passes', { method: 'POST', body: { vehicle_id: Number(f.vehicle_id), facility_id: Number(f.facility_id) } });
      nav(r.gateway_url);
    });
  };
  const renew = (p) => {
    setRenewing(p.id);
    run(async () => {
      const r = await api(`/me/passes/${p.id}/renew`, { method: 'POST' });
      nav(r.gateway_url);
    }).finally(() => setRenewing(null));
  };

  return (
    <div className="page">
      <div className="page-head"><div><span className="eyebrow">Driver portal</span><h1>Monthly passes</h1><p>A pass lets one registered vehicle park at one facility without per-visit fees for a month.</p></div></div>
      <Alert>{error}</Alert>
      <div className="grid grid-2">
        <form className="glass card stack" onSubmit={buy}>
          <h3><BadgeCheck size={18} style={{ verticalAlign: -3 }} /> Buy a pass</h3>
          {vehicles.length === 0 && <Alert type="info">Add a vehicle under <Link to="/driver/vehicles">My vehicles</Link> first.</Alert>}
          <Field label="Vehicle" htmlFor="ps-veh">
            <select id="ps-veh" className="input" value={f.vehicle_id} onChange={(e) => setF({ ...f, vehicle_id: e.target.value })} required>
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate_number} ({VEHICLE_LABELS[v.type]})</option>)}
            </select>
          </Field>
          <Field label="Facility" htmlFor="ps-fac">
            <select id="ps-fac" className="input" value={f.facility_id} onChange={(e) => setF({ ...f, facility_id: e.target.value })} required>
              {facilities.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </Field>
          <div className="fee-total"><span className="label">Price for one month</span><b>{price !== undefined ? bdt(price) : '—'}</b></div>
          <p className="small muted">Payment runs in sandbox (test) mode. The pass starts today, or the day after your current pass ends if you already have one.</p>
          <Button type="submit" className="btn-primary btn-lg" busy={busy && !renewing} disabled={!vehicles.length}><span>Continue to payment</span></Button>
        </form>
        <div className="glass card stack">
          <h3>My passes</h3>
          {!passes ? <Loading /> : passes.length === 0 ? <p className="muted">No passes yet.</p> : passes.map((p) => (
            <div key={p.id} className="list-item">
              <div style={{ minWidth: 0 }}>
                <b>{p.plate_number}</b> · {p.facility_name}
                <div className="small muted">{fmtDate(p.start_date)} – {fmtDate(p.end_date)} · {bdt(p.price)}{p.status === 'active' && p.days_left >= 0 ? ` · ${p.days_left} day(s) left` : ''}</div>
                {p.renewal_due && <div className="small" style={{ color: 'var(--res-ink)', fontWeight: 700 }}>Expires soon — renew to keep parking free.</div>}
              </div>
              <div className="row" style={{ gap: 6 }}>
                <StatusBadge status={p.status} />
                {p.status === 'active' && !p.renewed && <Button className="btn-sm" busy={renewing === p.id} onClick={() => renew(p)}><RefreshCcw size={14} /><span>Renew</span></Button>}
                {p.status === 'pending' && p.pending_payment_id && <Link className="btn btn-sm btn-primary" to={`/pay/${p.pending_payment_id}`}><span>Pay now</span></Link>}
                {p.payment_id && <Link className="btn btn-sm" to={`/receipt/${p.payment_id}`}><span>Receipt</span></Link>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
