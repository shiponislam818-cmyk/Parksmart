import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck, XCircle } from 'lucide-react';
import { api } from '../../lib/api';
import { fmtDateTime, fmtTime, fromDhakaInput, toDhakaInput, VEHICLE_LABELS } from '../../lib/format';
import { Alert, Button, Confirm, Field, Loading, StatusBadge, useAsync, useToast } from '../../components/ui';

/** UC-08: reserve a slot (FR-RES-02..05) */
export default function Reserve() {
  const toast = useToast();
  const [vehicles, setVehicles] = useState(null);
  const [facilities, setFacilities] = useState([]);
  const [settings, setSettings] = useState(null);
  const [list, setList] = useState(null);
  const [cancel, setCancel] = useState(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const start = new Date(Date.now() + 60 * 60000);
  start.setMinutes(0, 0, 0);
  const [f, setF] = useState({ vehicle_id: '', facility_id: '', from: toDhakaInput(start), to: toDhakaInput(new Date(start.getTime() + 3 * 3600000)) });
  const { busy, error, run } = useAsync();

  const loadList = useCallback(() => api('/me/reservations').then(setList).catch(() => setList([])), []);
  useEffect(() => {
    api('/me/vehicles').then((v) => { setVehicles(v); if (v[0]) setF((x) => ({ ...x, vehicle_id: x.vehicle_id || String(v[0].id) })); });
    api('/facilities').then((l) => { setFacilities(l); if (l[0]) setF((x) => ({ ...x, facility_id: x.facility_id || String(l[0].id) })); });
    api('/settings').then(setSettings).catch(() => {});
    loadList();
  }, [loadList]);

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      const r = await api('/me/reservations', {
        method: 'POST',
        body: { vehicle_id: Number(f.vehicle_id), facility_id: Number(f.facility_id), start_time: fromDhakaInput(f.from), end_time: fromDhakaInput(f.to) },
      });
      toast(`Reserved ${r.zone_label} · ${r.slot_code} at ${r.facility_name}`);
      loadList();
    });
  };

  const doCancel = async () => {
    setCancelBusy(true);
    try {
      await api(`/me/reservations/${cancel.id}/cancel`, { method: 'POST' });
      toast('Reservation cancelled');
      loadList();
    } catch (e) { toast(e.message, 'error'); } finally { setCancelBusy(false); setCancel(null); }
  };

  return (
    <div className="page">
      <div className="page-head"><div><span className="eyebrow">Driver portal</span><h1>Reservations</h1><p>Reserve a slot for a time window at any facility.</p></div></div>
      <div className="grid grid-2">
        <form className="glass card stack" onSubmit={submit}>
          <h3>Reserve a slot</h3>
          {vehicles && vehicles.length === 0 && <Alert type="info">You have no registered vehicle. <Link to="/driver/vehicles">Add one first.</Link></Alert>}
          <Alert>{error}</Alert>
          <Field label="Vehicle" htmlFor="rs-veh">
            <select id="rs-veh" className="input" value={f.vehicle_id} onChange={(e) => setF({ ...f, vehicle_id: e.target.value })} required>
              {(vehicles || []).map((v) => <option key={v.id} value={v.id}>{v.plate_number} ({VEHICLE_LABELS[v.type]})</option>)}
            </select>
          </Field>
          <Field label="Facility" htmlFor="rs-fac">
            <select id="rs-fac" className="input" value={f.facility_id} onChange={(e) => setF({ ...f, facility_id: e.target.value })} required>
              {facilities.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.opening_hours}</option>)}
            </select>
          </Field>
          <div className="form-grid">
            <Field label="From" htmlFor="rs-from"><input id="rs-from" className="input" type="datetime-local" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} required /></Field>
            <Field label="To" htmlFor="rs-to"><input id="rs-to" className="input" type="datetime-local" value={f.to} min={f.from} onChange={(e) => setF({ ...f, to: e.target.value })} required /></Field>
          </div>
          {settings && <p className="small muted">Slot held {settings.reservation_hold_minutes} min after the start time, then released. Max {settings.reservation_max_hours} h, up to {settings.reservation_advance_days} days ahead. Reservations are free; normal hourly rates apply when you park.</p>}
          <Button type="submit" className="btn-primary btn-lg" busy={busy} disabled={!vehicles || vehicles.length === 0}><CalendarCheck size={18} /><span>Reserve</span></Button>
        </form>
        <div className="glass card stack">
          <h3>My reservations</h3>
          {!list ? <Loading /> : list.length === 0 ? <p className="muted">No reservations yet.</p> : list.map((r) => (
            <div key={r.id} className="list-item">
              <div style={{ minWidth: 0 }}>
                <b>{r.facility_name}</b> · {r.zone_label} <b>{r.slot_code}</b>
                <div className="small muted">{r.plate_number} · {fmtDateTime(r.start_time)} – {fmtTime(r.end_time)}</div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <StatusBadge status={r.status} label={{ booked: 'Booked', active: 'Slot held', fulfilled: 'Used', expired: 'Expired', cancelled: 'Cancelled' }[r.status]} />
                {['booked', 'active'].includes(r.status) && <button type="button" className="btn btn-sm" onClick={() => setCancel(r)}><XCircle size={14} /><span>Cancel</span></button>}
              </div>
            </div>
          ))}
        </div>
      </div>
      {cancel && <Confirm title="Cancel reservation?" message={`${cancel.facility_name} slot ${cancel.slot_code}, ${fmtDateTime(cancel.start_time)}. The slot will be released.`} confirmLabel="Cancel reservation" danger busy={cancelBusy} onConfirm={doCancel} onClose={() => setCancel(null)} />}
    </div>
  );
}
