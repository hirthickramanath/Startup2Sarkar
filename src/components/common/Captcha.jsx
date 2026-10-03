import React, { useEffect, useRef } from 'react';
import { useAuth, useTheme } from '../../store';

/** Cloudflare Turnstile. Renders nothing when no site key is configured on the server (the check is then off). */
export function Captcha({ onToken }) {
  const { config } = useAuth();
  const { mode } = useTheme();
  const ref = useRef(null);
  const cb = useRef(onToken);
  cb.current = onToken;
  const key = config.turnstileSiteKey;

  useEffect(() => {
    if (!key || !ref.current) return undefined;
    let widget; let cancelled = false;
    const mount = () => {
      if (cancelled || !window.turnstile || !ref.current) return;
      ref.current.innerHTML = '';
      widget = window.turnstile.render(ref.current, { sitekey: key, theme: mode === 'dark' ? 'dark' : 'light', callback: (t) => cb.current(t), 'expired-callback': () => cb.current(null), 'error-callback': () => cb.current(null) });
    };
    if (window.turnstile) mount();
    else {
      let s = document.getElementById('turnstile-script');
      if (!s) { s = document.createElement('script'); s.id = 'turnstile-script'; s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; s.async = true; s.defer = true; document.head.appendChild(s); }
      s.addEventListener('load', mount);
    }
    return () => { cancelled = true; try { if (widget !== undefined) window.turnstile?.remove(widget); } catch { /* already gone */ } };
  }, [key, mode]);

  if (!key) return null;
  return <div ref={ref} style={{ display: 'flex', justifyContent: 'center', minHeight: 65 }} aria-label="Human check" />;
}
