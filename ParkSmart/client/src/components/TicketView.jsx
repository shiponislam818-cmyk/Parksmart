import { Printer } from 'lucide-react';
import { fmtDateTime } from '../lib/format';

/** FR-ENT-10: QR ticket with ticket code, plate, vehicle type, slot and entry time. */
export default function TicketView({ t, showPrint = true }) {
  return (
    <div className="ticket">
      <div className="eyebrow">ParkSmart parking ticket</div>
      <h3 style={{ margin: '4px 0 10px' }}>{t.facility}</h3>
      <img className="qr" src={t.qr} alt={`QR code for ticket ${t.ticket_code}`} />
      <div className="code" style={{ marginTop: 10 }}>{t.ticket_code}</div>
      <dl className="kv">
        <dt>Plate</dt><dd>{t.plate}</dd>
        <dt>Vehicle</dt><dd>{t.vehicle_label}</dd>
        <dt>Slot</dt><dd>{t.zone} · {t.slot}</dd>
        <dt>Entry</dt><dd>{fmtDateTime(t.entry_time)}</dd>
      </dl>
      <p className="small muted" style={{ marginTop: 10 }}>Scan the QR with your phone to see elapsed time and fee. Keep this ticket for exit.</p>
      {showPrint && (
        <button type="button" className="btn btn-primary btn-block no-print" style={{ marginTop: 14 }} onClick={() => window.print()}>
          <Printer size={16} /><span>Print ticket</span>
        </button>
      )}
    </div>
  );
}
