import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import PaymentGateway from '../components/PaymentGateway';

/** Full-page sandbox gateway (used for monthly-pass purchases from the driver portal). */
export default function PayPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [paid, setPaid] = useState(null);
  const back = user.role === 'driver' ? '/driver/passes' : '/gate';
  return (
    <div className="page" style={{ maxWidth: 560 }}>
      <div className="page-head"><div><span className="eyebrow">Sandbox payment gateway</span><h1>Complete payment</h1></div></div>
      <div className="glass glass-strong card">
        <PaymentGateway paymentId={id} onDone={(p) => setPaid(p)} />
        {paid && (
          <div className="row" style={{ marginTop: 14 }}>
            {paid.status === 'paid' && <Link className="btn btn-primary" to={`/receipt/${paid.id}`}><span>View receipt</span></Link>}
            <Link className="btn" to={back}><span>Back</span></Link>
          </div>
        )}
        {!paid && <div style={{ marginTop: 14 }}><Link to={back}>← Back without paying</Link></div>}
      </div>
    </div>
  );
}
