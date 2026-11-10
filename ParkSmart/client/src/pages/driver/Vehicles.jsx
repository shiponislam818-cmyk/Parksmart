import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Bike, Bus, Car, Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { fmtDate, VEHICLE_LABELS, VEHICLE_ORDER } from '../../lib/format';
import { Alert, Button, Confirm, Field, Loading, useAsync, useToast } from '../../components/ui';

const ICON = { motorcycle: Bike, car: Car, microbus: Bus };

export default function Vehicles() {
  const toast = useToast();
  const loc = useLocation();
  const [list, setList] = useState(null);
  const [f, setF] = useState({ plate: '', type: 'car' });
  const [del, setDel] = useState(null);
  const [delBusy, setDelBusy] = useState(false);
  const { busy, error, run } = useAsync();
  const load = useCallback(() => api('/me/vehicles').then(setList).catch(() => setList([])), []);
  useEffect(() => { load(); }, [load]);

  const add = (e) => {
    e.preventDefault();
    run(async () => {
      const v = await api('/me/vehicles', { method: 'POST', body: f });
      toast(`${v.plate_number} added`);
      setF({ plate: '', type: f.type });
      load();
    });
  };
  const remove = async () => {
    setDelBusy(true);
    try { await api(`/me/vehicles/${del.id}`, { method: 'DELETE' }); toast('Vehicle removed'); load(); } catch (e) { toast(e.message, 'error'); } finally { setDelBusy(false); setDel(null); }
  };

  return (
    <div className="page">
      <div className="page-head"><div><span className="eyebrow">Driver portal</span><h1>My vehicles</h1><p>Reservations and passes are linked to a registered vehicle.</p></div></div>
      {loc.state && loc.state.welcome && <Alert type="ok">Welcome to ParkSmart! Add your vehicle to start reserving slots.</Alert>}
      <div className="grid grid-2">
        <form className="glass card stack" onSubmit={add}>
          <h3>Add a vehicle</h3>
          <Alert>{error}</Alert>
          <Field label="Number plate" hint='Bangladeshi style, e.g. "Sylhet Metro-Ga 11-2345"' htmlFor="v-plate"><input id="v-plate" className="input" value={f.plate} onChange={(e) => setF({ ...f, plate: e.target.value })} required /></Field>
          <div className="field">
            <span className="label">Vehicle type</span>
            <div className="type-picker">
              {VEHICLE_ORDER.map((t) => {
                const I = ICON[t];
                return <button key={t} type="button" className={`btn type-btn ${f.type === t ? 'is-on' : ''}`} aria-pressed={f.type === t} onClick={() => setF({ ...f, type: t })}><I size={20} /><span>{VEHICLE_LABELS[t]}</span></button>;
              })}
            </div>
          </div>
          <Button type="submit" className="btn-primary" busy={busy}><Plus size={16} /><span>Add vehicle</span></Button>
        </form>
        <div className="glass card stack">
          <h3>Registered vehicles</h3>
          {!list ? <Loading /> : list.length === 0 ? <p className="muted">No vehicles yet.</p> : list.map((v) => {
            const I = ICON[v.type];
            return (
              <div key={v.id} className="list-item">
                <div className="row"><I size={20} color="#a86f2c" /><div><b>{v.plate_number}</b><div className="small muted">{VEHICLE_LABELS[v.type]} · added {fmtDate(v.created_at)}</div></div></div>
                <button type="button" className="btn btn-sm" onClick={() => setDel(v)}><Trash2 size={14} /><span>Remove</span></button>
              </div>
            );
          })}
        </div>
      </div>
      {del && <Confirm title={`Remove ${del.plate_number}?`} message="The vehicle is unlinked from your account. Past history stays on record." confirmLabel="Remove" danger busy={delBusy} onConfirm={remove} onClose={() => setDel(null)} />}
    </div>
  );
}
