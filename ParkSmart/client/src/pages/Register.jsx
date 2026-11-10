import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { UserPlus } from 'lucide-react';
import { useAuth, homeFor } from '../lib/auth';
import { Alert, Button, Field, useAsync } from '../components/ui';

export default function Register() {
  const { user, register } = useAuth();
  const [f, setF] = useState({ name: '', phone: '', email: '', password: '', confirm: '' });
  const { busy, error, setError, run } = useAsync();
  const [justRegistered, setJustRegistered] = useState(false);
  if (user && justRegistered) return <Navigate to="/driver/vehicles" replace state={{ welcome: true }} />;
  if (user) return <Navigate to={homeFor(user.role)} replace />;

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = (e) => {
    e.preventDefault();
    if (f.password !== f.confirm) { setError('Passwords do not match. Type the same password twice.'); return; }
    run(async () => {
      setJustRegistered(true);
      await register({ name: f.name, phone: f.phone, email: f.email, password: f.password });
    });
  };

  return (
    <div className="center-page">
      <div className="auth-card glass glass-strong fade-in">
        <div className="auth-hero">
          <div className="brand-mark">P</div>
          <h1>Create driver account</h1>
          <p className="muted">Reserve slots, buy monthly passes and keep your receipts</p>
        </div>
        <form className="stack" onSubmit={submit}>
          <Alert>{error}</Alert>
          <Field label="Full name" htmlFor="r-name"><input id="r-name" className="input" value={f.name} onChange={set('name')} required autoComplete="name" /></Field>
          <div className="form-grid">
            <Field label="Phone number" htmlFor="r-phone"><input id="r-phone" className="input" value={f.phone} onChange={set('phone')} required inputMode="tel" placeholder="017XXXXXXXX" autoComplete="tel" /></Field>
            <Field label="Email" htmlFor="r-email"><input id="r-email" className="input" type="email" value={f.email} onChange={set('email')} required autoComplete="email" /></Field>
          </div>
          <div className="form-grid">
            <Field label="Password" hint="At least 8 characters" htmlFor="r-pw"><input id="r-pw" className="input" type="password" value={f.password} onChange={set('password')} required minLength={8} autoComplete="new-password" /></Field>
            <Field label="Confirm password" htmlFor="r-pw2"><input id="r-pw2" className="input" type="password" value={f.confirm} onChange={set('confirm')} required autoComplete="new-password" /></Field>
          </div>
          <Button type="submit" className="btn-primary btn-lg btn-block" busy={busy}><UserPlus size={18} /><span>Create account</span></Button>
        </form>
        <p className="small muted" style={{ textAlign: 'center', marginTop: 16 }}>Already registered? <Link to="/login">Sign in</Link></p>
      </div>
    </div>
  );
}
