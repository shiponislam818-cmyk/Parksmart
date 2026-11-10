import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Ticket } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useFacility } from '../lib/useFacility';
import { useLiveSlots } from '../lib/socket';
import { bdt, fmtDateTime, fmtMinutes, VEHICLE_LABELS } from '../lib/format';
import { Alert, Loading, StatusBadge, Tabs } from '../components/ui';

/** Parked vehicles and recent sessions (helps operators find a vehicle, reprint a ticket). */
export default function Sessions() {
  const { facilities } = useFacility();
  const [status, setStatus] = useState('open');
  const [facilityId, setFacilityId] = useState('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setRows(await api(`/sessions${qs({ status: status === 'all' ? '' : status, facility_id: facilityId, q: query, limit: 200 })}`));
      setError('');
    } catch (e) { setError(e.message); }
  }, [status, facilityId, query]);
  useEffect(() => { load(); }, [load]);
  useLiveSlots(() => load(), load);

  return (
    <div className="page">
      <div className="page-head">
        <div><span className="eyebrow">Operations</span><h1>Parking sessions</h1><p>Vehicles currently parked and recent visits</p></div>
      </div>
      <div className="glass card stack">
        <div className="row between">
          <Tabs value={status} onChange={setStatus} tabs={[{ value: 'open', label: 'Parked now' }, { value: 'closed', label: 'Exited' }, { value: 'all', label: 'All' }]} />
          <form className="row" onSubmit={(e) => { e.preventDefault(); setQuery(q); }}>
            <select className="input" style={{ width: 'auto' }} aria-label="Facility" value={facilityId} onChange={(e) => setFacilityId(e.target.value)}>
              <option value="">All facilities</option>
              {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <input className="input" style={{ width: 200 }} aria-label="Search plate" placeholder="Search plate…" value={q} onChange={(e) => setQ(e.target.value)} />
            <button type="submit" className="btn"><Search size={16} /><span>Search</span></button>
          </form>
        </div>
        <Alert onRetry={load}>{error}</Alert>
        {!rows && !error ? <Loading /> : rows && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Plate</th><th>Type</th><th>Facility · Slot</th><th>Entry</th><th>Exit / Duration</th><th>Status</th><th className="right">Fee</th><th /></tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={8} className="empty">No sessions match.</td></tr>}
                {rows.map((s) => {
                  const mins = Math.ceil(((s.exit_time ? new Date(s.exit_time) : new Date()) - new Date(s.entry_time)) / 60000);
                  return (
                    <tr key={s.id}>
                      <td><b>{s.plate}</b>{s.is_lost_ticket && <span className="badge b-pending plain" style={{ marginLeft: 6 }}>Lost ticket</span>}</td>
                      <td>{VEHICLE_LABELS[s.vehicle_type]}</td>
                      <td>{s.facility} · {s.zone} · <b>{s.slot}</b></td>
                      <td className="nowrap">{fmtDateTime(s.entry_time)}</td>
                      <td className="nowrap">{s.exit_time ? fmtDateTime(s.exit_time) : 'Still parked'} <span className="muted small">({fmtMinutes(mins)})</span></td>
                      <td><StatusBadge status={s.status} label={s.status === 'open' ? 'Parked' : 'Exited'} /></td>
                      <td className="right">{s.fee !== null ? bdt(s.fee) : '—'}</td>
                      <td>{s.status === 'open' && <Link className="btn btn-sm" to={`/ticket/${s.id}`}><Ticket size={14} /><span>Ticket</span></Link>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
