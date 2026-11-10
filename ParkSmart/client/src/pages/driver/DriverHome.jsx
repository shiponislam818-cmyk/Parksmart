import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BellRing, CalendarClock, Car, BadgeCheck } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fmtDate, fmtDateTime, fmtTime } from '../../lib/format';
import Availability from '../../components/Availability';
import { StatusBadge } from '../../components/ui';

/** UI-04: driver portal home */
export default function DriverHome() {
  const { user } = useAuth();
  const [passes, setPasses] = useState([]);
  const [resv, setResv] = useState([]);
  const [vehicles, setVehicles] = useState(null);
  useEffect(() => {
    api('/me/passes').then(setPasses).catch(() => {});
    api('/me/reservations').then(setResv).catch(() => {});
    api('/me/vehicles').then(setVehicles).catch(() => {});
  }, []);
  const due = passes.filter((p) => p.renewal_due);
  const active = passes.filter((p) => p.status === 'active');
  const upcoming = resv.filter((r) => ['booked', 'active'].includes(r.status));

  return (
    <div className="page">
      <div className="page-head">
        <div><span className="eyebrow">Driver portal</span><h1>Hello, {user.name.split(' ')[0]}</h1><p>Check free slots, reserve ahead and manage your monthly pass.</p></div>
        <div className="page-actions"><Link className="btn btn-primary" to="/driver/reserve"><CalendarClock size={16} /><span>Reserve a slot</span></Link></div>
      </div>
      {/* FR-RES-07: renewal reminder on the dashboard */}
      {due.map((p) => (
        <div key={p.id} className="alert alert-warn">
          <BellRing size={18} />
          <span style={{ flex: 1 }}>Your monthly pass for <b>{p.plate_number}</b> at {p.facility_name} expires on <b>{fmtDate(p.end_date)}</b> ({p.days_left} day{p.days_left === 1 ? '' : 's'} left).</span>
          <Link className="btn btn-sm btn-primary" to="/driver/passes"><span>Renew</span></Link>
        </div>
      ))}
      {vehicles && vehicles.length === 0 && (
        <div className="alert alert-info"><Car size={18} /><span style={{ flex: 1 }}>Add your vehicle first — reservations and passes are linked to a registered vehicle.</span><Link className="btn btn-sm" to="/driver/vehicles"><span>Add vehicle</span></Link></div>
      )}
      <div className="grid grid-2">
        <Availability />
        <div className="stack">
          <div className="glass card stack">
            <div className="card-head" style={{ marginBottom: 0 }}><h3>Upcoming reservations</h3><Link to="/driver/reserve">Manage →</Link></div>
            {upcoming.length === 0 ? <p className="muted small">No upcoming reservations.</p> : upcoming.slice(0, 4).map((r) => (
              <div key={r.id} className="list-item">
                <div><b>{r.facility_name}</b> · {r.zone_label} {r.slot_code}<div className="small muted">{r.plate_number} · {fmtDateTime(r.start_time)} – {fmtTime(r.end_time)}</div></div>
                <StatusBadge status={r.status} label={r.status === 'active' ? 'Slot held' : 'Booked'} />
              </div>
            ))}
          </div>
          <div className="glass card stack">
            <div className="card-head" style={{ marginBottom: 0 }}><h3><BadgeCheck size={18} style={{ verticalAlign: -3 }} /> My monthly pass</h3><Link to="/driver/passes">Manage →</Link></div>
            {active.length === 0 ? <p className="muted small">No active pass. A pass waives per-visit fees at one facility for a month.</p> : active.map((p) => (
              <div key={p.id} className="list-item">
                <div><b>Active until {fmtDate(p.end_date)}</b><div className="small muted">{p.plate_number} · {p.facility_name}</div></div>
                <span className="small muted">Renewal reminder 3 days before expiry</span>
              </div>
            ))}
          </div>
          <details className="help">
            <summary>How ParkSmart works for drivers</summary>
            <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              <li>Register your vehicle under <b>My vehicles</b>.</li>
              <li>Reserve a slot for a time window. The slot is held for the configured hold period after the start time, then released if you have not arrived.</li>
              <li>At the gate, the operator types your plate — your reserved slot is assigned automatically.</li>
              <li>With a valid monthly pass, exits at that facility cost BDT 0.</li>
              <li>Receipts for every visit and pass are under <b>History & receipts</b>.</li>
            </ul>
          </details>
        </div>
      </div>
    </div>
  );
}
