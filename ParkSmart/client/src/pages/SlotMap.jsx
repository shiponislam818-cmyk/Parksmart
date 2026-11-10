import { useCallback, useEffect, useMemo, useState } from 'react';
import { Wrench, RotateCcw } from 'lucide-react';
import { api } from '../lib/api';
import { useFacility } from '../lib/useFacility';
import { useLiveSlots } from '../lib/socket';
import { fmtDateTime, fmtTime, STATUS_LABELS, VEHICLE_LABELS } from '../lib/format';
import { Alert, Button, Field, Loading, Modal, StatusBadge, Tabs, useAsync, useToast } from '../components/ui';

const STATUSES = ['free', 'occupied', 'reserved', 'out_of_service'];

/** UI-02 / FR-SLOT-05..07: live, colour-coded slot map with a text label on every slot. */
export default function SlotMap() {
  const { facilities, facility, facilityId, setFacilityId, error: facError } = useFacility();
  const [slots, setSlots] = useState(null);
  const [error, setError] = useState('');
  const [zone, setZone] = useState('all');
  const [typeFilter, setTypeFilter] = useState('');
  const [flash, setFlash] = useState({});
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    if (!facilityId) return;
    try {
      setSlots(await api(`/facilities/${facilityId}/slots`));
      setError('');
    } catch (e) { setError(e.message); }
  }, [facilityId]);
  useEffect(() => { setSlots(null); setZone('all'); load(); }, [load]);

  const connected = useLiveSlots((u) => {
    if (u.facility_id !== facilityId) return;
    setSlots((list) => list && list.map((s) => (s.id === u.id ? { ...s, status: u.status, out_of_service_reason: u.out_of_service_reason } : s)));
    setFlash((f) => ({ ...f, [u.id]: Date.now() }));
    // plate / session details come from the API, refresh them quietly
    load();
  }, load);

  const zones = useMemo(() => {
    const m = new Map();
    for (const s of slots || []) if (!m.has(s.zone_id)) m.set(s.zone_id, { id: s.zone_id, label: s.zone_label });
    return [...m.values()];
  }, [slots]);

  const visible = (slots || []).filter((s) => (zone === 'all' || s.zone_id === Number(zone)) && (!typeFilter || s.vehicle_type === typeFilter));
  const occupied = visible.filter((s) => s.status === 'occupied').length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow">Live slot map</span>
          <h1>{facility ? facility.name : 'Slot map'}</h1>
          <p>{visible.length} slots · {occupied} occupied ({visible.length ? Math.round((occupied / visible.length) * 100) : 0}%) · <span className={`dot ${connected ? '' : 'off'}`} /> {connected ? 'updates live' : 'reconnecting…'}</p>
        </div>
        <div className="page-actions">
          <Field label="Facility" htmlFor="map-fac">
            <select id="map-fac" className="input" value={facilityId || ''} onChange={(e) => setFacilityId(Number(e.target.value))}>
              {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </Field>
          <Field label="Vehicle type" htmlFor="map-type">
            <select id="map-type" className="input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">All types</option>
              {Object.entries(VEHICLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
        </div>
      </div>
      <Alert>{facError || error}</Alert>
      {zones.length > 0 && (
        <Tabs value={String(zone)} onChange={setZone} tabs={[{ value: 'all', label: 'All zones' }, ...zones.map((z) => ({ value: String(z.id), label: z.label }))]} />
      )}
      {!slots && !error && <Loading />}
      {slots && slots.length === 0 && <Alert type="info">This facility has no slots yet. An administrator can add them under Facilities & slots.</Alert>}
      {zones.filter((z) => zone === 'all' || z.id === Number(zone)).map((z) => {
        const zs = visible.filter((s) => s.zone_id === z.id);
        if (!zs.length) return null;
        return (
          <section key={z.id} className="glass card fade-in">
            <div className="card-head">
              <h2>{z.label}</h2>
              <span className="muted small">{zs.filter((s) => s.status === 'free').length} free of {zs.length}</span>
            </div>
            <div className="slot-grid">
              {zs.map((s) => (
                <button
                  key={`${s.id}-${flash[s.id] || 0}`}
                  type="button"
                  className={`slot s-${s.status} ${flash[s.id] ? 'flash' : ''}`}
                  style={{ border: 0 }}
                  onClick={() => setSelected(s.id)}
                  title={`${s.code} · ${VEHICLE_LABELS[s.vehicle_type]} · ${STATUS_LABELS[s.status]}`}
                >
                  <b>{s.code}</b>
                  <span>{s.status === 'out_of_service' ? 'Out' : STATUS_LABELS[s.status]}</span>
                  <small>{s.plate_number || VEHICLE_LABELS[s.vehicle_type]}</small>
                </button>
              ))}
            </div>
          </section>
        );
      })}
      <div className="glass card legend">
        <b>Legend:</b>
        {STATUSES.map((s) => <StatusBadge key={s} status={s} />)}
        <span className="muted">· every slot shows its status word as well as its colour</span>
      </div>
      {selected && <SlotDetail id={selected} onClose={() => setSelected(null)} onChanged={load} />}
    </div>
  );
}

function SlotDetail({ id, onClose, onChanged }) {
  const toast = useToast();
  const [s, setS] = useState(null);
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAsync();

  const load = useCallback(() => run(async () => setS(await api(`/slots/${id}`))), [id, run]);
  useEffect(() => { load(); }, [load]);

  const setService = (outOfService) => run(async () => {
    await api(`/slots/${id}/service`, { method: 'PATCH', body: { out_of_service: outOfService, reason } });
    toast(outOfService ? `Slot ${s.code} marked Out of Service` : `Slot ${s.code} restored to Free`);
    onChanged();
    onClose();
  });

  return (
    <Modal title={s ? `Slot ${s.code}` : 'Slot'} onClose={onClose}>
      {!s ? (error ? <Alert>{error}</Alert> : <Loading />) : (
        <div className="stack">
          <dl className="kv">
            <dt>Status</dt><dd><StatusBadge status={s.status} /></dd>
            <dt>Zone</dt><dd>{s.facility_name} · {s.zone_label}</dd>
            <dt>Vehicle type</dt><dd>{VEHICLE_LABELS[s.vehicle_type]}</dd>
            {s.out_of_service_reason && <><dt>Reason</dt><dd>{s.out_of_service_reason}</dd></>}
            {s.session && <><dt>Parked</dt><dd>{s.session.plate_number}</dd><dt>Since</dt><dd>{fmtDateTime(s.session.entry_time)}</dd></>}
          </dl>
          {s.reservations.length > 0 && (
            <div>
              <div className="label" style={{ marginBottom: 6 }}>Reservations</div>
              {s.reservations.map((r) => (
                <div key={r.id} className="list-item small">
                  <span>{r.plate_number}</span>
                  <span>{fmtDateTime(r.start_time)} – {fmtTime(r.end_time)}</span>
                  <StatusBadge status={r.status} />
                </div>
              ))}
            </div>
          )}
          <Alert>{error}</Alert>
          {s.status === 'free' && (
            <div className="stack" style={{ gap: 8 }}>
              <Field label="Reason for taking it out of service" htmlFor="oos-reason">
                <input id="oos-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Water leak, pillar repair" />
              </Field>
              <Button className="btn-dark" busy={busy} disabled={!reason.trim()} onClick={() => setService(true)}><Wrench size={16} /><span>Mark Out of Service</span></Button>
            </div>
          )}
          {s.status === 'out_of_service' && (
            <Button className="btn-success" busy={busy} onClick={() => setService(false)}><RotateCcw size={16} /><span>Restore to Free</span></Button>
          )}
          {(s.status === 'occupied' || s.status === 'reserved') && (
            <p className="small muted">Occupied or reserved slots cannot be taken out of service mid-stay.</p>
          )}
        </div>
      )}
    </Modal>
  );
}
