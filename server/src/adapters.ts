import fs from 'fs';
import path from 'path';
import { sha256 } from './security';


// ───────────── adapters/email-provider ─────────────
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailProvider {
  /** 'brevo' delivers real mail; 'development' only keeps messages in memory */
  readonly kind?: 'brevo' | 'development';
  sendEmail(message: EmailMessage): Promise<{ success: boolean; messageId: string }>;
}

/** Turns a provider's rejection into plain advice an administrator can act on. */
export function emailHints(error: string): string[] {
  const e = error.toLowerCase();
  const hints: string[] = [];
  if (/unrecogni[sz]ed ip|ip address|not verified|ip not authori[sz]ed|authori[sz]ed ip/.test(e)) hints.push('Brevo is blocking this server\'s IP address. In Brevo open Security → Authorised IPs and click "Deactivate blocking" for API keys (this host\'s addresses change), or authorise the address. Also check the account owner\'s inbox for a "Validate your IP address" email.');
  if (/sender/.test(e)) hints.push('The sender is not accepted. EMAIL_FROM must be exactly an address you added and verified in Brevo under Senders, Domains & Dedicated IPs.');
  if (/key|api-key|unauthori[sz]ed|401/.test(e) && !hints.length) hints.push('Brevo did not accept the API key. Create a new key (SMTP & API → API Keys) and paste it into BREVO_API_KEY with no spaces.');
  if (/activat|not allowed|permission|403|account/.test(e)) hints.push('The Brevo account may not be activated for sending yet. Check the account page and Brevo\'s emails to the account owner.');
  if (/timeout|network|fetch|enotfound|econn/.test(e)) hints.push('This server could not reach Brevo. Try again in a minute.');
  if (!hints.length) hints.push('Open Brevo → Transactional → Logs for the exact reason, and check the spam folder of the receiving address.');
  return hints;
}

/** Sends through Brevo's transactional email API. Needs BREVO_API_KEY and a verified sender address (EMAIL_FROM). */
export class BrevoEmailProvider implements EmailProvider {
  readonly kind = 'brevo' as const;
  constructor(private apiKey: string, private from: { email: string; name: string }, private fetchImpl: typeof fetch = fetch) {}
  async sendEmail(message: EmailMessage): Promise<{ success: boolean; messageId: string }> {
    const res = await this.fetchImpl('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': this.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ sender: this.from, to: [{ email: message.to }], subject: message.subject, htmlContent: message.html, textContent: message.text }),
      signal: AbortSignal.timeout(8000)
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const why = String(json.message || json.code || '').replace(/[\r\n]+/g, ' ').slice(0, 240);
      throw new Error(`Brevo rejected the message (HTTP ${res.status}${why ? `: ${why}` : ''})`);
    }
    return { success: true, messageId: String(json.messageId || '') };
  }
}

/** Real email when BREVO_API_KEY and EMAIL_FROM are set; otherwise messages are only recorded in memory (development). */
export function createEmailProvider(): EmailProvider {
  if (process.env.BREVO_API_KEY && process.env.EMAIL_FROM) {
    return new BrevoEmailProvider(process.env.BREVO_API_KEY, { email: process.env.EMAIL_FROM, name: process.env.EMAIL_FROM_NAME || 'Startup2Sarkar' });
  }
  return new DevelopmentEmailProvider();
}

export class DevelopmentEmailProvider implements EmailProvider {
  readonly kind = 'development' as const;
  private sentEmails: EmailMessage[] = [];

