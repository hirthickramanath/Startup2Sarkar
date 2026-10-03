import fs from 'fs';
import path from 'path';

/**
 * Where uploaded documents live. Two backends, chosen by environment:
 *  - Supabase Storage (persistent; set SUPABASE_URL, SUPABASE_SERVICE_KEY and optionally SUPABASE_BUCKET), or
 *  - the local disk under UPLOAD_DIR (persistent only if that is a mounted volume).
 * Files are always private: they are only ever read back through an authorised API call.
 */
export interface ObjectStore {
  readonly kind: 'supabase' | 'local';
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
}

const safeKey = (key: string) => key.split('/').map((p) => p.replace(/[^A-Za-z0-9._-]/g, '_')).join('/');

export class LocalObjectStore implements ObjectStore {
  readonly kind = 'local' as const;
  private root: string;
  constructor(root?: string) {
    this.root = path.resolve(root || path.join(process.env.UPLOAD_DIR || path.join(process.cwd(), '.data', 'uploads'), 'documents'));
  }
  private full(key: string) {
    const p = path.resolve(this.root, safeKey(key));
    if (!p.startsWith(this.root + path.sep)) throw new Error('Invalid storage key');
    return p;
  }
  async put(key: string, data: Buffer): Promise<void> {
    const p = this.full(key);
    await fs.promises.mkdir(path.dirname(p), { recursive: true });
    await fs.promises.writeFile(p, data);
  }
  async get(key: string): Promise<Buffer> { return fs.promises.readFile(this.full(key)); }
}

export class SupabaseObjectStore implements ObjectStore {
  readonly kind = 'supabase' as const;
  constructor(private url: string, private serviceKey: string, private bucket = 'documents', private fetchImpl: typeof fetch = fetch) {}
  private endpoint(kind: 'object' | 'object/authenticated', key: string) {
    return `${this.url.replace(/\/+$/, '')}/storage/v1/${kind}/${encodeURIComponent(this.bucket)}/${safeKey(key).split('/').map(encodeURIComponent).join('/')}`;
  }
  private headers(extra: Record<string, string> = {}) { return { Authorization: `Bearer ${this.serviceKey}`, apikey: this.serviceKey, ...extra }; }
  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    const res = await this.fetchImpl(this.endpoint('object', key), { method: 'POST', headers: this.headers({ 'Content-Type': contentType, 'x-upsert': 'true' }), body: new Uint8Array(data), signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Storage upload failed (HTTP ${res.status})`);
  }
  async get(key: string): Promise<Buffer> {
    const res = await this.fetchImpl(this.endpoint('object/authenticated', key), { headers: this.headers(), signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Storage download failed (HTTP ${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }
}

export function createObjectStore(): ObjectStore {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    return new SupabaseObjectStore(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, process.env.SUPABASE_BUCKET || 'documents');
  }
  return new LocalObjectStore();
}
