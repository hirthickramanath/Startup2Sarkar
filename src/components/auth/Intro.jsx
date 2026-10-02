import React, { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Skippable brand intro. ~6.5s: a spark (the startup) crosses a bridge to the institution (the sarkar),
 * the span connects, mo.js bursts, then the name and tagline resolve.
 * Skip: button, Esc, Enter, Space or click. Plays once per browser session; honours prefers-reduced-motion.
 */
const NAME = 'Startup2Sarkar'.split('');
// Points on the cubic arch (same curve as #span) where the suspender lines hang down to the deck
const bez = (t, a, b, c, d) => (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t ** 2 * c + t ** 3 * d;
const HANGERS = [0.12, 0.22, 0.32, 0.42, 0.5, 0.58, 0.68, 0.78, 0.88].map((t) => ({ x: bez(t, 148, 270, 530, 652), y: bez(t, 232, 70, 70, 232) }));
const TOTAL_MS = 6600;

export function Intro({ onDone }) {
  const [phase, setPhase] = useState(0); // 0 draw → 1 connect → 2 title → 3 tagline
  const [leaving, setLeaving] = useState(false);
  const targetRef = useRef(null);
  const stageRef = useRef(null);
  const finished = useRef(false);

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    setLeaving(true);
    setTimeout(onDone, 450);
  }, [onDone]);

  // Timeline
  useEffect(() => {
    const t = [
      setTimeout(() => setPhase(1), 2500),
      setTimeout(() => setPhase(2), 3300),
      setTimeout(() => setPhase(3), 4700),
      setTimeout(finish, TOTAL_MS),
    ];
    return () => t.forEach(clearTimeout);
  }, [finish]);

  // mo.js bursts when the span connects (lazy-loaded; the intro still works if it fails to load)
  useEffect(() => {
    if (phase !== 1) return undefined;
    let burst, ring, cancelled = false;
    import('@mojs/core').then((m) => {
      const mojs = m.default || m;
      if (cancelled || !stageRef.current || !targetRef.current) return;
      const stage = stageRef.current.getBoundingClientRect();
      const tgt = targetRef.current.getBoundingClientRect();
      const x = tgt.left - stage.left + tgt.width / 2;
      const y = tgt.top - stage.top + tgt.height * 0.55;
      const colors = ['#FF9933', '#FFFFFF', '#138808', '#60a5fa'];
      burst = new mojs.Burst({
        parent: stageRef.current, left: x, top: y, radius: { 20: 130 }, count: 16, angle: { 0: 90 },
        children: { shape: 'line', stroke: colors, strokeWidth: { 3: 0 }, scale: 1, scaleX: { 1: 0 }, radius: { 6: 12 }, degreeShift: 'rand(-20, 20)', duration: 900, easing: 'cubic.out' },
      });
      ring = new mojs.Shape({
        parent: stageRef.current, left: x, top: y, shape: 'circle', fill: 'none', stroke: '#93c5fd', strokeWidth: { 10: 0 }, radius: { 10: 110 }, opacity: { 1: 0 }, duration: 800, easing: 'cubic.out',
      });
      burst.play(); ring.play();
    }).catch(() => { /* decorative only */ });
    return () => { cancelled = true; };
  }, [phase]);

  useEffect(() => {
    const onKey = (e) => { if (['Escape', 'Enter', ' '].includes(e.key)) { e.preventDefault(); finish(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finish]);

  return (
    <div className={`intro ${leaving ? 'leave' : ''}`} role="dialog" aria-label="Welcome to Startup2Sarkar" onClick={finish}>
      <div className="intro-grid" aria-hidden="true" />
      <button type="button" className="intro-skip" onClick={(e) => { e.stopPropagation(); finish(); }}>Skip intro <kbd>Esc</kbd></button>

      <div className="intro-stage" ref={stageRef}>
        <svg viewBox="0 0 800 300" className="intro-svg" aria-hidden="true">
          <defs>
            <linearGradient id="gSpan" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#FF9933" /><stop offset=".5" stopColor="#ffffff" /><stop offset="1" stopColor="#138808" />
            </linearGradient>
            <radialGradient id="gSpark"><stop offset="0" stopColor="#fff" /><stop offset="1" stopColor="#FF9933" stopOpacity="0" /></radialGradient>
          </defs>

          {/* ground line */}
          <line x1="40" y1="250" x2="760" y2="250" className="i-ground" />

          {/* Startup: a spark on a small pedestal */}
          <g className="i-startup">
            <rect x="92" y="232" width="56" height="18" rx="3" className="i-block" />
            <circle cx="120" cy="214" r="22" fill="url(#gSpark)" className="i-pulse" />
            <circle cx="120" cy="214" r="9" fill="#fff" opacity=".25" /><circle cx="120" cy="214" r="6" fill="#fff" />
            {[0, 60, 120, 180, 240, 300].map((a) => (
              <line key={a} x1="120" y1="214" x2={120 + Math.cos((a * Math.PI) / 180) * 17} y2={214 + Math.sin((a * Math.PI) / 180) * 17} className="i-ray" />
            ))}
          </g>

          {/* Bridge span: an arch drawn left → right */}
          <path d="M 148 232 C 270 70, 530 70, 652 232" className="i-span-glow" pathLength="1" />
          <path id="span" d="M 148 232 C 270 70, 530 70, 652 232" className="i-span" pathLength="1" />
          {HANGERS.map((h, i) => (
            <line key={i} x1={h.x} y1={h.y} x2={h.x} y2="232" className="i-hanger" style={{ animationDelay: `${0.9 + i * 0.12}s` }} />
          ))}

          {/* the traveller */}
          <circle r="11" fill="url(#gSpark)" className="i-trav-halo">
            <animateMotion dur="2.3s" begin="0.4s" fill="freeze" keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.45 0 0.2 1"><mpath href="#span" /></animateMotion>
          </circle>
          <circle r="5" fill="#fff" className="i-trav">
            <animateMotion dur="2.3s" begin="0.4s" fill="freeze" keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.45 0 0.2 1"><mpath href="#span" /></animateMotion>
          </circle>

          {/* Sarkar: a columned institution */}
          <g className={`i-gov ${phase >= 1 ? 'lit' : ''}`} ref={targetRef}>
            <polygon points="620,196 700,196 660,168" className="i-roof" />
            {[626, 642, 658, 674, 690].map((x) => <rect key={x} x={x - 4} y="200" width="8" height="34" className="i-col" />)}
            <rect x="612" y="234" width="96" height="16" rx="2" className="i-block" />
            <rect x="618" y="198" width="84" height="4" className="i-block" />
          </g>
        </svg>
      </div>

      <h1 className={`intro-title ${phase >= 2 ? 'on' : ''}`} aria-label="Startup2Sarkar">
        {NAME.map((ch, i) => (
          <span key={i} className={ch === '2' ? 'two' : ''} style={{ transitionDelay: `${i * 55}ms` }} aria-hidden="true">{ch}</span>
        ))}
      </h1>
      <p className={`intro-tag ${phase >= 3 ? 'on' : ''}`}>Build for Bharat, reach millions.</p>
      <div className="intro-bar" aria-hidden="true"><i style={{ animationDuration: `${TOTAL_MS}ms` }} /></div>
    </div>
  );
}