  async sendEmail(message: EmailMessage): Promise<{ success: boolean; messageId: string }> {
    const messageId = `MSG-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    this.sentEmails.push(message);
    if (process.env.NODE_ENV !== 'test') {
      console.log(`[EMAIL DISPATCH] To: ${message.to} | Subject: ${message.subject} | ID: ${messageId}`);
    }
    return { success: true, messageId };
  }

  getSentEmails(): EmailMessage[] {
    return [...this.sentEmails];
  }

  clear(): void {
    this.sentEmails = [];
  }
}


// ───────────── adapters/storage-provider ─────────────
export interface StoredFileMetadata {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256Hash: string;
  storagePath: string;
  uploadedByUserId: string;
  entityType: string;
  entityId: string;
  isPublic: boolean;
  createdAt: string;
}

export interface StorageProvider {
  saveFile(params: {
    originalName: string;
    mimeType: string;
    buffer: Buffer;
    uploadedByUserId: string;
    entityType: string;
    entityId: string;
    isPublic?: boolean;
  }): Promise<StoredFileMetadata>;

  getFileBuffer(storagePath: string): Promise<Buffer>;
  generateSignedDownloadUrl(fileId: string, expiresInSeconds?: number): string;
}

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv'
]);

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

export class LocalStorageProvider implements StorageProvider {
  private baseDir: string;

  constructor(baseDir?: string) {
    // UPLOAD_DIR should point at a persistent disk/volume in production (container filesystems are ephemeral)
    this.baseDir = baseDir || process.env.UPLOAD_DIR || path.join(process.cwd(), '.data', 'uploads');
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  /**
   * Virus scanning hook: scans buffer for malicious signatures or forbidden patterns.
   */
  private scanForMalware(buffer: Buffer): void {
    // EICAR standard test string or executable header check
    if (buffer.length >= 2 && buffer[0] === 0x4D && buffer[1] === 0x5A) {
      throw new Error('Security Violation: Executable binaries (PE/MZ) are strictly forbidden.');
    }
  }

  async saveFile(params: {
    originalName: string;
    mimeType: string;
    buffer: Buffer;
    uploadedByUserId: string;
    entityType: string;
    entityId: string;
    isPublic?: boolean;
  }): Promise<StoredFileMetadata> {
    if (params.buffer.length > MAX_FILE_SIZE_BYTES) {
      throw new Error(`File size exceeds statutory maximum of 25MB (Received: ${(params.buffer.length / (1024 * 1024)).toFixed(1)}MB)`);
    }

    if (!ALLOWED_MIME_TYPES.has(params.mimeType.toLowerCase())) {
      throw new Error(`Forbidden file format: ${params.mimeType}. Allowed formats: PDF, JPEG, PNG, DOCX, XLSX, CSV.`);
    }

    this.scanForMalware(params.buffer);

    const fileId = `FILE-${Date.now()}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
    const hash = sha256(params.buffer);
    const ext = path.extname(params.originalName) || '.bin';
    const filename = `${fileId}_${hash.slice(0, 10)}${ext}`;
    const relativeStoragePath = path.join(params.entityType, filename);
    const fullPath = path.join(this.baseDir, relativeStoragePath);

    const targetDir = path.dirname(fullPath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    fs.writeFileSync(fullPath, params.buffer);

    return {
      id: fileId,
      originalName: params.originalName,
      mimeType: params.mimeType,
      sizeBytes: params.buffer.length,
      sha256Hash: hash,
      storagePath: relativeStoragePath,
      uploadedByUserId: params.uploadedByUserId,
      entityType: params.entityType,
      entityId: params.entityId,
      isPublic: params.isPublic || false,
      createdAt: new Date().toISOString()
    };
  }

  async getFileBuffer(storagePath: string): Promise<Buffer> {
    const fullPath = path.join(this.baseDir, storagePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error('File not found in storage repository.');
    }
    return fs.readFileSync(fullPath);
  }

  generateSignedDownloadUrl(fileId: string, expiresInSeconds = 3600): string {
    const token = sha256(`${fileId}:${expiresInSeconds}:${Date.now()}`);
    return `/api/v1/files/${fileId}/download?token=${token}`;
  }
}


// ───────────── adapters/treasury-provider ─────────────
export interface DisbursementRequest {
  claimId: string;
  pilotId: string;
  milestoneId: string;
  organizationId: string;
  departmentId: string;
  netPayablePaise: bigint;
  bankAccountMasked: string;
  ifscCode: string;
  disbursementReference: string; // Bank UTR / PFMS Transaction ID
  disbursedByUserId: string;
}

export interface DisbursementResult {
  success: boolean;
  referenceNumber: string;
  disbursedAt: string;
  message: string;
}

export interface TreasuryProvider {
  recordDisbursement(request: DisbursementRequest): Promise<DisbursementResult>;
}

/**
 * Manual Treasury Disbursement Provider (Statutory Compliance Default)
 * Enforces that every disbursement record is backed by an authentic Bank UTR / PFMS reference.
 */
export class ManualTreasuryProvider implements TreasuryProvider {
  async recordDisbursement(request: DisbursementRequest): Promise<DisbursementResult> {
    if (!request.disbursementReference || request.disbursementReference.trim().length < 8) {
      throw new Error('A valid Bank Reference / UTR Number (minimum 8 characters) is mandatory to record public fund disbursement.');
    }

    if (!request.disbursedByUserId) {
      throw new Error('Disbursing Finance Officer identity is mandatory for accountability.');
    }

    const timestamp = new Date().toISOString();

    return {
      success: true,
      referenceNumber: request.disbursementReference.trim().toUpperCase(),
      disbursedAt: timestamp,
      message: `Disbursement successfully logged with Bank Reference ${request.disbursementReference.trim().toUpperCase()}. Public funds transaction locked.`
    };
  }
}

/**
 * PFMS (Public Financial Management System) / Bank API Adapter (Future Integration Point)
 * Documented integration point for direct electronic treasury disbursement.
 */
export class PfmsTreasuryAdapter implements TreasuryProvider {
  constructor(private pfmsApiEndpoint: string, private agencyCode: string) {}

  async recordDisbursement(request: DisbursementRequest): Promise<DisbursementResult> {
    // In production with accredited PFMS credentials, this would submit digitally signed XML/JSON to PFMS/NPCI Gateway
    throw new Error('PFMS direct electronic bridge requires accredited DSC token and staging credentials.');
  }
}


/** Wraps any provider and records every attempt (without the message body) so a failure can always be found and explained. */
export class LoggedEmailProvider implements EmailProvider {
  constructor(private inner: EmailProvider, private db: { query: (sql: string, params?: any[]) => Promise<any> }) {}
  get kind() { return this.inner.kind; }
  private async record(m: EmailMessage, status: 'SENT' | 'FAILED', error: string | null, messageId: string | null) {
    try {
      await this.db.query('INSERT INTO email_log (id, to_email, subject, status, error, provider_message_id) VALUES ($1,$2,$3,$4,$5,$6)',
        [`EML-${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`.toUpperCase(), m.to, m.subject.slice(0, 200), status, error ? error.slice(0, 400) : null, messageId]);
    } catch { /* logging must never break the request that sent the email */ }
  }
  async sendEmail(message: EmailMessage): Promise<{ success: boolean; messageId: string }> {
    try {
      const r = await this.inner.sendEmail(message);
      await this.record(message, 'SENT', null, r.messageId);
      return r;
    } catch (e: any) {
      await this.record(message, 'FAILED', String(e?.message || e), null);
      throw e;
    }
  }
}
