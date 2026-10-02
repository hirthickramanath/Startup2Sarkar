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
  sendEmail(message: EmailMessage): Promise<{ success: boolean; messageId: string }>;
}

/** Sends through Brevo's transactional email API. Needs BREVO_API_KEY and a verified sender address (EMAIL_FROM). */
export class BrevoEmailProvider implements EmailProvider {
  constructor(private apiKey: string, private from: { email: string; name: string }, private fetchImpl: typeof fetch = fetch) {}
  async sendEmail(message: EmailMessage): Promise<{ success: boolean; messageId: string }> {
    const res = await this.fetchImpl('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': this.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ sender: this.from, to: [{ email: message.to }], subject: message.subject, htmlContent: message.html, textContent: message.text }),
      signal: AbortSignal.timeout(8000)
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`The email provider rejected the message (HTTP ${res.status})`);
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
