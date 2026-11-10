import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ROLE_LABELS } from '../lib/format';
import { Alert, Button, Field, useAsync, useToast } from '../components/ui';

/** FR-AUTH-09: change password after entering the current one */
export default function Account() {
  const { user } = useAuth();
  const toast = useToast();
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const { busy, error, setError, run } = useAsync();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = (e) => {
    e.preventDefault();
    if (f.next !== f.confirm) { setError('New passwords do not match.'); return; }
    run(async () => {
      await api('/auth/change-password', { method: 'POST', body: { current_password: f.current, new_password: f.next } });
      setF({ current: '', next: '', confirm: '' });
      toast('Password changed.');
    });
  };

  return (
    <div className="page">
      <div className="page-head"><div><span className="eyebrow">Account</span><h1>Your account</h1></div></div>
      <div className="grid grid-2">
        <div className="glass card">
          <h3 style={{ marginBottom: 12 }}>Profile</h3>
          <dl className="kv">
            <dt>Name</dt><dd>{user.name}</dd>
            <dt>Email</dt><dd>{user.email || '—'}</dd>
            <dt>Phone</dt><dd>{user.phone || '—'}</dd>
            <dt>Role</dt><dd>{ROLE_LABELS[user.role]}</dd>
          </dl>
        </div>
        <form className="glass card stack" onSubmit={submit}>
          <h3>Change password</h3>
          <Alert>{error}</Alert>
          <Field label="Current password" htmlFor="cp"><input id="cp" className="input" type="password" value={f.current} onChange={set('current')} required autoComplete="current-password" /></Field>
          <Field label="New password" hint="At least 8 characters" htmlFor="np"><input id="np" className="input" type="password" value={f.next} onChange={set('next')} required minLength={8} autoComplete="new-password" /></Field>
          <Field label="Confirm new password" htmlFor="np2"><input id="np2" className="input" type="password" value={f.confirm} onChange={set('confirm')} required autoComplete="new-password" /></Field>
          <Button type="submit" className="btn-primary" busy={busy}><KeyRound size={16} /><span>Update password</span></Button>
        </form>
      </div>
    </div>
  );
}
