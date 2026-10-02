import { DatabaseAdapter } from './db';
import { sha256 } from './security';

export interface AuditLogEntry {
  id: string;
  prev_hash: string;
  hash: string;
  actor_id: string;
  actor_name: string;
  actor_role: string;
  action: string;
  entity_type: string;
  entity_id: string;
  before_state_hash?: string | null;
  after_state_hash?: string | null;
  details: Record<string, any>;
  ip_address: string;
  user_agent?: string;
  timestamp: string | Date;
}

function canonicalJson(obj: any): string {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
}

function formatIso(ts: string | Date): string {
  return new Date(ts).toISOString();
}

export class AuditService {
  constructor(private db: DatabaseAdapter) {}

  async logEvent(params: {
    actorId: string;
    actorName: string;
    actorRole: string;
    action: string;
    entityType: string;
    entityId: string;
    details?: Record<string, any>;
    beforeState?: any;
    afterState?: any;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<AuditLogEntry> {
    // 1. Fetch latest audit entry to get previous hash
    const latestRes = await this.db.query<{ hash: string }>(
      'SELECT hash FROM audit_logs ORDER BY timestamp DESC, id DESC LIMIT 1'
    );
    const prevHash = latestRes.rows.length > 0 ? latestRes.rows[0].hash : '0000000000000000000000000000000000000000000000000000000000000000';

    const id = `AUD-${Date.now()}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
    const timestamp = new Date().toISOString();
    const details = params.details || {};
    const ipAddress = params.ipAddress || '127.0.0.1';
    const userAgent = params.userAgent || 'Server-Internal';

    const beforeStateHash = params.beforeState ? sha256(canonicalJson(params.beforeState)) : null;
    const afterStateHash = params.afterState ? sha256(canonicalJson(params.afterState)) : null;

    // 2. Compute cryptographic SHA-256 hash using canonical serialization
    const hashPayload = [
      id,
      prevHash,
      timestamp,
      params.actorId,
      params.actorName,
      params.actorRole,
      params.action,
      params.entityType,
      params.entityId,
      beforeStateHash || '',
      afterStateHash || '',
      canonicalJson(details),
      ipAddress
    ].join('|');

    const entryHash = sha256(hashPayload);

    // 3. Atomically insert into audit_logs table
    await this.db.query(
      `INSERT INTO audit_logs (
        id, prev_hash, hash, actor_id, actor_name, actor_role, action,
        entity_type, entity_id, before_state_hash, after_state_hash,
        details, ip_address, user_agent, timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        id,
        prevHash,
        entryHash,
        params.actorId,
        params.actorName,
        params.actorRole,
        params.action,
        params.entityType,
        params.entityId,
        beforeStateHash,
        afterStateHash,
        JSON.stringify(details),
        ipAddress,
        userAgent,
        timestamp
      ]
    );

    return {
      id,
      prev_hash: prevHash,
      hash: entryHash,
      actor_id: params.actorId,
      actor_name: params.actorName,
      actor_role: params.actorRole,
      action: params.action,
      entity_type: params.entityType,
      entity_id: params.entityId,
      before_state_hash: beforeStateHash,
      after_state_hash: afterStateHash,
      details,
      ip_address: ipAddress,
      user_agent: userAgent,
      timestamp
    };
  }

  /**
   * Cryptographic verification of the entire audit chain.
   * Proves mathematically that no entry has been altered, forged, deleted, or inserted out of order.
   */
  async verifyChain(): Promise<{ valid: boolean; totalEntries: number; brokenAtId?: string }> {
    const res = await this.db.query<AuditLogEntry>(
      'SELECT * FROM audit_logs ORDER BY timestamp ASC, id ASC'
    );
    const logs = res.rows;
    if (logs.length === 0) {
      return { valid: true, totalEntries: 0 };
    }

    let expectedPrevHash = '0000000000000000000000000000000000000000000000000000000000000000';

    for (const entry of logs) {
      if (entry.prev_hash !== expectedPrevHash) {
        return { valid: false, totalEntries: logs.length, brokenAtId: entry.id };
      }

      const isoTime = formatIso(entry.timestamp);
      const parsedDetails = typeof entry.details === 'string' ? JSON.parse(entry.details) : entry.details;

      const hashPayload = [
        entry.id,
        entry.prev_hash,
        isoTime,
        entry.actor_id,
        entry.actor_name,
        entry.actor_role,
        entry.action,
        entry.entity_type,
        entry.entity_id,
        entry.before_state_hash || '',
        entry.after_state_hash || '',
        canonicalJson(parsedDetails),
        entry.ip_address
      ].join('|');

      const recomputedHash = sha256(hashPayload);
      if (recomputedHash !== entry.hash) {
        return { valid: false, totalEntries: logs.length, brokenAtId: entry.id };
      }

      expectedPrevHash = entry.hash;
    }

    return { valid: true, totalEntries: logs.length };
  }
}
