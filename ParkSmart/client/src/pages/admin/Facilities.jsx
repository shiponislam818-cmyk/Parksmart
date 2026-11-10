import { useCallback, useEffect, useState } from 'react';
import { Building2, Pencil, Plus, Trash2, Layers } from 'lucide-react';
import { api } from '../../lib/api';
import { VEHICLE_LABELS } from '../../lib/format';
import { Alert, Button, Confirm, Field, Loading, Modal, StatusBadge, Switch, useAsync, useToast } from '../../components/ui';

/** UC-04: configure facilities, zones and slots (FR-SLOT-01..03, 08) */
export default function Facilities() {
  const toast = useToast();
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const [selId, setSelId] = useState(null);
  const [edit, setEdit] = useState(null); // facility form state

  const load = useCallback(async () => {
    try {
      const l = await api('/facilities?all=1');
      setList(l);
      setSelId((cur) => (l.some((f) => f.id === cur) ? cur : (l[0] && l[0].id)));
      setError('');
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggle = async (f) => {
    try {
      await api(`/facilities/${f.id}/active`, { method: 'PATCH', body: { is_active: !f.is_active } });
      toast(`${f.name} ${f.is_active ? 'deactivated' : 'activated'}`);
      load();
    } catch (e) { toast(e.message, 'error'); }
  };

  const sel = list && list.find((f) => f.id === selId);
  return (
    <div className="page">
      <div className="page-head">
        <div><span className="eyebrow">Setup</span><h1>Facilities & slots</h1><p>Create facilities, floors/zones and numbered slots</p></div>
        <div className="page-actions"><button type="button" className="btn btn-primary" onClick={() => setEdit({ name: '', address: '', opening_hours: '24 hours' })}><Plus size={16} /><span>New facility</span></button></div>
      </div>
      <Alert onRetry={load}>{error}</Alert>
      {!list ? <Loading /> : (
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 340px) minmax(0, 1fr)' }} data-resp="fac">
          <div className="glass card stack">
            <h3><Building2 size={18} style={{ verticalAlign: -3 }} /> Facilities</h3>
            {list.length === 0 && <p className="muted">No facilities yet.</p>}
            <div className="list">
              {list.map((f) => (
                <div key={f.id} className="list-item" style={{ cursor: 'pointer', outline: f.id === selId ? '2px solid rgba(168,111,44,.5)' : 'none' }} onClick={() => setSelId(f.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setSelId(f.id)}>
                  <div style={{ minWidth: 0 }}>
                    <b>{f.name}</b>
                    <div className="small muted">{f.zone_count} zones · {f.slot_count} slots · {f.opening_hours}</div>
                  </div>
                  <div className="row" style={{ gap: 6 }} onClick={(e) => e.stopPropagation()}>
                    <StatusBadge status={f.is_active ? 'active' : 'inactive'} label={f.is_active ? 'Active' : 'Inactive'} />
                    <Switch on={f.is_active} label={`${f.is_active ? 'Deactivate' : 'Activate'} ${f.name}`} onChange={() => toggle(f)} />
                    <button type="button" className="btn btn-sm btn-icon" aria-label={`Edit ${f.name}`} onClick={() => setEdit({ ...f })}><Pencil size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {sel ? <FacilityDetail key={sel.id} facility={sel} onChanged={load} /> : <div />}
        </div>
      )}
      {edit && <FacilityForm initial={edit} onClose={() => setEdit(null)} onSaved={(f) => { setEdit(null); load(); setSelId(f.id); toast('Facility saved'); }} />}
      <style>{'@media (max-width: 900px){[data-resp="fac"]{grid-template-columns:minmax(0,1fr) !important;}}'}</style>
    </div>
  );
}

function FacilityForm({ initial, onClose, onSaved }) {
  const [f, setF] = useState(initial);
  const { busy, error, run } = useAsync();
  const save = (e) => {
    e.preventDefault();
    run(async () => {
      const body = { name: f.name, address: f.address, opening_hours: f.opening_hours };
      const saved = f.id ? await api(`/facilities/${f.id}`, { method: 'PUT', body }) : await api('/facilities', { method: 'POST', body });
      onSaved(saved);
    });
  };
  return (
    <Modal title={f.id ? 'Edit facility' : 'New facility'} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <Alert>{error}</Alert>
        <Field label="Name" htmlFor="f-name"><input id="f-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
        <Field label="Address" htmlFor="f-addr"><input id="f-addr" className="input" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        <Field label="Opening hours" htmlFor="f-hours"><input id="f-hours" className="input" value={f.opening_hours} onChange={(e) => setF({ ...f, opening_hours: e.target.value })} placeholder="8:00 AM – 11:00 PM" /></Field>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <Button type="submit" className="btn-primary" busy={busy}><span>Save facility</span></Button>
        </div>
      </form>
    </Modal>
  );
}

function FacilityDetail({ facility, onChanged }) {
  const toast = useToast();
  const [zones, setZones] = useState(null);
  const [slots, setSlots] = useState([]);
  const [error, setError] = useState('');
  const [zoneForm, setZoneForm] = useState(null);
  const [slotForm, setSlotForm] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [z, s] = await Promise.all([api(`/facilities/${facility.id}/zones`), api(`/facilities/${facility.id}/slots`)]);
      setZones(z); setSlots(s); setError('');
    } catch (e) { setError(e.message); }
  }, [facility.id]);
  useEffect(() => { load(); }, [load]);

  const doDelete = async () => {
    setBusy(true);
    try {
      await api(confirm.kind === 'zone' ? `/zones/${confirm.item.id}` : `/slots/${confirm.item.id}`, { method: 'DELETE' });
      toast(`${confirm.kind === 'zone' ? 'Zone' : 'Slot'} deleted`);
      setConfirm(null);
      load(); onChanged();
    } catch (e) { toast(e.message, 'error'); setConfirm(null); } finally { setBusy(false); }
  };

  return (
    <div className="stack">
      <div className="glass card">
        <div className="card-head">
          <div><h2>{facility.name}</h2><p className="muted small">{facility.address || 'No address'} · {facility.opening_hours}</p></div>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setZoneForm({ label: '', sort_order: (zones ? zones.length : 0) + 1 })}><Layers size={15} /><span>Add zone / floor</span></button>
        </div>
        <p className="small muted">Entry assigns the free slot with the lowest zone order, then lowest sequence number.</p>
      </div>
      <Alert onRetry={load}>{error}</Alert>
      {!zones ? <Loading /> : zones.length === 0 ? <Alert type="info">No zones yet. Add a floor or zone to start creating slots.</Alert> : zones.map((z) => {
        const zs = slots.filter((s) => s.zone_id === z.id);
        return (
          <div key={z.id} className="glass card">
            <div className="card-head">
              <h3>{z.label} <span className="badge b-neutral plain">order {z.sort_order}</span> <span className="muted small">{zs.length} slots</span></h3>
              <div className="row" style={{ gap: 6 }}>
                <button type="button" className="btn btn-sm" onClick={() => setSlotForm({ zone: z, mode: 'bulk', prefix: '', from: 1, to: 10, pad: 2, vehicle_type: 'car', code: '' })}><Plus size={14} /><span>Add slots</span></button>
                <button type="button" className="btn btn-sm btn-icon" aria-label={`Edit zone ${z.label}`} onClick={() => setZoneForm({ ...z })}><Pencil size={14} /></button>
                <button type="button" className="btn btn-sm btn-icon" aria-label={`Delete zone ${z.label}`} onClick={() => setConfirm({ kind: 'zone', item: z })}><Trash2 size={14} /></button>
              </div>
            </div>
            {zs.length === 0 ? <p className="muted small">No slots in this zone.</p> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Seq</th><th>Code</th><th>Vehicle type</th><th>Status</th><th /></tr></thead>
                  <tbody>
                    {zs.map((s) => (
                      <tr key={s.id}>
                        <td className="muted">{s.sequence_no}</td>
                        <td><b>{s.code}</b></td>
                        <td>{VEHICLE_LABELS[s.vehicle_type]}</td>
                        <td><StatusBadge status={s.status} /></td>
                        <td className="right nowrap">
                          <button type="button" className="btn btn-sm btn-icon" aria-label={`Edit slot ${s.code}`} onClick={() => setSlotForm({ zone: z, mode: 'edit', id: s.id, code: s.code, vehicle_type: s.vehicle_type, sequence_no: s.sequence_no })}><Pencil size={14} /></button>{' '}
                          <button type="button" className="btn btn-sm btn-icon" aria-label={`Delete slot ${s.code}`} onClick={() => setConfirm({ kind: 'slot', item: s })}><Trash2 size={14} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
      {zoneForm && <ZoneForm facilityId={facility.id} initial={zoneForm} onClose={() => setZoneForm(null)} onSaved={() => { setZoneForm(null); load(); onChanged(); toast('Zone saved'); }} />}
      {slotForm && <SlotForm initial={slotForm} onClose={() => setSlotForm(null)} onSaved={(n) => { setSlotForm(null); load(); onChanged(); toast(n ? `${n} slot(s) created` : 'Slot saved'); }} />}
      {confirm && (
        <Confirm
          title={`Delete ${confirm.kind} ${confirm.kind === 'zone' ? confirm.item.label : confirm.item.code}?`}
          message={confirm.kind === 'zone' ? 'All slots in this zone will be removed. Zones with parked vehicles or active reservations cannot be deleted.' : 'Slots with a parked vehicle or an active reservation cannot be deleted.'}
          confirmLabel="Delete" danger busy={busy} onConfirm={doDelete} onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

function ZoneForm({ facilityId, initial, onClose, onSaved }) {
  const [f, setF] = useState(initial);
  const { busy, error, run } = useAsync();
  const save = (e) => {
    e.preventDefault();
    run(async () => {
      const body = { label: f.label, sort_order: Number(f.sort_order) };
      if (f.id) await api(`/zones/${f.id}`, { method: 'PUT', body });
      else await api(`/facilities/${facilityId}/zones`, { method: 'POST', body });
      onSaved();
    });
  };
  return (
    <Modal title={f.id ? 'Edit zone' : 'New zone / floor'} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <Alert>{error}</Alert>
        <Field label="Label" htmlFor="z-label"><input id="z-label" className="input" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="Level 1" required /></Field>
        <Field label="Order (lower = nearer the gate)" htmlFor="z-order"><input id="z-order" className="input" type="number" min="0" value={f.sort_order} onChange={(e) => setF({ ...f, sort_order: e.target.value })} required /></Field>
        <div className="modal-foot"><button type="button" className="btn" onClick={onClose}>Cancel</button><Button type="submit" className="btn-primary" busy={busy}><span>Save zone</span></Button></div>
      </form>
    </Modal>
  );
}

function SlotForm({ initial, onClose, onSaved }) {
  const [f, setF] = useState(initial);
  const { busy, error, run } = useAsync();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const preview = f.mode === 'bulk' && f.prefix !== undefined
    ? `${(f.prefix || '').toUpperCase()}${String(f.from).padStart(Number(f.pad) || 1, '0')} … ${(f.prefix || '').toUpperCase()}${String(f.to).padStart(Number(f.pad) || 1, '0')}`
    : '';
  const save = (e) => {
    e.preventDefault();
    run(async () => {
      if (f.mode === 'edit') {
        await api(`/slots/${f.id}`, { method: 'PUT', body: { code: f.code, vehicle_type: f.vehicle_type, sequence_no: Number(f.sequence_no) } });
        onSaved(0);
      } else if (f.mode === 'bulk') {
        const r = await api(`/zones/${f.zone.id}/slots`, { method: 'POST', body: { mode: 'bulk', prefix: f.prefix, from: Number(f.from), to: Number(f.to), pad: Number(f.pad), vehicle_type: f.vehicle_type } });
        onSaved(r.length);
      } else {
        const r = await api(`/zones/${f.zone.id}/slots`, { method: 'POST', body: { code: f.code, vehicle_type: f.vehicle_type } });
        onSaved(r.length);
      }
    });
  };
  return (
    <Modal title={f.mode === 'edit' ? `Edit slot ${initial.code}` : `Add slots to ${f.zone.label}`} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        {f.mode !== 'edit' && (
          <div className="tabs">
            <button type="button" className={`tab ${f.mode === 'bulk' ? 'active' : ''}`} onClick={() => setF({ ...f, mode: 'bulk' })}>Bulk range</button>
            <button type="button" className={`tab ${f.mode === 'single' ? 'active' : ''}`} onClick={() => setF({ ...f, mode: 'single' })}>Single slot</button>
          </div>
        )}
        <Alert>{error}</Alert>
        {f.mode === 'bulk' ? (
          <div className="form-grid">
            <Field label="Code prefix" htmlFor="s-prefix"><input id="s-prefix" className="input" value={f.prefix} onChange={set('prefix')} placeholder="A-" required /></Field>
            <Field label="From" htmlFor="s-from"><input id="s-from" className="input" type="number" min="0" value={f.from} onChange={set('from')} required /></Field>
            <Field label="To" htmlFor="s-to"><input id="s-to" className="input" type="number" min="0" value={f.to} onChange={set('to')} required /></Field>
            <Field label="Digits" htmlFor="s-pad"><input id="s-pad" className="input" type="number" min="1" max="4" value={f.pad} onChange={set('pad')} /></Field>
          </div>
        ) : (
          <div className="form-grid">
            <Field label="Slot code" htmlFor="s-code"><input id="s-code" className="input" value={f.code} onChange={set('code')} placeholder="A-41" required /></Field>
            {f.mode === 'edit' && <Field label="Sequence no." htmlFor="s-seq"><input id="s-seq" className="input" type="number" min="0" value={f.sequence_no} onChange={set('sequence_no')} /></Field>}
          </div>
        )}
        <Field label="Vehicle type" htmlFor="s-type">
          <select id="s-type" className="input" value={f.vehicle_type} onChange={set('vehicle_type')}>
            {Object.entries(VEHICLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        {preview && <p className="small muted">Will create: <b>{preview}</b> ({Math.max(0, Number(f.to) - Number(f.from) + 1)} slots)</p>}
        <div className="modal-foot"><button type="button" className="btn" onClick={onClose}>Cancel</button><Button type="submit" className="btn-primary" busy={busy}><span>{f.mode === 'edit' ? 'Save slot' : 'Create'}</span></Button></div>
      </form>
    </Modal>
  );
}
