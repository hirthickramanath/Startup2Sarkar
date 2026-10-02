import { DatabaseAdapter } from './db';
import { AuditService } from './audit';

/**
 * Startup2Sarkar — Sovereign In-Process Job Scheduler
 * Provides periodic, automated background tasks for:
 * 1. Statutory Payment SLA Monitoring (15-day limit, Spec Section 60)
 * 2. Stalled Pilot Identification & Exposure Tracking (Spec Section 57)
 * 3. Continuous Audit Chain Cryptographic Integrity Check (Spec Section 85)
 * 4. Expired Sessions & Single-Use Tokens Janitor (Spec Section 80)
 */


export interface SchedulerOptions {
  db: DatabaseAdapter;
  auditService: AuditService;
  slaCheckIntervalMs?: number;
  stalledPilotIntervalMs?: number;
  auditSentinelIntervalMs?: number;
  cleanupIntervalMs?: number;
}

export class SovereignJobScheduler {
  private intervals: NodeJS.Timeout[] = [];
  private isRunning = false;

  constructor(private opts: SchedulerOptions) {}

  /**
   * Starts all scheduled jobs
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    const slaInterval = this.opts.slaCheckIntervalMs || 60 * 1000; // 1 min in dev, 1 hr in prod
    const stalledInterval = this.opts.stalledPilotIntervalMs || 5 * 60 * 1000;
    const sentinelInterval = this.opts.auditSentinelIntervalMs || 10 * 60 * 1000;
    const cleanupInterval = this.opts.cleanupIntervalMs || 15 * 60 * 1000;

    // Run once on startup
    this.runSlaMonitor().catch(console.error);
    this.runStalledPilotScanner().catch(console.error);
    this.runAuditSentinel().catch(console.error);
    this.runExpiredTokenCleanup().catch(console.error);

    // Schedule periodic execution
    this.intervals.push(
      setInterval(() => this.runSlaMonitor().catch(console.error), slaInterval),
      setInterval(() => this.runStalledPilotScanner().catch(console.error), stalledInterval),
      setInterval(() => this.runAuditSentinel().catch(console.error), sentinelInterval),
      setInterval(() => this.runExpiredTokenCleanup().catch(console.error), cleanupInterval)
    );
  }

  /**
   * Gracefully stops all active timers
   */
  stop(): void {
    for (const timer of this.intervals) {
      clearInterval(timer);
    }
    this.intervals = [];
    this.isRunning = false;
  }

  /**
   * 1. Statutory SLA Payment Monitor (Spec Section 60)
   * Enforces the Indian Public Procurement 15-day statutory payment processing window
   */
  async runSlaMonitor(): Promise<{ checked: number; breached: number; nearSla: number }> {
    const claimsRes = await this.opts.db.query(`
      SELECT id, pilot_id, gross_amount_paise, created_at, status
      FROM finance_payment_claims
      WHERE status IN ('SUBMITTED', 'UNDER_REVIEW', 'FINANCE_REVIEW')
    `);

    const now = Date.now();
    let breached = 0;
    let nearSla = 0;

    for (const claim of claimsRes.rows) {
      const ageDays = (now - new Date(claim.created_at).getTime()) / (1000 * 3600 * 24);

      if (ageDays >= 15) {
        breached++;
        // Check if anomaly already logged
        const existingAnom = await this.opts.db.query(
          `SELECT id FROM finance_anomalies WHERE claim_id = $1 AND anomaly_type = 'SLA_BREACH'`,
          [claim.id]
        );
        if (existingAnom.rows.length === 0) {
          const anomId = `ANOM-SLA-${Date.now().toString().slice(-6)}`;
          await this.opts.db.query(
            `INSERT INTO finance_anomalies (
              id, pilot_id, claim_id, anomaly_type, severity, description, status
            ) VALUES ($1, $2, $3, 'SLA_BREACH', 'CRITICAL', $4, 'DETECTED')`,
            [
              anomId,
              claim.pilot_id,
              claim.id,
              `Statutory 15-day payment processing SLA breached (${Math.floor(ageDays)} days elapsed). Immediate executive escalation required.`
            ]
          );
        }
      } else if (ageDays >= 10) {
        nearSla++;
      }
    }

    return { checked: claimsRes.rows.length, breached, nearSla };
  }

  /**
   * 2. Stalled Pilot Detector (Spec Section 57)
   * Flags pilots with overdue milestones or unverified telemetry
   */
  async runStalledPilotScanner(): Promise<{ scanned: number; newlyStalled: number }> {
    const overdueRes = await this.opts.db.query(`
      SELECT p.id as pilot_id, p.name as pilot_name, p.startup_name, p.contract_value_paise,
             pm.id as milestone_id, pm.title as milestone_title, pm.due_date
      FROM pilots p
      JOIN pilot_milestones pm ON pm.pilot_id = p.id
      WHERE p.status IN ('LAUNCHED', 'IN_PROGRESS')
        AND pm.status = 'PENDING'
        AND pm.due_date < CURRENT_TIMESTAMP - INTERVAL '14 days'
    `);

    let newlyStalled = 0;

    for (const row of overdueRes.rows) {
      const existing = await this.opts.db.query('SELECT id FROM stalled_pilots WHERE pilot_id = $1', [row.pilot_id]);
      if (existing.rows.length === 0) {
        const stallId = `STALL-${Date.now().toString().slice(-6)}`;
        const paidPaise = 0n; // Initial stage
        const recoverablePaise = BigInt(row.contract_value_paise || 0);

        await this.opts.db.query(
          `INSERT INTO stalled_pilots (
            id, pilot_id, reason, stalled_date, amount_paid_paise,
            amount_recoverable_paise, status
          ) VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4, $5, 'STALLED_OVERDUE_MILESTONE')`,
          [
            stallId,
            row.pilot_id,
            `Milestone '${row.milestone_title}' is >14 days overdue without deliverable evidence submission.`,
            paidPaise.toString(),
            recoverablePaise.toString()
          ]
        );
        newlyStalled++;
      }
    }

    return { scanned: overdueRes.rows.length, newlyStalled };
  }

  /**
   * 3. Audit Sentinel (Spec Section 85)
   * Performs automated cryptographic hash-chain verification
   */
  async runAuditSentinel(): Promise<{ valid: boolean; total: number }> {
    const result = await this.opts.auditService.verifyChain();
    if (!result.valid) {
      console.error(`[AUDIT_SENTINEL_CRITICAL] Tampering detected in audit log! Broken at record: ${result.brokenAtId}`);
    }
    return { valid: result.valid, total: result.totalEntries };
  }

  /**
   * 4. Expired Token & Session Janitor (Spec Section 80)
   */
  async runExpiredTokenCleanup(): Promise<{ expiredInvitations: number; expiredSessions: number }> {
    const invRes = await this.opts.db.query(
      `DELETE FROM invitations WHERE expires_at < CURRENT_TIMESTAMP RETURNING id`
    );
    const sessRes = await this.opts.db.query(
      `DELETE FROM sessions WHERE expires_at < CURRENT_TIMESTAMP RETURNING id`
    );

    return {
      expiredInvitations: invRes.rowCount || 0,
      expiredSessions: sessRes.rowCount || 0
    };
  }
}
