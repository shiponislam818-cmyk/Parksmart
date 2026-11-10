import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { LogIn, Eye, EyeOff } from 'lucide-react';
import { useAuth, homeFor } from '../lib/auth';
import { Alert, Button, Field, useAsync } from '../components/ui';

const DEMO = [
  ['Administrator', 'admin@parksmart.local', 'Admin@1234'],
  ['Gate Operator', 'operator@parksmart.local', 'Operator@1234'],
  ['Driver', 'driver@parksmart.local', 'Driver@1234'],
];

export default function Login() {
  const { user, login, notice } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const { busy, error, run } = useAsync();

  if (user) return <Navigate to={homeFor(user.role)} replace />;

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      const u = await login(identifier, password);
      const from = loc.state && loc.state.from;
      nav(from && from !== '/login' ? from : homeFor(u.role), { replace: true });
    });
  };

  return (
    <div className="center-page">
      <div className="auth-card glass glass-strong fade-in">
        <div className="auth-hero">
          <div className="brand-mark">P</div>
          <h1>Welcome to ParkSmart</h1>
          <p className="muted">Sign in with your email or phone number</p>
        </div>
        <form className="stack" onSubmit={submit}>
          {notice && !error && <Alert type="info">{notice}</Alert>}
          <Alert>{error}</Alert>
          <Field label="Email or phone" htmlFor="identifier">
            <input id="identifier" className="input" autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="you@example.com or 017XXXXXXXX" required />
          </Field>
          <Field label="Password" htmlFor="password">
            <div style={{ position: 'relative' }}>
              <input id="password" className="input" type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required style={{ paddingRight: 48 }} />
              <button type="button" className="btn btn-ghost btn-icon btn-sm" style={{ position: 'absolute', right: 5, top: 5, width: 34 }} aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)}>
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </Field>
          <Button type="submit" className="btn-primary btn-lg btn-block" busy={busy}><LogIn size={18} /><span>Sign in</span></Button>
        </form>
        <p className="center small muted" style={{ textAlign: 'center', marginTop: 16 }}>
          New driver? <Link to="/register">Create an account</Link>
        </p>
        <details className="help" style={{ marginTop: 16 }}>
          <summary>Sample accounts (seed data)</summary>
          <div className="demo-accounts">
            {DEMO.map(([role, email, pw]) => (
              <button key={email} type="button" className="btn btn-sm" onClick={() => { setIdentifier(email); setPassword(pw); }}>
                <span><b>{role}</b> · {email}</span>
              </button>
            ))}
          </div>
        </details>
      </div>
    </div>
  );
}
