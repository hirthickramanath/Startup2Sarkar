import { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import crypto from 'crypto';
import { DatabaseAdapter } from '../db';
import { AuditService } from '../audit';
import { verifyCaptcha } from '../captcha';
import { hashPassword, verifyPassword, validatePasswordStrength, generateMfaSecret, verifyTotpToken, generateRecoveryCodes, verifyRecoveryCode, signToken, verifyToken, isValidPan, isValidGstin, isValidCinOrLlpin, isValidDpiitNumber, isValidIfsc, encryptField, maskBankAccount, maskPan, sha256, AuthenticatedRequest, createAuthMiddleware, requireRole, staffMfaRequired, STAFF_ROLES } from '../security';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  role: z.enum(['government', 'startup', 'inspector', 'finance', 'admin', 'investor']),
  captchaToken: z.string().optional()
});

const registerStartupSchema = z.object({
  startupName: z.string().min(2),
  founderName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(10),
  phone: z.string().min(10),
  website: z.string().url().optional().or(z.literal('')),
  sector: z.string().min(2),
  dpiitNumber: z.string().min(4),
  cinLlpin: z.string().min(6),
  pan: z.string().length(10),
  gstin: z.string().length(15),
  bankAccountNumber: z.string().min(8),
  ifscCode: z.string().length(11)
});

