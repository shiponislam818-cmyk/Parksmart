import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bike, Bus, Car, CheckCircle2, CircleDollarSign, Globe, LogIn, LogOut, Receipt, RefreshCw, Search, SearchX, Wand2, WifiOff,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFacility } from '../lib/useFacility';
import { useLiveSlots, useOnline } from '../lib/socket';
import { bdt, fmtDateTime, fmtTime, VEHICLE_LABELS, VEHICLE_ORDER } from '../lib/format';
import { Alert, Button, Field, Modal, useToast } from '../components/ui';
import QrScanner from '../components/QrScanner';
import TicketView from '../components/TicketView';
import PaymentGateway from '../components/PaymentGateway';

const TYPE_ICON = { motorcycle: Bike, car: Car, microbus: Bus };
const newRequestId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/** UI-01: gate counter — entry panel and exit panel on one screen. */
export default function Gate() {
  const { user } = useAuth();
  const toast = useToast();
  const online = useOnline();
  const { facilities, facility, facilityId, setFacilityId, error: facError, reload: reloadFacilities } = useFacility();
  const [avail, setAvail] = useState(null);
  const [tick, setTick] = useState(0);

  const loadAvail = useCallback(async () => {
    try {
      const list = await api('/availability');
      setAvail(list.find((f) => f.facility_id === facilityId) || null);
    } catch { /* live bar is best-effort */ }
  }, [facilityId]);
  useEffect(() => { loadAvail(); }, [loadAvail]);

  const live = useLiveSlots(
    (slot) => { if (slot.facility_id === facilityId) { loadAvail(); setTick((x) => x + 1); } },
    () => { loadAvail(); setTick((x) => x + 1); }
  );

  return (
    <div className="page">
      {(!online || !live) && (
        <div className="offline-banner">
          <Alert type="warn"><WifiOff size={16} style={{ verticalAlign: -3 }} /> {online ? 'Live updates disconnected — reconnecting…' : 'You are offline. Your input is kept; press the button again when the connection returns.'}</Alert>
        </div>
      )}
      <div className="page-head">
        <div>
          <span className="eyebrow">Gate counter</span>
          <h1>{facility ? facility.name : 'Gate counter'}</h1>
          <p>Operator: {user.name} · {fmtDateTime(new Date())}</p>
        </div>
        <div className="page-actions">
          <Field label="Facility" htmlFor="gate-facility">
            <select id="gate-facility" className="input" value={facilityId || ''} onChange={(e) => setFacilityId(Number(e.target.value))}>
              {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </Field>
        </div>
      </div>
      <Alert onRetry={reloadFacilities}>{facError}</Alert>
      {facility && (
        <div className="gate-grid">
          <EntryPanel facilityId={facilityId} tick={tick} toast={toast} />
          <ExitPanel toast={toast} isAdmin={user.role === 'admin'} />
        </div>
      )}
      {facilities.length === 0 && !facError && <Alert type="info">No active facility yet. An administrator must create one under Facilities & slots.</Alert>}
      <div className="glass livebar">
        <span><span className={`dot ${live && online ? '' : 'off'}`} /> {live && online ? 'Live' : 'Offline'}</span>
        {avail && VEHICLE_ORDER.filter((t) => avail.types[t]).map((t) => (
          <span key={t}>{VEHICLE_LABELS[t]}: <b>{avail.types[t].occupied}/{avail.types[t].total}</b> occupied · <b>{avail.types[t].free}</b> free</span>
        ))}
        <span className="spacer" />
        <Link to="/map">Open slot map →</Link>
      </div>
    </div>
  );
}

/* ---------------- Entry (UC-01) ---------------- */
function EntryPanel({ facilityId, tick, toast }) {
  const [plate, setPlate] = useState('');
  const [type, setType] = useState('car');
  const [suggest, setSuggest] = useState(null);
  const [override, setOverride] = useState(null);
  const [picker, setPicker] = useState(false);
  const [ticket, setTicket] = useState(null);
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const reqId = useRef(newRequestId());
  const plateRef = useRef(null);

  const suggestSeq = useRef(0);
  const loadSuggest = useCallback(async () => {
    const seq = ++suggestSeq.current; // ignore stale replies when facility/type change quickly
    try {
      const r = await api(`/sessions/suggest?facility_id=${facilityId}&vehicle_type=${type}`);
      if (seq === suggestSeq.current) setSuggest(r.slot);
    } catch { if (seq === suggestSeq.current) setSuggest(null); }
  }, [facilityId, type]);
  useEffect(() => { loadSuggest(); }, [loadSuggest, tick]);
  useEffect(() => { setOverride(null); }, [type, facilityId]);

  // a new attempt id whenever the input changes; retries after a network drop reuse it (NFR-REL-03)
  useEffect(() => { reqId.current = newRequestId(); }, [plate, type, facilityId, override]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setOffline(false);
    setBusy(true);
    try {
      const t = await api('/sessions', {
        method: 'POST',
        body: { facility_id: facilityId, plate, vehicle_type: type, slot_id: override ? override.id : undefined, client_request_id: reqId.current },
      });
      setTicket(t);
      toast(`Entry registered: ${t.plate} → ${t.zone} · ${t.slot}${t.via_reservation ? ' (reserved slot)' : ''}`);
      setPlate('');
      setOverride(null);
      reqId.current = newRequestId();
      loadSuggest();
    } catch (err) {
      setError(err.message);
      setOffline(err.offline);
    } finally {
      setBusy(false);
      plateRef.current && plateRef.current.focus();
    }
  };

  const shown = override || suggest;
  return (
    <form className="glass card stack" onSubmit={submit}>
      <div className="card-head"><h2><LogIn size={20} /> Vehicle entry</h2></div>
      <Field label="Number plate" htmlFor="plate">
        <input id="plate" ref={plateRef} className="input input-lg" value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="Sylhet Metro-Ga 11-2345" autoComplete="off" autoFocus required />
      </Field>
      <div className="field">
        <span className="label">Vehicle type</span>
        <div className="type-picker" role="radiogroup" aria-label="Vehicle type">
          {VEHICLE_ORDER.map((t) => {
            const Icon = TYPE_ICON[t];
            return (
              <button key={t} type="button" role="radio" aria-checked={type === t} className={`btn type-btn ${type === t ? 'is-on' : ''}`} onClick={() => setType(t)}>
                <Icon size={22} /><span>{VEHICLE_LABELS[t]}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="suggest">
        <span>
          {shown
            ? <>{override ? 'Chosen' : 'Suggested'} slot: <b>{shown.zone_label} · {shown.code}</b>{!override && <span className="muted small"> (nearest free {VEHICLE_LABELS[type].toLowerCase()} slot)</span>}</>
            : <span className="muted">No free {VEHICLE_LABELS[type]} slot — facility full for this type.</span>}
        </span>
        <div className="row" style={{ gap: 6 }}>
          {override && <button type="button" className="btn btn-sm" onClick={() => setOverride(null)}><Wand2 size={14} /><span>Auto</span></button>}
          <button type="button" className="btn btn-sm" onClick={() => setPicker(true)} disabled={!suggest}><span>Change</span></button>
        </div>
      </div>
      {error && <Alert type={offline ? 'warn' : 'error'} onRetry={offline ? () => submit({ preventDefault() {} }) : undefined}>{error}</Alert>}
      <Button type="submit" className="btn-primary btn-lg btn-block" busy={busy}><span>Register entry & print QR ticket</span></Button>

      {picker && <SlotPicker facilityId={facilityId} type={type} onPick={(s) => { setOverride(s); setPicker(false); }} onClose={() => setPicker(false)} />}
      {ticket && (
        <Modal title="QR ticket" onClose={() => setTicket(null)} footer={<button type="button" className="btn" onClick={() => setTicket(null)}>Done</button>}>
          <TicketView t={ticket} />
        </Modal>
      )}
    </form>
  );
}

function SlotPicker({ facilityId, type, onPick, onClose }) {
  const [slots, setSlots] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api(`/facilities/${facilityId}/slots?status=free&vehicle_type=${type}`).then(setSlots).catch((e) => setError(e.message));
  }, [facilityId, type]);
  return (
    <Modal title={`Choose a free ${VEHICLE_LABELS[type]} slot`} onClose={onClose} wide>
      <Alert>{error}</Alert>
      {!slots && !error && <p className="muted">Loading free slots…</p>}
      {slots && slots.length === 0 && <p className="muted">No free slots of this type.</p>}
      {slots && (
        <div className="slot-grid">
          {slots.map((s) => (
            <button key={s.id} type="button" className="slot s-free" onClick={() => onPick(s)} style={{ border: 0 }}>
              <b>{s.code}</b><span>Free</span><small>{s.zone_label}</small>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

/* ---------------- Exit (UC-02, UC-03) ---------------- */
function ExitPanel({ toast, isAdmin }) {
  const [code, setCode] = useState('');
  const [lostMode, setLostMode] = useState(false);
  const [lostPlate, setLostPlate] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [gatewayId, setGatewayId] = useState(null);
  const [done, setDone] = useState(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [ov, setOv] = useState({ amount: '', reason: '' });
  const codeRef = useRef(null);

  const reset = () => {
    setData(null); setCode(''); setLostPlate(''); setLostMode(false); setError(''); setOv({ amount: '', reason: '' });
    setTimeout(() => codeRef.current && codeRef.current.focus(), 50);
  };

  const lookup = async (opts = {}) => {
    const c = opts.code !== undefined ? opts.code : code;
    setError(''); setDone(null); setBusy('lookup');
    try {
      const q = lostMode && opts.code === undefined ? `plate=${encodeURIComponent(lostPlate)}` : `code=${encodeURIComponent(c)}`;
      setData(await api(`/sessions/lookup?${q}`));
    } catch (e) {
      setData(null);
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const pay = async (method, withOverride = false) => {
    setError(''); setBusy(method);
    try {
      const body = { method, lost_ticket: data.quote.lost_ticket };
      if (withOverride) { body.override_amount = Number(ov.amount); body.override_reason = ov.reason; }
      const r = await api(`/sessions/${data.session.id}/exit`, { method: 'POST', body });
      setOverrideOpen(false);
      if (r.pending) {
        setGatewayId(r.payment.id);
      } else {
        setDone({ ...r.payment, plate: data.session.plate });
        toast(`Exit complete: ${data.session.plate} · ${bdt(r.payment.amount)} (${r.payment.method})`);
        reset();
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const onGatewayDone = (payment) => {
    if (payment.status === 'paid') {
      setDone({ ...payment, plate: data && data.session.plate });
      toast(`Online payment received: ${bdt(payment.amount)}`);
      setGatewayId(null);
      reset();
    } else {
      toast('Online payment failed — slot stays occupied. Retry or take cash.', 'error');
    }
  };

  const q = data && data.quote;
  return (
    <div className="glass card stack">
      <div className="card-head">
        <h2><LogOut size={20} /> Vehicle exit</h2>
        <div className="tabs">
          <button type="button" className={`tab ${!lostMode ? 'active' : ''}`} onClick={() => { setLostMode(false); setData(null); setError(''); }}>Ticket</button>
          <button type="button" className={`tab ${lostMode ? 'active' : ''}`} onClick={() => { setLostMode(true); setData(null); setError(''); }}>Lost ticket</button>
        </div>
      </div>

      {!lostMode ? (
        <>
          <QrScanner onScan={(text) => { setCode(text); lookup({ code: text }); }} />
          <form className="form-row" onSubmit={(e) => { e.preventDefault(); lookup(); }}>
            <div className="field" style={{ flex: 1, minWidth: 200 }}>
              <label htmlFor="ticket-code">Or type / USB-scan the ticket code</label>
              <input id="ticket-code" ref={codeRef} className="input mono" value={code} onChange={(e) => setCode(e.target.value)} placeholder="PS-XXXXX-XXXXX-…" autoComplete="off" />
            </div>
            <Button type="submit" busy={busy === 'lookup'} disabled={!code.trim()}><Search size={16} /><span>Find</span></Button>
          </form>
        </>
      ) : (
        <form className="form-row" onSubmit={(e) => { e.preventDefault(); lookup(); }}>
          <div className="field" style={{ flex: 1, minWidth: 200 }}>
            <label htmlFor="lost-plate">Number plate of the vehicle</label>
            <input id="lost-plate" className="input" value={lostPlate} onChange={(e) => setLostPlate(e.target.value)} placeholder="Sylhet Metro-Ga 11-2345" autoComplete="off" />
            <span className="hint">The lost-ticket penalty is added to the time fee.</span>
          </div>
          <Button type="submit" busy={busy === 'lookup'} disabled={!lostPlate.trim()}><SearchX size={16} /><span>Find parked vehicle</span></Button>
        </form>
      )}

      <Alert>{error}</Alert>
      {done && (
        <Alert type="ok">
          <CheckCircle2 size={14} style={{ verticalAlign: -2 }} /> Paid {bdt(done.amount)} — receipt {done.receipt_no}.{' '}
          <Link to={`/receipt/${done.id}`}><Receipt size={14} style={{ verticalAlign: -2 }} /> View / print receipt</Link>
        </Alert>
      )}

      {data && (
        <div className="stack fade-in">
          <dl className="kv">
            <dt>Plate</dt><dd>{data.session.plate}</dd>
            <dt>Slot</dt><dd>{data.session.facility} · {data.session.zone} · {data.session.slot}</dd>
            <dt>Entry → Exit</dt><dd>{fmtTime(data.session.entry_time)} → {fmtTime(q.exit_time)} ({q.duration})</dd>
            <dt>Entered on</dt><dd>{fmtDateTime(data.session.entry_time)}</dd>
          </dl>
          <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
            {q.lines.map((l) => <li key={l}>{l}</li>)}
          </ul>
          <div className="fee-total"><span className="label">Fee to pay</span><b>{bdt(q.total)}</b></div>
          {data.pending_payment && <Alert type="warn">An online payment ({bdt(data.pending_payment.amount)}) is still pending. <button type="button" className="btn btn-sm" onClick={() => setGatewayId(data.pending_payment.id)}>Open it</button></Alert>}
          <div className="row">
            <Button className="btn-success" busy={busy === 'cash'} disabled={Boolean(busy)} onClick={() => pay('cash')}><CircleDollarSign size={16} /><span>{q.total === 0 ? (q.pass ? 'Close (monthly pass, BDT 0)' : 'Close (no charge)') : 'Cash paid'}</span></Button>
            {q.total > 0 && <Button busy={busy === 'online'} disabled={Boolean(busy)} onClick={() => pay('online')}><Globe size={16} /><span>Online (sandbox)</span></Button>}
            {isAdmin && <Button disabled={Boolean(busy)} onClick={() => { setOv({ amount: String(q.total), reason: '' }); setOverrideOpen(true); }}><span>Override fee</span></Button>}
            <Button className="btn-ghost" onClick={() => lookup(lostMode ? {} : { code: data.session.ticket_code })} disabled={Boolean(busy)}><RefreshCw size={15} /><span>Recalculate</span></Button>
            <Button className="btn-ghost" onClick={reset} disabled={Boolean(busy)}><span>Clear</span></Button>
          </div>
        </div>
      )}

      {overrideOpen && data && (
        <Modal title="Override fee (Administrator)" onClose={() => setOverrideOpen(false)} footer={(
          <>
            <button type="button" className="btn" onClick={() => setOverrideOpen(false)}>Cancel</button>
            <Button className="btn-primary" busy={busy === 'cash'} disabled={!ov.reason.trim() || ov.amount === ''} onClick={() => pay('cash', true)}><span>Charge {bdt(ov.amount || 0)} cash</span></Button>
            <Button busy={busy === 'online'} disabled={!ov.reason.trim() || ov.amount === '' || Number(ov.amount) === 0} onClick={() => pay('online', true)}><span>Charge online</span></Button>
          </>
        )}>
          <div className="stack">
            <p className="muted small">Calculated fee: {bdt(q.total)}. The override and its reason are written to the audit log.</p>
            <Field label="Amount to charge (BDT)" htmlFor="ov-amt"><input id="ov-amt" className="input" type="number" min="0" step="1" value={ov.amount} onChange={(e) => setOv({ ...ov, amount: e.target.value })} /></Field>
            <Field label="Reason (required)" htmlFor="ov-reason"><textarea id="ov-reason" className="input" rows={3} value={ov.reason} onChange={(e) => setOv({ ...ov, reason: e.target.value })} placeholder="e.g. Customer complaint — barrier fault delayed exit" /></Field>
          </div>
        </Modal>
      )}

      {gatewayId && (
        <Modal title="Online payment (sandbox gateway)" onClose={() => { setGatewayId(null); if (data) lookup(lostMode ? {} : { code: data.session.ticket_code }); }}>
          <PaymentGateway paymentId={gatewayId} onDone={onGatewayDone} />
        </Modal>
      )}
    </div>
  );
}
