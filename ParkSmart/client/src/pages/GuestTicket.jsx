import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { bdt, fmtDateTime, fmtTime, VEHICLE_LABELS } from '../lib/format';
import { Alert, Button, Loading } from '../components/ui';
import { Brand } from '../components/Layout';

/** UC-11 / FR-GST-01..02: public, read-only ticket status opened from the QR code. */
export default function GuestTicket() {
  const { code } = useParams();
  const [t, setT] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setT(await api(`/guest/tickets/${encodeURIComponent(code)}`));
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [code]);

  useEffect(() => {
    load();
    const id = setInterval(load, 60000); // fee and elapsed time refresh every minute
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="mobile-page">
      <div className="glass topbar-like" style={{ padding: '10px 14px', borderRadius: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Brand />
        <span className="badge b-accent plain">Guest</span>
      </div>
      {!t && !error && <Loading />}
      <Alert onRetry={load}>{error}</Alert>
      {t && (
        <div className="glass glass-strong card fade-in stack" style={{ textAlign: 'center' }}>
          <div className="eyebrow">Your parking ticket</div>
          <div className="mono small muted" style={{ wordBreak: 'break-all' }}>{t.ticket_code}</div>
          {t.status === 'open' ? (
            <>
              <div>
                <div className="muted small">Fee so far</div>
                <div className="big-number">{bdt(t.fee)}</div>
                {t.pass_applied && <div className="small muted">Monthly pass applied — time fee waived</div>}
              </div>
              <dl className="kv" style={{ textAlign: 'left' }}>
                <dt>Facility</dt><dd>{t.facility}</dd>
                <dt>Slot</dt><dd>{t.zone} · {t.slot}</dd>
                <dt>Vehicle type</dt><dd>{VEHICLE_LABELS[t.vehicle_type]}</dd>
                <dt>Entered</dt><dd>{fmtDateTime(t.entry_time)}</dd>
                <dt>Elapsed</dt><dd>{t.elapsed}</dd>
                <dt>Checked at</dt><dd>{fmtTime(t.now)}</dd>
              </dl>
            </>
          ) : (
            <>
              <span className="badge b-closed" style={{ alignSelf: 'center' }}>Ticket closed</span>
              <dl className="kv" style={{ textAlign: 'left' }}>
                <dt>Facility</dt><dd>{t.facility}</dd>
                <dt>Slot</dt><dd>{t.zone} · {t.slot}</dd>
                <dt>Entered</dt><dd>{fmtDateTime(t.entry_time)}</dd>
                <dt>Exited</dt><dd>{fmtDateTime(t.exit_time)}</dd>
                <dt>Duration</dt><dd>{t.elapsed}</dd>
                <dt>Fee paid</dt><dd>{bdt(t.fee)}</dd>
              </dl>
            </>
          )}
          <Button className="btn-block" busy={busy} onClick={load}><RefreshCw size={16} /><span>Refresh</span></Button>
          <p className="small muted">Read-only page · no account needed · pay at the exit gate</p>
        </div>
      )}
    </div>
  );
}
