import { useCallback, useEffect, useState } from 'react';
import { CreditCard, ShieldCheck, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import { bdt } from '../lib/format';
import { Alert, Button, Loading, StatusBadge } from './ui';

/**
 * Sandbox payment gateway (C-2: test mode only — no real money moves).
 * Simulates the gateway's hosted page: the payer approves or declines with test credentials,
 * and the server records Paid or Failed (FR-BIL-05, FR-BIL-09).
 */
export default function PaymentGateway({ paymentId, onDone }) {
  const [p, setP] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [card, setCard] = useState('4111 1111 1111 1111');

  const load = useCallback(() => {
    api(`/payments/${paymentId}`).then(setP).catch((e) => setError(e.message));
  }, [paymentId]);
  useEffect(load, [load]);

  const answer = async (outcome) => {
    setBusy(outcome);
    setError('');
    try {
      const r = await api(`/payments/${paymentId}/sandbox`, { method: 'POST', body: { outcome } });
      setP((x) => ({ ...x, status: r.payment.status, receipt_no: r.payment.receipt_no }));
      if (onDone) onDone(r.payment);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  if (!p) return error ? <Alert onRetry={load}>{error}</Alert> : <Loading />;
  return (
    <div className="stack">
      <div className="alert alert-warn small"><ShieldCheck size={16} /> <span>Sandbox / test mode — no real money is charged.</span></div>
      <dl className="kv">
        <dt>Payment for</dt><dd>{p.purpose}</dd>
        <dt>Amount</dt><dd>{bdt(p.amount)}</dd>
        <dt>Status</dt><dd><StatusBadge status={p.status} /></dd>
      </dl>
      <Alert>{error}</Alert>
      {p.status === 'pending' ? (
        <>
          <div className="field">
            <label htmlFor="card">Test card number</label>
            <input id="card" className="input mono" value={card} onChange={(e) => setCard(e.target.value)} />
            <span className="hint">Any value works in sandbox mode. Choose the outcome below to simulate the gateway response.</span>
          </div>
          <div className="row">
            <Button className="btn-success" busy={busy === 'success'} disabled={Boolean(busy)} onClick={() => answer('success')}><CreditCard size={16} /><span>Pay {bdt(p.amount)}</span></Button>
            <Button className="btn-danger" busy={busy === 'failure'} disabled={Boolean(busy)} onClick={() => answer('failure')}><XCircle size={16} /><span>Simulate failure</span></Button>
          </div>
        </>
      ) : p.status === 'paid' ? (
        <Alert type="ok">Payment successful. Receipt {p.receipt_no}.</Alert>
      ) : (
        <Alert type="error">Payment failed.{p.kind === 'parking' ? ' The slot stays Occupied — retry online or take cash.' : ' Start the purchase again to retry.'}</Alert>
      )}
    </div>
  );
}
