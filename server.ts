import { buildApp } from './app';
import { getDatabase, runMigrations } from './db';
import { AuditService } from './audit';
import { SovereignJobScheduler } from './scheduler';
import { hashPassword, validatePasswordStrength, generateTempPassword } from './security';

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';

/**
 * First-run bootstrap. The platform ships with NO demo data. The only record ever created automatically
 * is the very first Super Admin, from ADMIN_EMAIL (+ ADMIN_PASSWORD if you want to choose it).
 * If ADMIN_PASSWORD is omitted a strong random one is generated and printed ONCE to the server log.
 * The admin can also sign in with Google using the same email once GOOGLE_CLIENT_ID is configured.
 */
export async function bootstrapFirstAdmin(db = getDatabase(), audit = new AuditService(db)): Promise<void> {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (!email) return;

  const anyAdmin = await db.query(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
  if (anyAdmin.rows.length > 0) return;

  const existing = await db.query('SELECT id FROM users WHERE LOWER(email) = $1', [email]);
  if (existing.rows.length > 0) {
    console.warn(`[bootstrap] ADMIN_EMAIL ${email} already belongs to a non-admin user; skipping.`);
    return;
  }

  let password = process.env.ADMIN_PASSWORD;
  let generated = false;
  if (password) {
    const strength = validatePasswordStrength(password);
    if (!strength.valid) throw new Error(`ADMIN_PASSWORD rejected: ${strength.errors.join('; ')}`);
  } else {
    password = generateTempPassword(20);
    generated = true;
  }

  const id = `USR-ADMIN-${Date.now().toString(36).toUpperCase()}`;
  const name = process.env.ADMIN_NAME || 'Platform Administrator';
  await db.query(
    `INSERT INTO users (id, email, password_hash, role, name, designation, must_change_password, is_active)
     VALUES ($1, $2, $3, 'admin', $4, 'Super Administrator', $5, TRUE)`,
    [id, email, await hashPassword(password), name, generated || process.env.ADMIN_FORCE_PASSWORD_CHANGE === 'true']
  );
  await audit.logEvent({
    actorId: id, actorName: name, actorRole: 'admin', action: 'SUPER_ADMIN_BOOTSTRAPPED',
    entityType: 'USER', entityId: id, details: { email, passwordGenerated: generated },
    ipAddress: '127.0.0.1', userAgent: 'server-bootstrap'
  });

  console.log('────────────────────────────────────────────────────────────');
  console.log(' First Super Admin created');
  console.log(`   email:    ${email}`);
  if (generated) console.log(`   password: ${password}   (shown once — change it after first login)`);
  console.log('────────────────────────────────────────────────────────────');
}

async function start() {
  try {
    const db = getDatabase();
    await runMigrations(db);
    const auditService = new AuditService(db);
    await bootstrapFirstAdmin(db, auditService);

    const app = await buildApp({ db });
    const scheduler = new SovereignJobScheduler({ db, auditService });
    scheduler.start();

    const shutdown = async () => {
      scheduler.stop();
      await app.close();
      await db.close();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    await app.listen({ port: PORT, host: HOST });
    console.log(`Startup2Sarkar listening on http://${HOST}:${PORT}  (health: /health)`);
  } catch (err) {
    console.error('Failed to start S2S server:', err);
    process.exit(1);
  }
}

// Only auto-start when executed directly (so tests can import bootstrapFirstAdmin)
if (process.argv[1] && /server\.(ts|js)$/.test(process.argv[1])) {
  start();
}
