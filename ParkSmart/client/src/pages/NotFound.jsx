import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="center-page">
      <div className="glass glass-strong card fade-in" style={{ textAlign: 'center', maxWidth: 420 }}>
        <div className="big-number">404</div>
        <h2 style={{ margin: '8px 0' }}>Page not found</h2>
        <p className="muted" style={{ marginBottom: 16 }}>The address you opened does not exist. Check the link, or go back to your home screen.</p>
        <Link className="btn btn-primary" to="/"><span>Go to home</span></Link>
      </div>
    </div>
  );
}
