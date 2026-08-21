import type { PresignOptions, StorageAdapter } from "./types.js";

export interface S3Settings {
  bucket: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  endpoint?: string;
}

const DEFAULT_EXPIRY_SECONDS = 60;

/**
 * The S3 StorageAdapter, built on Bun's own S3 client — no AWS SDK. Artifact
 * bytes never pass through the API (ADR-0001), so the two presigners are what
 * request flows actually reach for; the rest of the contract is implemented
 * because the contract is the target a second implementation aims at.
 */
export class S3StorageAdapter implements StorageAdapter {
  private readonly client: Bun.S3Client;

  constructor(settings: S3Settings) {
    this.client = new Bun.S3Client({
      bucket: settings.bucket,
      region: settings.region,
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
      endpoint: settings.endpoint,
    });
  }

  async put(key: string, body: Uint8Array, contentType?: string): Promise<void> {
    await this.client.write(key, body, contentType ? { type: contentType } : undefined);
  }

  async get(key: string): Promise<Uint8Array | null> {
    const file = this.client.file(key);
    if (!(await file.exists())) return null;
    return new Uint8Array(await file.arrayBuffer());
  }

  async exists(key: string): Promise<boolean> {
    return this.client.file(key).exists();
  }

  async delete(key: string): Promise<void> {
    await this.client.delete(key);
  }

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;

    // S3 pages its listing, so a caller asking for a prefix gets every key
    // under it rather than the first page's worth.
    do {
      const page = await this.client.list({ prefix, continuationToken });
      for (const object of page.contents ?? []) {
        keys.push(object.key);
      }
      continuationToken = page.isTruncated ? page.nextContinuationToken : undefined;
    } while (continuationToken);

    return keys;
  }

  async presignUpload(key: string, options?: PresignOptions): Promise<string> {
    return this.client.presign(key, {
      method: "PUT",
      expiresIn: options?.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS,
      type: options?.contentType,
    });
  }

  async presignDownload(key: string, options?: PresignOptions): Promise<string> {
    return this.client.presign(key, {
      method: "GET",
      expiresIn: options?.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS,
    });
  }
}
