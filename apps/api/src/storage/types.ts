export interface PresignOptions {
  expiresInSeconds?: number;
  contentType?: string;
  contentDisposition?: string;
}

/**
 * Standard object-storage contract. Only S3 is implemented (s3.ts); the
 * fake in fake.ts backs the API test harness (seam 1). See ADR-0001:
 * publishing uploads directly to storage, so
 * presignUpload/presignDownload are the two operations request flows
 * actually exercise today, but the full contract is declared per the spec.
 */
export interface StorageAdapter {
  put(key: string, body: Uint8Array, contentType?: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  presignUpload(key: string, options?: PresignOptions): Promise<string>;
  presignDownload(key: string, options?: PresignOptions): Promise<string>;
}
