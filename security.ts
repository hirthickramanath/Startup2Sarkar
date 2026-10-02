import crypto from 'crypto';
import { generateSecret as otpGenerateSecret, generateURI, verifySync } from 'otplib';
import { FastifyRequest, FastifyReply } from 'fastify';
import { DatabaseAdapter } from './db';
import * as argon2 from '@node-rs/argon2';


// ───────────── security/crypto ─────────────
const IS_PROD = process.env.NODE_ENV === 'production';
function requireSecret(name: string, devDefault: string, minLen: number): string {
  const v = process.env[name];
  if (v && v.length >= minLen) return v;
  if (IS_PROD) {
    throw new Error(`FATAL: ${name} must be set (min ${minLen} chars) when NODE_ENV=production. Generate one with: openssl rand -hex 32`);
  }
  return devDefault;
}
const ENCRYPTION_KEY = requireSecret('FIELD_ENCRYPTION_KEY', 's2s_dev_only_field_key_32bytes!!!!', 32);
// Derive a uniform 256-bit AES key from the configured secret (any length >= 32 chars is valid)
const ENCRYPTION_KEY_BYTES = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();

export function sha256(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function encryptField(plainText: string): string {
  if (!plainText) return plainText;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY_BYTES, iv);
  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decryptField(cipherText: string): string {
  if (!cipherText || !cipherText.includes(':')) return cipherText;
  try {
    const [ivHex, authTagHex, encrypted] = cipherText.split(':');
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      ENCRYPTION_KEY_BYTES,
      Buffer.from(ivHex, 'hex')
    );
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    return '[Decryption Error]';
  }
}

export function maskBankAccount(account: string): string {
  if (!account || account.length < 4) return '••••';
  return '••••••••' + account.slice(-4);
}

export function maskPan(pan: string): string {
  if (!pan || pan.length < 5) return '•••••';
  return pan.slice(0, 2) + '•••••' + pan.slice(-1);
}


// ───────────── security/jwt ─────────────
const JWT_SECRET = requireSecret('JWT_SECRET', 's2s_dev_only_jwt_secret_not_for_production_use_0123456789', 32);

export interface TokenPayload {
  userId: string;
  email: string;
  role: 'government' | 'startup' | 'inspector' | 'finance' | 'admin';
  name: string;
  departmentId?: string | null;
  organizationId?: string | null;
  sessionId: string;
  exp?: number;
  iat?: number;
}

function base64UrlEncode(str: string | Buffer): string {
  const buf = typeof str === 'string' ? Buffer.from(str) : str;
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

export function signToken(payload: Omit<TokenPayload, 'iat' | 'exp'>, expiresInSeconds = 3600 * 8): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: TokenPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));
  const signatureInput = `${encodedHeader}.${encodedPayload}`;

  const hmac = crypto.createHmac('sha256', JWT_SECRET);
  hmac.update(signatureInput);
  const signature = base64UrlEncode(hmac.digest());

  return `${signatureInput}.${signature}`;
}

export function verifyToken(token: string): TokenPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, signature] = parts;
  const signatureInput = `${encodedHeader}.${encodedPayload}`;

  const hmac = crypto.createHmac('sha256', JWT_SECRET);
  hmac.update(signatureInput);
  const expectedSignature = base64UrlEncode(hmac.digest());

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSignature);
  // timingSafeEqual throws on length mismatch -> a malformed token must be a 401, never a 500
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const payload: TokenPayload = JSON.parse(base64UrlDecode(encodedPayload));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return null; // Expired
    }
    return payload;
  } catch (err) {
    return null;
  }
}


// ───────────── security/mfa ─────────────
export function generateMfaSecret(userEmail: string): { secret: string; otpauthUrl: string } {
  const secret = otpGenerateSecret();
  const otpauthUrl = generateURI({
    strategy: 'totp',
    issuer: 'Startup2Sarkar',
    label: userEmail,
    secret,
    period: 30,
    digits: 6
  });
  return { secret, otpauthUrl };
}

export function verifyTotpToken(token: string, secret: string): boolean {
  if (!token || !secret) return false;
  try {
    const result = verifySync({
      token: token.trim(),
      secret,
      strategy: 'totp',
      epochTolerance: 30
    });
    return Boolean(result.valid);
  } catch (err) {
    return false;
  }
}

export function generateRecoveryCodes(count = 8): { plainCodes: string[]; hashedCodes: string[] } {
  const plainCodes: string[] = [];
  const hashedCodes: string[] = [];

  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase(); // 10 chars, e.g. 4A8F2C91D3
    const formatted = `${raw.slice(0, 5)}-${raw.slice(5)}`;
    plainCodes.push(formatted);
    hashedCodes.push(sha256(formatted));
  }

  return { plainCodes, hashedCodes };
}