export async function authRoutes(app: FastifyInstance, opts: { db: DatabaseAdapter; auditService: AuditService; captchaFetch?: typeof fetch }) {
  const { db, auditService } = opts;
  const AUTH_RATE = { config: { rateLimit: { max: parseInt(process.env.AUTH_RATE_MAX || '10', 10), timeWindow: '1 minute' } } };

  const PRIVILEGED = ['government', 'inspector', 'finance', 'admin'];

  const authenticate = createAuthMiddleware(db);

  // 1. Multi-Role Login Gateway (Spec Section 6, 20, 35, 46, 69)
  app.post('/login', AUTH_RATE, async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = loginSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Invalid login payload format', details: parseResult.error.format() });
    }

    const { email, password, role } = parseResult.data;
    const ip = request.ip || '127.0.0.1';
    const userAgent = request.headers['user-agent'] || 'Unknown';

    // Query user by email
    const userRes = await db.query(
      `SELECT u.*, o.verification_status as org_verification_status
       FROM users u
       LEFT JOIN organizations o ON u.organization_id = o.id
       WHERE LOWER(u.email) = LOWER($1)`,
      [email]
    );

    // Generic error message for both non-existent user and wrong password (prevents user enumeration)
    const genericAuthError = {
      error: 'Invalid credentials or unauthorized login gateway for this operational identity',
      code: 'AUTH_FAILED'
    };

    if (userRes.rows.length === 0) {
      await auditService.logEvent({
        actorId: 'ANONYMOUS',
        actorName: email,
        actorRole: role,
        action: 'AUTH_LOGIN_FAILED_UNKNOWN_USER',
        entityType: 'AUTH',
        entityId: email,
        details: { targetRole: role },
        ipAddress: ip,
        userAgent
      });
      return reply.status(401).send(genericAuthError);
    }

    const user = userRes.rows[0];

    // Check account lockout
    if (user.lockout_until && new Date(user.lockout_until) > new Date()) {
      const waitMinutes = Math.ceil((new Date(user.lockout_until).getTime() - Date.now()) / (60 * 1000));
      return reply.status(429).send({
        error: `Account temporarily locked due to repeated failed logins. Please retry after ${waitMinutes} minutes.`,
        code: 'ACCOUNT_LOCKED'
      });
    }

    // Spec Requirement: User must log in through their own role gateway.
    // Matching credentials on the wrong role screen fails with the same generic error!
    if (user.role !== role) {
      await auditService.logEvent({
        actorId: user.id,
        actorName: user.name,
        actorRole: user.role,
        action: 'AUTH_WRONG_ROLE_GATEWAY_ATTEMPT',
        entityType: 'AUTH',
        entityId: user.id,
        details: { expectedRole: user.role, attemptedGatewayRole: role },
        ipAddress: ip,
        userAgent
      });
      return reply.status(401).send(genericAuthError);
    }

    // Check password
    const isPasswordValid = await verifyPassword(user.password_hash, password);
    if (!isPasswordValid) {
      const failedCount = (user.failed_login_attempts || 0) + 1;
      let lockoutDate: Date | null = null;
      if (failedCount >= 5) {
        lockoutDate = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes lockout
      }

      await db.query(
        'UPDATE users SET failed_login_attempts = $1, lockout_until = $2 WHERE id = $3',
        [failedCount, lockoutDate, user.id]
      );

      await auditService.logEvent({
        actorId: user.id,
        actorName: user.name,
        actorRole: user.role,
        action: lockoutDate ? 'AUTH_ACCOUNT_LOCKED' : 'AUTH_LOGIN_FAILED_BAD_PASSWORD',
        entityType: 'AUTH',
        entityId: user.id,
        details: { failedCount },
        ipAddress: ip,
        userAgent
      });

      return reply.status(401).send(genericAuthError);
    }

    // Reset failed attempts on success
    await db.query('UPDATE users SET failed_login_attempts = 0, lockout_until = NULL WHERE id = $1', [user.id]);

    // Check MFA requirement
    // Mandatory for government, inspector, finance, admin; optional for startup
    const mfaRequired = user.mfa_enabled || ['government', 'inspector', 'finance', 'admin'].includes(user.role);

    if (mfaRequired && user.mfa_enabled && user.mfa_secret) {
      // Issue short-lived temporary MFA challenge token (valid 5 minutes)
      const tempMfaToken = signToken({
        userId: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        departmentId: user.department_id,
        organizationId: user.organization_id,
        sessionId: `TEMP-MFA-${Date.now()}`
      }, 300);

      return reply.send({
        requireMfa: true,
        tempToken: tempMfaToken,
        message: 'Enter 6-digit TOTP verification code from your authenticator application'
      });
    }

    // Create session in database
    const sessionId = `SESS-${Date.now()}-${sha256(Math.random().toString()).slice(0, 8)}`;
    const expiresAt = new Date(Date.now() + 8 * 3600 * 1000); // 8 hours session

    await db.query(
      `INSERT INTO sessions (id, user_id, ip_address, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [sessionId, user.id, ip, userAgent, expiresAt]
    );

    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      departmentId: user.department_id,
      organizationId: user.organization_id,
      sessionId
    });

    // Set secure httpOnly cookie
    reply.setCookie('s2s_session', token, {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 8 * 3600
    });

    await auditService.logEvent({
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      action: 'AUTH_LOGIN_SUCCESS',
      entityType: 'AUTH',
      entityId: sessionId,
      details: { role: user.role },
      ipAddress: ip,
      userAgent
    });

    return reply.send({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        designation: user.designation,
        departmentId: user.department_id,
        organizationId: user.organization_id,
        mfaEnabled: user.mfa_enabled,
        mustChangePassword: user.must_change_password,
        mfaEnrollmentRequired: PRIVILEGED.includes(user.role) && !user.mfa_enabled,
        mfaEnrolRequired: staffMfaRequired() && STAFF_ROLES.includes(user.role) && !user.mfa_enabled
      },
      token
    });
  });

  // 2. MFA TOTP Verification
  app.post('/mfa/verify', AUTH_RATE, async (request: FastifyRequest, reply: FastifyReply) => {
    const { tempToken, code } = request.body as { tempToken: string; code: string };
    if (!tempToken || !code) {
      return reply.status(400).send({ error: 'tempToken and code are required' });
    }

    const payload = verifyToken(tempToken);
    if (!payload || !payload.sessionId.startsWith('TEMP-MFA-')) {
      return reply.status(401).send({ error: 'MFA challenge token expired or invalid' });
    }

    const userRes = await db.query('SELECT * FROM users WHERE id = $1', [payload.userId]);
    if (userRes.rows.length === 0) {
      return reply.status(401).send({ error: 'User not found' });
    }
    const user = userRes.rows[0];

    let isValid = verifyTotpToken(code, user.mfa_secret || '');
    if (!isValid) {
      // Fallback: single-use recovery code
      let stored: string[] = [];
      try { stored = JSON.parse(user.mfa_recovery_codes || '[]'); } catch { stored = []; }
      const rec = verifyRecoveryCode(code, stored);
      if (rec.valid) {
        isValid = true;
        await db.query('UPDATE users SET mfa_recovery_codes = $1 WHERE id = $2', [JSON.stringify(rec.remainingHashedCodes), user.id]);
      }
    }
    if (!isValid) {
      return reply.status(401).send({ error: 'Invalid authentication or recovery code' });
    }

    // Create session
    const sessionId = `SESS-${Date.now()}-${sha256(Math.random().toString()).slice(0, 8)}`;
    const expiresAt = new Date(Date.now() + 8 * 3600 * 1000);

    await db.query(
      `INSERT INTO sessions (id, user_id, ip_address, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [sessionId, user.id, request.ip || '127.0.0.1', request.headers['user-agent'] || 'Unknown', expiresAt]
    );

    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      departmentId: user.department_id,
      organizationId: user.organization_id,
      sessionId
    });

    reply.setCookie('s2s_session', token, {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 8 * 3600
    });

    await auditService.logEvent({
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      action: 'AUTH_MFA_SUCCESS',
      entityType: 'AUTH',
      entityId: sessionId,
      ipAddress: request.ip || '127.0.0.1',
      userAgent: request.headers['user-agent'] || 'Unknown'
    });

    return reply.send({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        designation: user.designation,
        departmentId: user.department_id,
        organizationId: user.organization_id,
        mfaEnabled: user.mfa_enabled
      },
      token
    });
  });

  // 3. MFA Setup (Generate Secret & QR URI)
  app.post('/mfa/setup', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const authReq = request as AuthenticatedRequest;
    const { secret, otpauthUrl } = generateMfaSecret(authReq.user.email);
    const { plainCodes, hashedCodes } = generateRecoveryCodes(8);

    // Save secret & recovery codes pending confirmation
    await db.query(
      `UPDATE users
       SET mfa_secret = $1, mfa_recovery_codes = $2
       WHERE id = $3`,
      [secret, JSON.stringify(hashedCodes), authReq.user.userId]
    );

    return reply.send({
      secret,
      otpauthUrl,
      recoveryCodes: plainCodes,
      instructions: 'Scan this QR code in Google Authenticator or Aegis, then submit the 6-digit code to /mfa/enable.'
    });
  });

  // 4. MFA Enable Confirmation
  app.post('/mfa/enable', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const authReq = request as AuthenticatedRequest;
    const { code } = request.body as { code: string };

    const userRes = await db.query('SELECT mfa_secret FROM users WHERE id = $1', [authReq.user.userId]);
    const secret = userRes.rows[0]?.mfa_secret;

    if (!secret || !verifyTotpToken(code, secret)) {
      return reply.status(400).send({ error: 'Invalid verification code. MFA not enabled.' });
    }

    await db.query('UPDATE users SET mfa_enabled = TRUE WHERE id = $1', [authReq.user.userId]);

    await auditService.logEvent({
      actorId: authReq.user.userId,
      actorName: authReq.user.name,
      actorRole: authReq.user.role,
      action: 'AUTH_MFA_ENROLLED',
      entityType: 'SECURITY',
      entityId: authReq.user.userId,
      ipAddress: request.ip || '127.0.0.1',
      userAgent: request.headers['user-agent'] || 'Unknown'
    });

    return reply.send({ success: true, message: 'TOTP Multi-Factor Authentication successfully activated.' });
  });

  // 5. Public Startup Self-Registration with Statutory Checksum Verification
  app.post('/register-startup', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await verifyCaptcha((request.body as any)?.captchaToken, request.ip || '', opts.captchaFetch))) {
      return reply.status(400).send({ error: 'Please complete the human check and try again.', code: 'CAPTCHA_FAILED' });
    }
    const parseResult = registerStartupSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parseResult.error.format() });
    }

    const data = parseResult.data;

    // Check PAN
    if (!isValidPan(data.pan.toUpperCase())) {
      return reply.status(400).send({ error: 'Invalid Permanent Account Number (PAN) format or structure.' });
    }

    // Check GSTIN
    if (!isValidGstin(data.gstin.toUpperCase())) {
      return reply.status(400).send({ error: 'Invalid GSTIN format or Mod-36 checksum verification failed.' });
    }

    // Check CIN / LLPIN
    if (!isValidCinOrLlpin(data.cinLlpin)) {
      return reply.status(400).send({ error: 'Invalid Corporate Identity Number (CIN) or LLPIN format.' });
    }

    // Check DPIIT Number
    if (!isValidDpiitNumber(data.dpiitNumber)) {
      return reply.status(400).send({ error: 'Invalid DPIIT Recognition Number format (e.g. DIPP12345 or DPIIT/2026/12345).' });
    }

    // Check IFSC
    if (!isValidIfsc(data.ifscCode)) {
      return reply.status(400).send({ error: 'Invalid Bank IFSC Code format.' });
    }

    // Password strength check
    const strength = validatePasswordStrength(data.password);
    if (!strength.valid) {
      return reply.status(400).send({ error: 'Weak password policy violation', details: strength.errors });
    }

    // Check duplicate email
    const existingUser = await db.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [data.email]);
    if (existingUser.rows.length > 0) {
      return reply.status(409).send({ error: 'An account with this email address already exists.' });
    }

    const orgId = `ORG-${Date.now().toString().slice(-6)}`;
    const userId = `USR-${Date.now().toString().slice(-6)}`;
    const passwordHash = await hashPassword(data.password);
    const bankEncrypted = encryptField(data.bankAccountNumber);
    const bankMasked = maskBankAccount(data.bankAccountNumber);
    const panMasked = maskPan(data.pan.toUpperCase());

    await db.transaction(async (tx) => {
      // Insert Organization with PENDING status
      await tx.query(
        `INSERT INTO organizations (
          id, name, dpiit_number, cin_llpin, pan, gstin,
          bank_account_encrypted, bank_account_masked, ifsc_code,
          founder_name, founder_email, founder_phone, website, sector,
          verification_status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'PENDING')`,
        [
          orgId,
          data.startupName,
          data.dpiitNumber.toUpperCase(),
          data.cinLlpin.toUpperCase(),
          panMasked,
          data.gstin.toUpperCase(),
          bankEncrypted,
          bankMasked,
          data.ifscCode.toUpperCase(),
          data.founderName,
          data.email,
          data.phone,
          data.website || null,
          data.sector
        ]
      );

      // Insert User
      await tx.query(
        `INSERT INTO users (
          id, email, password_hash, role, name, designation, organization_id
        ) VALUES ($1, $2, $3, 'startup', $4, 'Founder & CEO', $5)`,
        [userId, data.email.toLowerCase(), passwordHash, data.founderName, orgId]
      );
    });

    await auditService.logEvent({
      actorId: userId,
      actorName: data.founderName,
      actorRole: 'startup',
      action: 'ORGANIZATION_SELF_REGISTERED',
      entityType: 'ORGANIZATION',
      entityId: orgId,
      details: {
        startupName: data.startupName,
        dpiitNumber: data.dpiitNumber.toUpperCase(),
        verificationStatus: 'PENDING'
      },
      ipAddress: request.ip || '127.0.0.1',
      userAgent: request.headers['user-agent'] || 'Unknown'
    });

    return reply.status(201).send({
      success: true,
      message: 'Startup registered successfully. Your DPIIT credentials and corporate identity are pending official review.',
      organizationId: orgId,
      verificationStatus: 'PENDING'
    });
  });

  // 6. Current User Me Endpoint
  app.get('/me', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const authReq = request as AuthenticatedRequest;
    const res = await db.query(
      `SELECT u.id, u.email, u.role, u.name, u.designation, u.department_id, u.organization_id,
              u.mfa_enabled, u.must_change_password, u.auth_provider, u.avatar_url, u.status, u.has_password, u.phone,
              d.name as department_name, d.code as department_code,
              o.name as organization_name, o.verification_status, o.dpiit_number
       FROM users u
       LEFT JOIN departments d ON u.department_id = d.id
       LEFT JOIN organizations o ON u.organization_id = o.id
       WHERE u.id = $1`,
      [authReq.user.userId]
    );

    if (res.rows.length === 0) {
      return reply.status(404).send({ error: 'User not found' });
    }

    const u = res.rows[0];
    return reply.send({ user: { ...u, mfa_enrol_required: staffMfaRequired() && STAFF_ROLES.includes(u.role) && !u.mfa_enabled } });
  });

  // 7. Logout Endpoint
  app.post('/logout', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const authReq = request as AuthenticatedRequest;

    await db.query('DELETE FROM sessions WHERE id = $1', [authReq.user.sessionId]);

    reply.clearCookie('s2s_session', { path: '/' });

    await auditService.logEvent({
      actorId: authReq.user.userId,
      actorName: authReq.user.name,
      actorRole: authReq.user.role,
      action: 'AUTH_LOGOUT',
      entityType: 'SESSION',
      entityId: authReq.user.sessionId,
      ipAddress: request.ip || '127.0.0.1',
      userAgent: request.headers['user-agent'] || 'Unknown'
    });

    return reply.send({ success: true, message: 'Logged out successfully.' });
  });

  // 8. Log out everywhere
  app.post('/logout-all', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const authReq = request as AuthenticatedRequest;

    await db.query('DELETE FROM sessions WHERE user_id = $1', [authReq.user.userId]);

    reply.clearCookie('s2s_session', { path: '/' });

    await auditService.logEvent({
      actorId: authReq.user.userId,
      actorName: authReq.user.name,
      actorRole: authReq.user.role,
      action: 'AUTH_LOGOUT_ALL_SESSIONS',
      entityType: 'SESSION',
      entityId: authReq.user.userId,
      ipAddress: request.ip || '127.0.0.1',
      userAgent: request.headers['user-agent'] || 'Unknown'
    });

    return reply.send({ success: true, message: 'Terminated all active sessions.' });
  });

  // 9. Active Sessions List
  app.get('/sessions', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const authReq = request as AuthenticatedRequest;

    const res = await db.query(
      `SELECT id, ip_address, user_agent, last_active_at, created_at,
              (id = $1) as is_current
       FROM sessions
       WHERE user_id = $2
       ORDER BY last_active_at DESC`,
      [authReq.user.sessionId, authReq.user.userId]
    );

    return reply.send({ sessions: res.rows });
  });

  // 11. Change password (also clears the forced-change flag set on admin-provisioned accounts)
  app.post('/change-password', { preHandler: [authenticate], ...AUTH_RATE }, async (request: FastifyRequest, reply: FastifyReply) => {
    const authReq = request as AuthenticatedRequest;
    const parsed = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(10).max(128) }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Provide your current password and a new password of at least 10 characters' });
    const row = (await db.query('SELECT password_hash, auth_provider FROM users WHERE id = $1', [authReq.user.userId])).rows[0];
    if (!row) return reply.status(404).send({ error: 'User not found' });
    if (row.auth_provider === 'google') return reply.status(400).send({ error: 'This account signs in with Google; it has no password to change.' });
    if (!(await verifyPassword(row.password_hash, parsed.data.currentPassword))) return reply.status(401).send({ error: 'Current password is incorrect' });
    const strength = validatePasswordStrength(parsed.data.newPassword);
    if (!strength.valid) return reply.status(400).send({ error: 'Weak password policy violation', details: strength.errors });
    if (parsed.data.currentPassword === parsed.data.newPassword) return reply.status(400).send({ error: 'New password must differ from the current one' });

    await db.query('UPDATE users SET password_hash = $1, must_change_password = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [await hashPassword(parsed.data.newPassword), authReq.user.userId]);
    await db.query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [authReq.user.userId, authReq.user.sessionId]);
    await auditService.logEvent({ actorId: authReq.user.userId, actorName: authReq.user.name, actorRole: authReq.user.role, action: 'AUTH_PASSWORD_CHANGED', entityType: 'SECURITY', entityId: authReq.user.userId, ipAddress: request.ip || '127.0.0.1', userAgent: (request.headers['user-agent'] as string) || 'Unknown' });
    return reply.send({ success: true });
  });

  // 12. The signed-in startup's own organisation profile (never returns encrypted bank data)
  app.get('/organization', { preHandler: [authenticate, requireRole('startup')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const authReq = request as AuthenticatedRequest;
    if (!authReq.user.organizationId) return reply.send({ organization: null });
    const res = await db.query(
      `SELECT id, name, dpiit_number, cin_llpin, pan, gstin, bank_account_masked, ifsc_code, founder_name, founder_email, founder_phone,
              website, sector, stage, verification_status, verification_notes, verified_at, created_at, showcase_opt_in, showcase_summary
       FROM organizations WHERE id = $1`,
      [authReq.user.organizationId]
    );
    return reply.send({ organization: res.rows[0] || null });
  });
}
