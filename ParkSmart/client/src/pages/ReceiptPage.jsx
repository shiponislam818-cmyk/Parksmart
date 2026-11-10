import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Download, Printer } from 'lucide-react';
import { api, download } from '../lib/api';
import { bdt, fmtDate, fmtDateTime, METHOD_LABELS, VEHICLE_LABELS } from '../lib/format';
import { Alert, Button, Loading } from '../components/ui';

/** FR-BIL-08: printable / downloadable receipt */
export default function ReceiptPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [r, setR] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api(`/payments/${id}/receipt`).then(setR).catch((e) => setError(e.message)); }, [id]);

  const pdf = async () => {
    setBusy(true);
    try { await download(`/payments/${id}/receipt.pdf`, `receipt-${id}.pdf`); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="page">
      <div className="row no-print">
        <button type="button" className="btn btn-sm" onClick={() => nav(-1)}>← Back</button>
        <span className="spacer" />
        {r && <button type="button" className="btn btn-sm" onClick={() => window.print()}><Printer size={15} /><span>Print</span></button>}
        {r && <Button className="btn-primary btn-sm" busy={busy} onClick={pdf}><Download size={15} /><span>Download PDF</span></Button>}
      </div>
      <Alert>{error}</Alert>
      {!r && !error && <Loading />}
      {r && (
        <div className="receipt glass glass-strong">
          <div style={{ textAlign: 'center' }}>
            <div className="eyebrow">ParkSmart</div>
            <h2>{r.kind === 'pass' ? 'Monthly pass receipt' : 'Parking receipt'}</h2>
            <div className="mono small muted">{r.receipt_no}</div>
          </div>
          <hr className="divider" style={{ margin: '14px 0' }} />
          <dl className="kv">
            <dt>Paid at</dt><dd>{fmtDateTime(r.paid_at)}</dd>
            {r.session && (
              <>
                <dt>Plate</dt><dd>{r.session.plate}</dd>
                <dt>Vehicle</dt><dd>{VEHICLE_LABELS[r.session.vehicle_type]}</dd>
                <dt>Facility</dt><dd>{r.session.facility}</dd>
                <dt>Slot</dt><dd>{r.session.zone} · {r.session.slot}</dd>
                <dt>Entry</dt><dd>{fmtDateTime(r.session.entry_time)}</dd>
                <dt>Exit</dt><dd>{fmtDateTime(r.session.exit_time)}</dd>
                <dt>Duration</dt><dd>{r.session.duration}</dd>
                {r.session.is_lost_ticket && <><dt>Lost ticket</dt><dd>Yes</dd></>}
              </>
            )}
            {r.pass && (
              <>
                <dt>Holder</dt><dd>{r.pass.holder}</dd>
                <dt>Plate</dt><dd>{r.pass.plate}</dd>
                <dt>Facility</dt><dd>{r.pass.facility}</dd>
                <dt>Valid</dt><dd>{fmtDate(r.pass.start_date)} – {fmtDate(r.pass.end_date)}</dd>
              </>
            )}
          </dl>
          <div className="label" style={{ marginTop: 14 }}>Fee breakdown</div>
          <ul className="lines">
            {(r.breakdown || []).map((l) => <li key={l}>{l}</li>)}
            {r.original_amount !== null && r.original_amount !== undefined && (
              <li>Fee override by {r.overridden_by}: {bdt(r.original_amount)} → {bdt(r.amount)} ({r.override_reason})</li>
            )}
          </ul>
          <dl className="kv">
            <dt>Payment method</dt><dd>{METHOD_LABELS[r.method]}</dd>
            <dt>Operator</dt><dd>{r.operator || 'Online'}</dd>
          </dl>
          <div className="fee-total" style={{ marginTop: 14 }}><span className="label">Total paid</span><b>{bdt(r.amount)}</b></div>
          <p className="small muted" style={{ textAlign: 'center', marginTop: 12 }}>Thank you for parking with ParkSmart.</p>
        </div>
      )}
    </div>
  );
}
