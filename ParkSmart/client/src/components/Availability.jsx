import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useLiveSlots } from '../lib/socket';
import { VEHICLE_LABELS, VEHICLE_ORDER } from '../lib/format';
import { Alert, Loading } from './ui';

/** FR-RES-01: live availability per facility and vehicle type */
export default function Availability() {
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try { setList(await api('/availability')); setError(''); } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const live = useLiveSlots(() => load(), load);

  return (
    <div className="glass card stack">
      <div className="card-head" style={{ marginBottom: 0 }}>
        <h3>Live availability</h3>
        <span className="small muted"><span className={`dot ${live ? '' : 'off'}`} /> {live ? 'updates live' : 'reconnecting…'}</span>
      </div>
      <Alert onRetry={load}>{error}</Alert>
      {!list && !error && <Loading />}
      {list && list.length === 0 && <p className="muted">No facilities are open right now.</p>}
      {list && list.map((f) => (
        <div key={f.facility_id} className="list-item" style={{ display: 'block' }}>
          <div className="row between"><b>{f.name}</b><span className="small muted">{f.opening_hours}</span></div>
          <div className="small muted" style={{ marginBottom: 8 }}>{f.address}</div>
          <div className="row" style={{ alignItems: 'stretch' }}>
            {VEHICLE_ORDER.filter((t) => f.types[t]).map((t) => (
              <div key={t} className={`avail-type ${f.types[t].free > 0 ? 'some' : 'none'}`}>
                <b>{f.types[t].free}</b>
                <span className="small">{VEHICLE_LABELS[t]} free</span>
                <div className="small muted">of {f.types[t].total}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
