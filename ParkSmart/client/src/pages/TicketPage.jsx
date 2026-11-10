import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { Alert, Loading } from '../components/ui';
import TicketView from '../components/TicketView';

/** Ticket reprint for an open session. */
export default function TicketPage() {
  const { id } = useParams();
  const [t, setT] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api(`/sessions/${id}/ticket`).then(setT).catch((e) => setError(e.message)); }, [id]);
  return (
    <div className="page">
      <div className="no-print"><Link to="/sessions">← Back to sessions</Link></div>
      <Alert>{error}</Alert>
      {!t && !error && <Loading />}
      {t && <div className="glass glass-strong card"><TicketView t={t} /></div>}
    </div>
  );
}