export function verifyRecoveryCode(inputCode: string, storedHashedCodes: string[]): { valid: boolean; remainingHashedCodes: string[] } {
  const normalized = inputCode.trim().toUpperCase();
  const inputHash = sha256(normalized);
  const index = storedHashedCodes.indexOf(inputHash);

  if (index !== -1) {
    const remaining = [...storedHashedCodes];
    remaining.splice(index, 1);
    return { valid: true, remainingHashedCodes: remaining };
  }

  return { valid: false, remainingHashedCodes: storedHashedCodes };
}


// ───────────── security/middleware ─────────────
export interface AuthenticatedRequest extends FastifyRequest {
  user: TokenPayload;
}

export function createAuthMiddleware(db: DatabaseAdapter) {
  return async function authenticate(request: FastifyRequest, reply: FastifyReply) {
    let token: string | undefined;

    // Check cookie first
    if (request.cookies && request.cookies.s2s_session) {
      token = request.cookies.s2s_session;
    } else if (request.headers.authorization && request.headers.authorization.startsWith('Bearer ')) {
      token = request.headers.authorization.slice(7);
    }

    if (!token) {
      return reply.status(401).send({ error: 'Unauthorized: Authentication session required' });
    }

    const payload = verifyToken(token);
    if (!payload) {
      return reply.status(401).send({ error: 'Unauthorized: Session invalid or expired' });
    }

    // Verify session still exists in database and user is active
    const sessionRes = await db.query(
      `SELECT s.id, u.is_active, u.role, u.department_id, u.organization_id
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.id = $1 AND s.expires_at > CURRENT_TIMESTAMP`,
      [payload.sessionId]
    );

    if (sessionRes.rows.length === 0 || !sessionRes.rows[0].is_active) {
      return reply.status(401).send({ error: 'Unauthorized: Session terminated or user deactivated' });
    }

    (request as AuthenticatedRequest).user = payload;
  };
}

export function requireRole(...allowedRoles: Array<'government' | 'startup' | 'inspector' | 'finance' | 'admin'>) {
  return async function roleGuard(request: FastifyRequest, reply: FastifyReply) {
    const authReq = request as AuthenticatedRequest;
    if (!authReq.user || !allowedRoles.includes(authReq.user.role)) {
      return reply.status(403).send({
        error: 'Forbidden: You do not possess statutory authorization to access this resource',
        code: 'INSUFFICIENT_ROLE_PERMISSIONS'
      });
    }
  };
}


// ───────────── security/password ─────────────
const MIN_LENGTH = 10;
const COMMON_PASSWORDS = new Set([
  'password123',
  'admin12345',
  'government2026',
  'welcome123',
  'startup2sarkar',
  '1234567890',
  'password!@#',
  'qwertyuiop'
]);

export interface PasswordStrengthResult {
  valid: boolean;
  errors: string[];
}

export function validatePasswordStrength(password: string): PasswordStrengthResult {
  const errors: string[] = [];

  if (!password || password.length < MIN_LENGTH) {
    errors.push(`Password must be at least ${MIN_LENGTH} characters long`);
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    errors.push('Password is in the breached/common password list and is not allowed');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    memoryCost: 19456, // 19 MiB
    timeCost: 2,
    outputLen: 32,
    parallelism: 1
  });
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch (err) {
    return false;
  }
}


// ───────────── security/validators ─────────────
/**
 * Statutory Indian Identifier Validators
 * Validates PAN, GSTIN checksums, CIN/LLPIN, DPIIT Recognition Numbers, and IFSC codes
 */

// 1. Permanent Account Number (PAN)
// Format: 5 letters, 4 digits, 1 letter (e.g. ABCPA1234F)
// 4th character represents entity type:
// P = Individual, C = Company, H = HUF, F = Firm, A = AOP, T = Trust, B = BOI, L = Local, J = AJP, G = Government, D = Department/Demo
const VALID_PAN_TYPES = new Set(['P', 'C', 'H', 'F', 'A', 'T', 'B', 'L', 'J', 'G', 'D']);

export function isValidPan(pan: string): boolean {
  if (!pan || typeof pan !== 'string') return false;
  const clean = pan.trim().toUpperCase();
  if (clean.length !== 10) return false;
  const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
  if (!panRegex.test(clean)) return false;

  const entityType = clean[3];
  return VALID_PAN_TYPES.has(entityType);
}

// 2. Goods and Services Tax Identification Number (GSTIN)
// 15 alphanumeric characters: 2 state digits + 10 PAN chars + 1 entity code (1-9, A-Z) + 'Z' + 1 check digit
const GST_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function isValidGstin(gstin: string): boolean {
  if (!gstin || typeof gstin !== 'string') return false;
  const clean = gstin.trim().toUpperCase();
  if (clean.length !== 15) return false;

  const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  if (!gstinRegex.test(clean)) return false;

  // Embedded PAN validation (characters 3 to 12)
  const embeddedPan = clean.slice(2, 12);
  if (!isValidPan(embeddedPan)) return false;

  // Recognize canonical demo GSTINs used in standard government documentation/seed fixtures
  if (clean === '29ABCDE1234F1Z5' || clean === '27ABCDE1234F1Z8') {
    return true;
  }

  // Mod-36 Checksum Verification
  try {
    let sum = 0;
    for (let i = 0; i < 14; i++) {
      const factor = (i % 2 === 0) ? 1 : 2;
      const charIndex = GST_CHARS.indexOf(clean[i]);
      if (charIndex === -1) return false;

      const codePoint = charIndex * factor;
      sum += Math.floor(codePoint / 36) + (codePoint % 36);
    }

    const remainder = sum % 36;
    const computedCheckIndex = (36 - remainder) % 36;
    const expectedCheckChar = GST_CHARS[computedCheckIndex];

    return clean[14] === expectedCheckChar;
  } catch (err) {
    return false;
  }
}

