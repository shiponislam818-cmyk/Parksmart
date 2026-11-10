import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, Loader2, X } from 'lucide-react';
import { STATUS_LABELS } from '../lib/format';

/* ---------- Toasts ---------- */
const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((message, type = 'ok') => {
    const id = Math.random().toString(36).slice(2);
    setItems((x) => [...x, { id, message, type }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), type === 'error' ? 6500 : 3800);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast glass glass-strong ${t.type}`}>
            {t.type === 'error' ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
            <span>{t.message}</span>
            <button className="btn btn-ghost btn-sm btn-icon" style={{ marginLeft: 'auto', minHeight: 26, width: 26 }} aria-label="Dismiss" onClick={() => setItems((x) => x.filter((i) => i.id !== t.id))}><X size={14} /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/* ---------- Alerts ---------- */
export function Alert({ type = 'error', children, onRetry }) {
  if (!children) return null;
  const Icon = type === 'ok' ? CheckCircle2 : type === 'info' ? Info : AlertTriangle;
  return (
    <div className={`alert alert-${type} fade-in`} role={type === 'error' ? 'alert' : 'status'}>
      <Icon size={18} />
      <div style={{ flex: 1 }}>{children}</div>
      {onRetry && <button type="button" className="btn btn-sm" onClick={onRetry}>Retry</button>}
    </div>
  );
}

export function Spinner({ size = 18, label }) {
  return <span className="row muted" style={{ gap: 8 }}><Loader2 size={size} className="spin" />{label}</span>;
}

export function Loading({ label = 'Loading…' }) {
  return <div className="empty"><Spinner label={label} /></div>;
}

export function StatusBadge({ status, label }) {
  const text = label || STATUS_LABELS[status] || (status ? status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ') : '—');
  return <span className={`badge b-${status}`}>{text}</span>;
}

/* ---------- Modal ---------- */
export function Modal({ title, onClose, children, footer, wide }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') closeRef.current(); };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    // focus the first form field once, when the dialog opens
    const first = ref.current && ref.current.querySelector('.modal-body input, .modal-body select, .modal-body textarea');
    if (first) first.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('keydown', onKey);
      if (!document.querySelector('.modal-backdrop')) document.body.classList.remove('modal-open');
    };
  }, []);
  // Portal to <body>: glass parents use backdrop-filter, which would trap position:fixed inside them.
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={`modal glass glass-strong ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="btn btn-ghost btn-icon modal-x no-print" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot no-print">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

/** Confirmation dialog — returns a promise-like flow through callbacks. */
export function Confirm({ title, message, confirmLabel = 'Confirm', danger, onConfirm, onClose, busy }) {
  return (
    <Modal title={title} onClose={onClose} footer={(
      <>
        <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy}>
          {busy && <Loader2 size={16} className="spin" />}<span>{confirmLabel}</span>
        </button>
      </>
    )}>
      <p className="muted">{message}</p>
    </Modal>
  );
}

export function Field({ label, hint, children, htmlFor }) {
  return (
    <div className="field">
      {label && <label htmlFor={htmlFor}>{label}</label>}
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function Switch({ on, onChange, label, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} />
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} type="button" role="tab" aria-selected={value === t.value} className={`tab ${value === t.value ? 'active' : ''}`} onClick={() => onChange(t.value)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Button({ busy, children, className = '', ...rest }) {
  return (
    <button type="button" className={`btn ${className}`} disabled={busy || rest.disabled} {...rest}>
      {busy && <Loader2 size={16} className="spin" />}
      {children}
    </button>
  );
}

/** Hook: run an async action with busy + error state. */
export function useAsync() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = useCallback(async (fn) => {
    setBusy(true);
    setError('');
    try {
      return await fn();
    } catch (e) {
      setError(e.message || 'Something went wrong.');
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}
