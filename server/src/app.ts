import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import fastifyStatic from '@fastify/static';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { DatabaseAdapter, getDatabase, runMigrations } from './db';
import { AuditService } from './audit';
import { SovereignAiProvider, AiProvider } from './ai';
import { LocalStorageProvider, ManualTreasuryProvider, createEmailProvider, EmailProvider } from './adapters';
import { JwksFetcher } from './security';

import { authRoutes } from './routes/auth';
import { challengeRoutes } from './routes/challenges';
import { proposalRoutes } from './routes/proposals';
import { pilotRoutes } from './routes/pilots';
import { financeRoutes } from './routes/finance';
import { adminRoutes } from './routes/admin';
import { assistantRoutes } from './routes/assistant';
import { identityRoutes } from './routes/identity';
import { networkRoutes } from './routes/network';
import { publicRoutes, fileRoutes, notificationRoutes, searchRoutes, auditViewRoutes } from './routes/platform';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface AppOptions {
  db?: DatabaseAdapter;
  aiProvider?: AiProvider;
  /** Test hook: supply Google's signing keys instead of fetching them over the network */
  jwksFetcher?: JwksFetcher;
  /** Test hook: replace the network client used to talk to GitHub */
  githubFetch?: typeof fetch;
  /** Test hook / alternative mail provider */
  emailProvider?: EmailProvider;
  /** Directory of the built SPA; defaults to <repo>/dist */
  staticDir?: string;
}

const IS_PROD = process.env.NODE_ENV === 'production';

function cookieSecret(): string {
  const v = process.env.COOKIE_SECRET;
  if (v && v.length >= 32) return v;
  if (IS_PROD) throw new Error('FATAL: COOKIE_SECRET must be set (min 32 chars) when NODE_ENV=production');
  return 's2s_dev_only_cookie_secret_not_for_production_0123456789';
}

