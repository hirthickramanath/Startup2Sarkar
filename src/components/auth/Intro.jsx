import React, { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Skippable brand intro (~6s), drawn with the app's own theme colours so it matches the new look in light and dark.
 *  1. A spark (the startup) crosses a bridge arch to a columned institution (the sarkar).
 *  2. The span connects: the institution lights up and a burst fires.
 *  3. The logo assembles piece by piece (arch, startup circle, institution square) and the name resolves.
 *  4. The tagline fades in.
 * Skip: button, Esc, Enter, Space or click. Plays on every normal page load.
 * Motion uses the Web Animations API, so people who ask their device for reduced motion get the finished frame instead.
 */
const NAME = 'Startup2Sarkar'.split('');
const TOTAL_MS = 6000;
const START = { x: 148, y: 232 };
const bez = (t, a, b, c, d) => (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t ** 2 * c + t ** 3 * d;
const pt = (t) => ({ x: bez(t, 148, 270, 530, 652), y: bez(t, 232, 70, 70, 232) });
const HANGERS = [0.12, 0.22, 0.32, 0.42, 0.5, 0.58, 0.68, 0.78, 0.88].map(pt);
const reduced = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

export function Intro({ onDone }) {
  const [phase, setPhase] = useState(0); // 0 cross -> 1 connect -> 2 logo + name -> 3 tagline
  const [leaving, setLeaving] = useState(false);
  const stageRef = useRef(null);   // wrapper revealed left to right
  const sparkRef = useRef(null);   // the travelling spark
  const targetRef = useRef(null);  // the institution (burst target)
  const finished = useRef(false);

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    setLeaving(true);
    setTimeout(onDone, 420);
  }, [onDone]);

  // Timeline
  useEffect(() => {
    const t = [
      setTimeout(() => setPhase(1), 2700),
      setTimeout(() => setPhase(2), 3300),
      setTimeout(() => setPhase(3), 4600),
      setTimeout(finish, TOTAL_MS),
    ];
    return () => t.forEach(clearTimeout);
  }, [finish]);

  // The crossing: reveal the bridge left to right while the spark follows the arch
  useEffect(() => {
    if (reduced() || !stageRef.current?.animate || !sparkRef.current?.animate) return undefined;
    const reveal = stageRef.current.animate([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], { duration: 2300, delay: 300, easing: 'cubic-bezier(.45,0,.2,1)', fill: 'both' });
    const frames = Array.from({ length: 31 }, (_, i) => { const p = pt(i / 30); return { transform: `translate(${p.x - START.x}px, ${p.y - START.y}px)`, offset: i / 30 }; });
    const travel = sparkRef.current.animate(frames, { duration: 2300, delay: 300, easing: 'cubic-bezier(.45,0,.2,1)', fill: 'both' });
    return () => { reveal.cancel(); travel.cancel(); };
  }, []);

  // mo.js burst when the span connects (lazy; the intro still works if it cannot load)
  useEffect(() => {
    if (phase !== 1 || reduced()) return undefined;
    let cancelled = false;
    import('@mojs/core').then((m) => {
      const mojs = m.default || m;
      if (cancelled || !stageRef.current || !targetRef.current) return;
      const root = getComputedStyle(document.documentElement);
      const accent = root.getPropertyValue('--accent').trim() || '#FFB000';
      const ink = root.getPropertyValue('--ink').trim() || '#18191B';
      const stage = stageRef.current.getBoundingClientRect();
      const tgt = targetRef.current.getBoundingClientRect();
      const x = tgt.left - stage.left + tgt.width / 2;
      const y = tgt.top - stage.top + tgt.height * 0.55;
      const burst = new mojs.Burst({
        parent: stageRef.current, left: x, top: y, radius: { 16: 110 }, count: 14, angle: { 0: 90 },
        children: { shape: 'line', stroke: [accent, ink, accent], strokeWidth: { 4: 0 }, scaleX: { 1: 0 }, radius: { 6: 12 }, degreeShift: 'rand(-18, 18)', duration: 850, easing: 'cubic.out' },
      });
      const ring = new mojs.Shape({ parent: stageRef.current, left: x, top: y, shape: 'circle', fill: 'none', stroke: accent, strokeWidth: { 8: 0 }, radius: { 8: 90 }, opacity: { 1: 0 }, duration: 750, easing: 'cubic.out' });
      burst.play(); ring.play();
    }).catch(() => { /* decorative only */ });
    return () => { cancelled = true; };
  }, [phase]);

  useEffect(() => {
    const onKey = (e) => { if (['Escape', 'Enter', ' '].includes(e.key)) { e.preventDefault(); finish(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finish]);

  const logoOn = phase >= 2;
  return (
    <div className={`in2 ${leaving ? 'leave' : ''}`} role="dialog" aria-label="Welcome to Startup2Sarkar" onClick={finish}>
      <div className="in2-grid" aria-hidden="true" />
      <button type="button" className="in2-skip" onClick={(e) => { e.stopPropagation(); finish(); }}>Skip intro <kbd>Esc</kbd></button>

      <div className={`in2-stage ${phase >= 2 ? 'small' : ''}`} ref={stageRef}>
        <svg viewBox="0 0 800 300" className="in2-svg" aria-hidden="true">
          <line x1="40" y1="250" x2="760" y2="250" className="in2-ground" />
          <g>
            <rect x="92" y="232" width="56" height="18" rx="4" className="in2-block" />
          </g>
          <path d="M 148 232 C 270 70, 530 70, 652 232" className="in2-span" />
          {HANGERS.map((h, i) => <line key={i} x1={h.x} y1={h.y} x2={h.x} y2="232" className="in2-hanger" />)}
          <g className={`in2-gov ${phase >= 1 ? 'lit' : ''}`} ref={targetRef}>
            <polygon points="620,196 700,196 660,168" className="in2-roof" />
            {[626, 642, 658, 674, 690].map((x) => <rect key={x} x={x - 4} y="200" width="8" height="34" className="in2-col" />)}
            <rect x="612" y="234" width="96" height="16" rx="3" className="in2-block" />
            <rect x="618" y="198" width="84" height="4" className="in2-block" />
          </g>
          <circle cx={START.x} cy={START.y} r="26" className="in2-halo" />
          <circle cx={START.x} cy={START.y} r="9" className="in2-spark" ref={sparkRef} />
        </svg>
      </div>

      <div className={`in2-brand ${logoOn ? 'on' : ''}`}>
        <svg className="in2-logo" viewBox="0 0 64 64" fill="none" aria-hidden="true">
          <path className="g-l" d="M6 30 A24 24 0 0 1 30 6 V30 Z" />
          <path className="g-r" d="M58 30 A24 24 0 0 0 34 6 V30 Z" />
          <circle className="g-c" cx="18" cy="46" r="12" />
          <rect className="g-s" x="34" y="34" width="24" height="24" />
        </svg>
        <h1 className="in2-title" aria-label="Startup2Sarkar">
          {NAME.map((ch, i) => <span key={i} className={ch === '2' ? 'two' : ''} style={{ transitionDelay: `${300 + i * 45}ms` }} aria-hidden="true">{ch}</span>)}
        </h1>
      </div>
      <p className={`in2-tag ${phase >= 3 ? 'on' : ''}`}>Build for Bharat, reach millions.</p>
      <div className="in2-bar" aria-hidden="true"><i style={{ animationDuration: `${TOTAL_MS}ms` }} /></div>
    </div>
  );
}