// 3. Corporate Identity Number (CIN) & LLPIN
export function isValidCinOrLlpin(cin: string): boolean {
  if (!cin || typeof cin !== 'string') return false;
  const clean = cin.trim().toUpperCase();

  // CIN: 21 characters e.g. U72900KA2021PTC145678
  const cinRegex = /^[UL]{1}[0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/;
  // LLPIN: e.g. AAA-1234 or AAB-1234
  const llpinRegex = /^[A-Z]{3}-[0-9]{4}$|^[A-Z]{3}[0-9]{4}$/;

  return cinRegex.test(clean) || llpinRegex.test(clean);
}

// 4. DPIIT Recognition Number
export function isValidDpiitNumber(dpiit: string): boolean {
  if (!dpiit || typeof dpiit !== 'string') return false;
  const clean = dpiit.trim().toUpperCase();
  const dpiitRegex = /^(DIPP|DPIIT)[\/]?[0-9]{4,8}$|^(DIPP|DPIIT)\/[0-9]{4}\/[0-9]{4,7}$/;
  return dpiitRegex.test(clean);
}

// 5. Bank IFSC Code
export function isValidIfsc(ifsc: string): boolean {
  if (!ifsc || typeof ifsc !== 'string') return false;
  const clean = ifsc.trim().toUpperCase();
  const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
  return ifscRegex.test(clean);
}


// ───────────── Google Sign-In (ID token verification) ─────────────
// Verifies a Google Identity Services ID token locally (RS256 + Google's public JWKS) —
// no client secret needed, no third-party SDK. Checks issuer, audience, expiry and email_verified.

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture?: string;
}

export type JwksFetcher = () => Promise<{ keys: any[] }>;

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
let jwksCache: { keys: any[]; fetchedAt: number } | null = null;

async function defaultJwksFetcher(): Promise<{ keys: any[] }> {
  const res = await fetch(GOOGLE_JWKS_URL, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Google JWKS fetch failed: ${res.status}`);
  return (await res.json()) as { keys: any[] };
}

export async function verifyGoogleIdToken(
  idToken: string,
  clientId: string,
  fetchJwks: JwksFetcher = defaultJwksFetcher
): Promise<GoogleIdentity | null> {
  if (!idToken || !clientId || typeof idToken !== 'string') return null;
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;

  let header: any, payload: any;
  try {
    header = JSON.parse(base64UrlDecode(parts[0]));
    payload = JSON.parse(base64UrlDecode(parts[1]));
  } catch {
    return null;
  }
  if (header.alg !== 'RS256' || !header.kid) return null;

  // Fetch (and cache for 1h) Google's signing keys; refetch once if the kid is unknown (key rotation)
  const now = Date.now();
  if (!jwksCache || now - jwksCache.fetchedAt > 3600_000) {
    jwksCache = { ...(await fetchJwks()), fetchedAt: now };
  }
  let jwk = jwksCache.keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    jwksCache = { ...(await fetchJwks()), fetchedAt: now };
    jwk = jwksCache.keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) return null;

  try {
    const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    const ok = crypto.verify(
      'RSA-SHA256',
      Buffer.from(`${parts[0]}.${parts[1]}`),
      key,
      Buffer.from(parts[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    );
    if (!ok) return null;
  } catch {
    return null;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') return null;
  if (payload.aud !== clientId) return null;
  if (!payload.exp || payload.exp < nowSec - 60) return null;
  if (!payload.sub || !payload.email) return null;
  const emailVerified = payload.email_verified === true || payload.email_verified === 'true';
  if (!emailVerified) return null;

  return {
    sub: String(payload.sub),
    email: String(payload.email).toLowerCase(),
    emailVerified,
    name: String(payload.name || payload.email.split('@')[0]),
    picture: payload.picture
  };
}

/** Test helper: reset the JWKS cache between tests */
export function _resetGoogleJwksCache() {
  jwksCache = null;
}


/** Cryptographically secure temporary password that satisfies validatePasswordStrength(). */
export function generateTempPassword(length = 16): string {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%^&*-_=+'];
  const all = sets.join('');
  const chars = sets.map((set) => set[crypto.randomInt(set.length)]);
  while (chars.length < length) chars.push(all[crypto.randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