/** Content-Security-Policy: first-party only, plus exactly what Google Sign-In and Google Fonts need. */
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://accounts.google.com/gsi/client",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com/gsi/style",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https://*.googleusercontent.com",
  "connect-src 'self' https://accounts.google.com/gsi/",
  "frame-src https://accounts.google.com/gsi/",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'"
].join('; ');

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: process.env.NODE_ENV === 'test' || process.env.NODE_TEST_CONTEXT ? false : { level: process.env.LOG_LEVEL || 'info' },
    // Behind Render / Fly / Cloud Run / nginx the real client IP is in X-Forwarded-For (needed for rate limits + audit IPs)
    trustProxy: process.env.TRUST_PROXY ? process.env.TRUST_PROXY !== 'false' : IS_PROD,
    bodyLimit: 2 * 1024 * 1024
  });

  // Tolerate action endpoints called with `Content-Type: application/json` and no body (publish, logout, read-all…),
  // while still dropping `__proto__` keys from real payloads (prototype-pollution guard).
  const strictJson = (raw: string) => JSON.parse(raw, (k, v) => (k === '__proto__' ? undefined : v));
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const raw = String(body ?? '').trim();
    if (!raw) return done(null, {});
    try { done(null, strictJson(raw)); } catch (e: any) { e.statusCode = 400; done(e, undefined); }
  });

  const db = options.db || getDatabase();
  await runMigrations(db);

  const auditService = new AuditService(db);
  const aiProvider = options.aiProvider || new SovereignAiProvider();
  const storageProvider = new LocalStorageProvider();
  const treasuryProvider = new ManualTreasuryProvider();
  const emailProvider = options.emailProvider ?? createEmailProvider();

  // 1. Security plugins ───────────────────────────────────────────────
  const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map((o) => o.trim()).filter(Boolean);
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // same-origin / curl
      if (allowedOrigins.includes(origin)) return cb(null, true);
      if (!IS_PROD && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return cb(null, true);
      cb(null, false); // not allowed: browser blocks it; we don't throw (no 500s for random origins)
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  });

  await app.register(cookie, { secret: cookieSecret() });

  await app.register(rateLimit, {
    global: true,
    max: parseInt(process.env.RATE_LIMIT_MAX || '300', 10),
    timeWindow: '1 minute',
    allowList: (req) => req.url === '/health' || req.url === '/ready'
  });

  app.addHook('onSend', async (request, reply) => {
    if (!request.url.startsWith('/docs')) reply.header('Content-Security-Policy', CSP);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    // Google Identity Services opens a popup; same-origin-allow-popups keeps it working
    reply.header('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    if (IS_PROD) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
  });

  // 2. OpenAPI docs (dev, or explicitly enabled) ────────────────────────
  if (!IS_PROD || process.env.ENABLE_DOCS === 'true') {
    await app.register(swagger, {
      openapi: { info: { title: 'Startup2Sarkar API', description: 'Government innovation-procurement platform', version: '1.0.0' }, servers: [{ url: '/api/v1' }] }
    });
    await app.register(swaggerUi, { routePrefix: '/docs' });
  }

  // 3. Health ────────────────────────────────────────────────────────────
  app.get('/health', async () => ({ status: 'UP', timestamp: new Date().toISOString() }));
  app.get('/ready', async () => {
    await db.query('SELECT 1');
    return { status: 'READY', db: 'CONNECTED' };
  });

  // 4. API ───────────────────────────────────────────────────────────────
  app.register(async (api) => {
    api.register(authRoutes, { prefix: '/auth', db, auditService });
    api.register(identityRoutes, { prefix: '/auth', db, auditService, jwksFetcher: options.jwksFetcher, githubFetch: options.githubFetch, emailProvider });
    api.register(networkRoutes, { prefix: '/network', db, auditService });
    api.register(challengeRoutes, { prefix: '/challenges', db, auditService, aiProvider });
    api.register(proposalRoutes, { prefix: '/proposals', db, auditService, aiProvider });
    api.register(pilotRoutes, { prefix: '/pilots', db, auditService });
    api.register(financeRoutes, { prefix: '/finance', db, auditService, treasuryProvider, aiProvider });
    api.register(adminRoutes, { prefix: '/admin', db, auditService, emailProvider });
    api.register(assistantRoutes, { prefix: '/assistant', db, auditService, aiProvider });
    api.register(publicRoutes, { prefix: '/public', db });
    api.register(fileRoutes, { prefix: '/files', db, auditService, storageProvider });
    api.register(notificationRoutes, { prefix: '/notifications', db });
    api.register(searchRoutes, { prefix: '/search', db });
    api.register(auditViewRoutes, { prefix: '/audit', db });
  }, { prefix: '/api/v1' });

  // 5. Single-service deployment: serve the built SPA from the same origin ──────
  const staticDir = options.staticDir || path.join(__dirname, '..', '..', 'dist');
  const hasSpa = fs.existsSync(path.join(staticDir, 'index.html'));
  if (hasSpa) {
    await app.register(fastifyStatic, {
      root: staticDir,
      wildcard: false,
      setHeaders: (res, filePath) => {
        // hashed build assets are immutable; index.html must always be revalidated
        const value = filePath.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
        const r = res as any;
        if (typeof r.setHeader === 'function') r.setHeader('Cache-Control', value);
        else if (typeof r.header === 'function') r.header('Cache-Control', value);
      }
    });
  }

  app.setNotFoundHandler((request, reply) => {
    const isApi = request.url.startsWith('/api/') || request.url.startsWith('/docs');
    if (hasSpa && request.method === 'GET' && !isApi && (request.headers.accept || '').includes('text/html')) {
      return reply.type('text/html').header('Cache-Control', 'no-cache').send(fs.createReadStream(path.join(staticDir, 'index.html')));
    }
    return reply.status(404).send({ error: 'Not found', code: 'NOT_FOUND' });
  });

  // 6. Error handler — never leak stack traces ───────────────────────────
  app.setErrorHandler((error: any, request, reply) => {
    if (error?.validation || error?.statusCode === 400) {
      return reply.status(400).send({ error: error.message, code: 'BAD_REQUEST' });
    }
    if (error?.statusCode && error.statusCode < 500) {
      return reply.status(error.statusCode).send({ error: error.message, code: error.code || 'REQUEST_ERROR' });
    }
    if (process.env.DEBUG_TEST_ERRORS) console.error('[unhandled]', request.method, request.url, error);
    app.log.error({ err: error, url: request.url }, 'Unhandled error');
    return reply.status(500).send({ error: 'An internal server error occurred. Transaction halted.', code: 'INTERNAL_SERVER_ERROR' });
  });

  return app;
}
