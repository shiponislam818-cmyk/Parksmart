import { useEffect } from 'react';

/** Soft drifting colour fields behind the glass, plus a pointer-following specular light on glass surfaces. */
export default function Ambient() {
  useEffect(() => {
    let raf = 0;
    const onMove = (e) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const el = e.target instanceof Element ? e.target.closest('.glass') : null;
        if (!el) return;
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', `${e.clientX - r.left}px`);
        el.style.setProperty('--my', `${e.clientY - r.top}px`);
      });
    };
    document.addEventListener('pointermove', onMove, { passive: true });
    return () => document.removeEventListener('pointermove', onMove);
  }, []);
  return (
    <div className="ambient" aria-hidden="true">
      <div className="blob b1" />
      <div className="blob b2" />
      <div className="blob b3" />
      <div className="blob b4" />
      <div className="grain" />
    </div>
  );
}
