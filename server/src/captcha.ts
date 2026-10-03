/**
 * Cloudflare Turnstile verification. Switched on by setting TURNSTILE_SECRET_KEY.
 * It fails CLOSED: when it is on, a missing token, a wrong token, or an unreachable verifier all refuse the request.
 */
export const captchaEnabled = () => !!process.env.TURNSTILE_SECRET_KEY;

export async function verifyCaptcha(token: unknown, ip: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  if (typeof token !== 'string' || token.length < 10 || token.length > 4096) return false;
  try {
    const res = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token, remoteip: ip }).toString(),
      signal: AbortSignal.timeout(6000)
    });
    const json: any = await res.json();
    return json?.success === true;
  } catch {
    return false;
  }
}
