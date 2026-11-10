import { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff } from 'lucide-react';

/**
 * Camera QR scanner (HW-01, html5-qrcode). Falls back to manual entry if the
 * camera is unavailable or permission is denied.
 */
export default function QrScanner({ onScan }) {
  const [active, setActive] = useState(false);
  const [error, setError] = useState('');
  const scannerRef = useRef(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const stop = async () => {
    const s = scannerRef.current;
    scannerRef.current = null;
    setActive(false);
    if (s) {
      try { await s.stop(); } catch { /* already stopped */ }
      try { s.clear(); } catch { /* ignore */ }
    }
  };

  const start = async () => {
    setError('');
    setActive(true);
    try {
      const { Html5Qrcode } = await import('html5-qrcode');
      const s = new Html5Qrcode('qr-reader', { verbose: false });
      scannerRef.current = s;
      await s.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        (text) => { stop(); onScanRef.current(text); },
        () => {}
      );
    } catch (e) {
      await stop();
      const msg = String((e && e.message) || e);
      setError(/permission|notallowed/i.test(msg)
        ? 'Camera permission was denied. Allow camera access in the browser, or type the ticket code below.'
        : 'No camera found or it is in use. Use a USB scanner or type the ticket code below.');
    }
  };

  useEffect(() => () => { stop(); }, []);

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="scan-box">
        <div id="qr-reader" style={{ display: active ? 'block' : 'none' }} />
        {!active && (
          <div className="stack" style={{ alignItems: 'center', gap: 8 }}>
            <Camera size={28} color="#a86f2c" />
            <span className="muted small">Scan the QR ticket with the camera</span>
            <button type="button" className="btn btn-sm" onClick={start}><Camera size={15} /><span>Start camera</span></button>
          </div>
        )}
      </div>
      {active && <button type="button" className="btn btn-sm" onClick={stop}><CameraOff size={15} /><span>Stop camera</span></button>}
      {error && <div className="alert alert-warn small">{error}</div>}
    </div>
  );
}
