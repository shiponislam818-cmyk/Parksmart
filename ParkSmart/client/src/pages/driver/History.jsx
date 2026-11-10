import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Receipt } from 'lucide-react';
import { api, download } from '../../lib/api';
import { bdt, fmtDate, fmtDateTime, fmtMinutes, METHOD_LABELS, VEHICLE_LABELS } from '../../lib/format';
import { Alert, Loading, StatusBadge, Tabs, useToast } from '../../components/ui';

/** UC-10 / FR-RES-08: parking history, pass purchases, receipts */
export default function HistoryPage() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('visits');
  useEffect(() => { api('/me/history').then(setD).catch((e) => setError(e.message)); }, []);

  const pdf = async (id) => {
    try { await download(`/payments/${id}/receipt.pdf`, `receipt-${id}.pdf`); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div className="page">
      <div className="page-head"><div><span className="eyebrow">Driver portal</span><h1>History & receipts</h1><p>Visits of your registered vehicles and your pass purchases.</p></div></div>
      <Alert>{error}</Alert>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'visits', label: 'Parking visits' }, { value: 'passes', label: 'Pass payments' }]} />
      {!d ? (!error && <Loading />) : tab === 'visits' ? (
        <div className="glass card">
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Vehicle</th><th>Facility · Slot</th><th>Entry</th><th>Duration</th><th>Fee</th><th>Status</th><th>Receipt</th></tr></thead>
              <tbody>
                {d.sessions.length === 0 && <tr><td colSpan={7} className="empty">No visits yet.</td></tr>}
                {d.sessions.map((s) => (
                  <tr key={s.id}>
                    <td><b>{s.plate_number}</b><div className="small muted">{VEHICLE_LABELS[s.vehicle_type]}</div></td>
                    <td>{s.facility_name} · {s.zone_label} {s.slot_code}</td>
                    <td className="nowrap">{fmtDateTime(s.entry_time)}</td>
                    <td className="nowrap">{fmtMinutes(Math.ceil(((s.exit_time ? new Date(s.exit_time) : new Date()) - new Date(s.entry_time)) / 60000))}</td>
                    <td>{s.fee !== null ? bdt(s.fee) : '—'}{s.method && <div className="small muted">{METHOD_LABELS[s.method]}</div>}</td>
                    <td><StatusBadge status={s.status} label={s.status === 'open' ? 'Parked' : 'Exited'} /></td>
                    <td className="nowrap">
                      {s.payment_id ? (
                        <span className="row" style={{ gap: 6 }}>
                          <Link className="btn btn-sm" to={`/receipt/${s.payment_id}`}><Receipt size={14} /><span>View</span></Link>
                          <button type="button" className="btn btn-sm btn-icon" aria-label={`Download receipt ${s.receipt_no}`} onClick={() => pdf(s.payment_id)}><Download size={14} /></button>
                        </span>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="glass card">
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Receipt</th><th>Vehicle</th><th>Facility</th><th>Valid</th><th>Paid</th><th>Amount</th><th /></tr></thead>
              <tbody>
                {d.pass_payments.length === 0 && <tr><td colSpan={7} className="empty">No pass payments yet.</td></tr>}
                {d.pass_payments.map((p) => (
                  <tr key={p.payment_id}>
                    <td className="mono small">{p.receipt_no}</td><td>{p.plate_number}</td><td>{p.facility_name}</td>
                    <td className="nowrap">{fmtDate(p.start_date)} – {fmtDate(p.end_date)}</td><td className="nowrap">{fmtDateTime(p.paid_at)}</td><td>{bdt(p.amount)}</td>
                    <td className="nowrap">
                      <Link className="btn btn-sm" to={`/receipt/${p.payment_id}`}><Receipt size={14} /><span>View</span></Link>{' '}
                      <button type="button" className="btn btn-sm btn-icon" aria-label={`Download receipt ${p.receipt_no}`} onClick={() => pdf(p.payment_id)}><Download size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
