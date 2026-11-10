import { useCallback, useEffect, useState } from 'react';
import { Filter, RotateCcw } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { fmtDateTime, ROLE_LABELS } from '../../lib/format';
import { Alert, Button, Field, Loading } from '../../components/ui';

/** FR-REP-05..07: append-only audit log with filters (read-only — no edit/delete in the app) */
export default function AuditLog() {
  const empty = { user_id: '', action: '', from: '', to: '' };
  const [f, setF] = useState(empty);
  const [applied, setApplied] = useState(empty);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [users, setUsers] = useState([]);
  const [actions, setActions] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    api('/users').then(setUsers).catch(() => {});
    api('/audit/actions').then(setActions).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setBusy(true);
    try { setData(await api(`/audit${qs({ ...applied, page })}`)); setError(''); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }, [applied, page]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="page">
      <div className="page-head"><div><span className="eyebrow">Security</span><h1>Audit log</h1><p>Every login, entry, exit, payment, fee override, rate change and slot status change. Entries cannot be edited or deleted.</p></div></div>
      <form className="glass card form-row" onSubmit={(e) => { e.preventDefault(); setPage(1); setApplied(f); }}>
        <Field label="User" htmlFor="au-user">
          <select id="au-user" className="input" value={f.user_id} onChange={(e) => setF({ ...f, user_id: e.target.value })}>
            <option value="">All users</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name} ({ROLE_LABELS[u.role]})</option>)}
          </select>
        </Field>
        <Field label="Action" htmlFor="au-action">
          <select id="au-action" className="input" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })}>
            <option value="">All actions</option>
            {actions.map((a) => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
          </select>
        </Field>
        <Field label="From" htmlFor="au-from"><input id="au-from" className="input" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
        <Field label="To" htmlFor="au-to"><input id="au-to" className="input" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
        <Button type="submit" className="btn-primary" busy={busy}><Filter size={16} /><span>Filter</span></Button>
        <button type="button" className="btn" onClick={() => { setF(empty); setApplied(empty); setPage(1); }}><RotateCcw size={16} /><span>Reset</span></button>
      </form>
      <Alert onRetry={load}>{error}</Alert>
      <div className="glass card">
        {!data ? <Loading /> : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
                <tbody>
                  {data.rows.length === 0 && <tr><td colSpan={5} className="empty">No audit entries match these filters.</td></tr>}
                  {data.rows.map((a) => (
                    <tr key={a.id}>
                      <td className="nowrap">{fmtDateTime(a.created_at)}</td>
                      <td>{a.user_name || <span className="muted">System</span>}</td>
                      <td><span className="badge b-accent plain">{a.action.replace(/_/g, ' ')}</span></td>
                      <td className="mono small">{a.target || '—'}</td>
                      <td className="small" style={{ maxWidth: 380 }}>
                        {a.details ? (
                          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(open === a.id ? null : a.id)}>{open === a.id ? 'Hide' : 'Show'}</button>
                        ) : '—'}
                        {open === a.id && <pre className="mono" style={{ whiteSpace: 'pre-wrap', fontSize: '.75rem', margin: '6px 0 0' }}>{JSON.stringify(a.details, null, 2)}</pre>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pager">
              <span className="muted small">{data.total} entries · page {data.page} of {data.pages}</span>
              <button type="button" className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
              <button type="button" className="btn btn-sm" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
