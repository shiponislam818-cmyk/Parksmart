import { useCallback, useEffect, useState } from 'react';
import { Pencil, Search, UserPlus } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fmtDateTime, ROLE_LABELS } from '../../lib/format';
import { Alert, Button, Field, Loading, Modal, StatusBadge, Switch, Tabs, useAsync, useToast } from '../../components/ui';

/** UC-06 / FR-AUTH-06: manage staff accounts */
export default function Staff() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [role, setRole] = useState('staff');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState(null);

  const load = useCallback(async () => {
    try {
      const all = await api(`/users${qs({ role: role === 'staff' ? '' : role, q: query })}`);
      setRows(role === 'staff' ? all.filter((u) => u.role !== 'driver') : all);
      setError('');
    } catch (e) { setError(e.message); }
  }, [role, query]);
  useEffect(() => { load(); }, [load]);

  const toggle = async (u) => {
    try {
      await api(`/users/${u.id}/active`, { method: 'PATCH', body: { is_active: !u.is_active } });
      toast(`${u.name} ${u.is_active ? 'deactivated' : 'reactivated'}`);
      load();
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div><span className="eyebrow">Setup</span><h1>Staff & users</h1><p>Create gate operators and administrators; deactivate accounts that should no longer log in.</p></div>
        <div className="page-actions"><button type="button" className="btn btn-primary" onClick={() => setForm({ name: '', email: '', phone: '', role: 'operator', password: '' })}><UserPlus size={16} /><span>New staff account</span></button></div>
      </div>
      <div className="glass card stack">
        <div className="row between">
          <Tabs value={role} onChange={setRole} tabs={[{ value: 'staff', label: 'All staff' }, { value: 'operator', label: 'Operators' }, { value: 'admin', label: 'Administrators' }, { value: 'driver', label: 'Drivers' }]} />
          <form className="row" onSubmit={(e) => { e.preventDefault(); setQuery(q); }}>
            <input className="input" style={{ width: 220 }} aria-label="Search users" placeholder="Name, email or phone" value={q} onChange={(e) => setQ(e.target.value)} />
            <button type="submit" className="btn"><Search size={16} /><span>Search</span></button>
          </form>
        </div>
        <Alert onRetry={load}>{error}</Alert>
        {!rows ? <Loading /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Status</th><th>Created</th><th className="right">Actions</th></tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={7} className="empty">No accounts match.</td></tr>}
                {rows.map((u) => (
                  <tr key={u.id}>
                    <td><b>{u.name}</b>{u.id === me.id && <span className="muted small"> (you)</span>}</td>
                    <td>{u.email || '—'}</td>
                    <td>{u.phone || '—'}</td>
                    <td>{ROLE_LABELS[u.role]}</td>
                    <td>
                      <StatusBadge status={u.is_active ? 'active' : 'inactive'} label={u.is_active ? 'Active' : 'Deactivated'} />
                      {u.locked_until && new Date(u.locked_until) > new Date() && <span className="badge b-pending plain" style={{ marginLeft: 6 }}>Locked</span>}
                    </td>
                    <td className="nowrap">{fmtDateTime(u.created_at)}</td>
                    <td className="right nowrap">
                      <span className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                        <Switch on={u.is_active} disabled={u.id === me.id} label={`${u.is_active ? 'Deactivate' : 'Reactivate'} ${u.name}`} onChange={() => toggle(u)} />
                        <button type="button" className="btn btn-sm btn-icon" aria-label={`Edit ${u.name}`} onClick={() => setForm({ ...u, phone: u.phone || '', password: '' })}><Pencil size={14} /></button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {form && <UserForm initial={form} onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); toast('Account saved'); }} />}
    </div>
  );
}

function UserForm({ initial, onClose, onSaved }) {
  const [f, setF] = useState(initial);
  const { busy, error, run } = useAsync();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const isDriver = f.role === 'driver';
  const save = (e) => {
    e.preventDefault();
    run(async () => {
      const body = { name: f.name, email: f.email, phone: f.phone || undefined, role: f.role, password: f.password || undefined };
      if (f.id) await api(`/users/${f.id}`, { method: 'PUT', body });
      else await api('/users', { method: 'POST', body });
      onSaved();
    });
  };
  return (
    <Modal title={f.id ? `Edit ${initial.name}` : 'New staff account'} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <Alert>{error}</Alert>
        <Field label="Full name" htmlFor="u-name"><input id="u-name" className="input" value={f.name} onChange={set('name')} required /></Field>
        <div className="form-grid">
          <Field label="Email" htmlFor="u-email"><input id="u-email" className="input" type="email" value={f.email} onChange={set('email')} required /></Field>
          <Field label="Phone (optional)" htmlFor="u-phone"><input id="u-phone" className="input" value={f.phone} onChange={set('phone')} /></Field>
        </div>
        <div className="form-grid">
          <Field label="Role" htmlFor="u-role">
            <select id="u-role" className="input" value={f.role} onChange={set('role')} disabled={isDriver}>
              {isDriver ? <option value="driver">Registered Driver</option> : (
                <>
                  <option value="operator">Gate Operator</option>
                  <option value="admin">Administrator</option>
                </>
              )}
            </select>
          </Field>
          <Field label={f.id ? 'New password (leave blank to keep)' : 'Password'} hint="At least 8 characters" htmlFor="u-pw">
            <input id="u-pw" className="input" type="password" value={f.password} onChange={set('password')} required={!f.id} minLength={8} autoComplete="new-password" />
          </Field>
        </div>
        <div className="modal-foot"><button type="button" className="btn" onClick={onClose}>Cancel</button><Button type="submit" className="btn-primary" busy={busy}><span>Save account</span></Button></div>
      </form>
    </Modal>
  );
}
