import type { PresignOptions, StorageAdapter } from "./types.js";

export interface S3Settings {
  bucket: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  endpoint?: string;
  /**
   * The endpoint embedded in presigned URLs, if different from `endpoint`.
   * Presigning is a local signature computation with no network call, so it
   * can target a host `endpoint` itself can't reach — the split a dev
   * docker-compose setup needs, where the API reaches storage over the
   * Docker network but a presigned URL is followed by the browser, which
   * can't resolve that network's hostnames (see .env.example). Defaults to
   * `endpoint` for the common case of one publicly-reachable S3 endpoint.
   */
  publicEndpoint?: string;
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
  private readonly publicEndpoint: string | undefined;

  constructor(settings: S3Settings) {
    this.client = new Bun.S3Client({
      bucket: settings.bucket,
      region: settings.region,
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
      endpoint: settings.endpoint,
    });
    this.publicEndpoint = settings.publicEndpoint ?? settings.endpoint;
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
      endpoint: this.publicEndpoint,
    });
  }

  async presignDownload(key: string, options?: PresignOptions): Promise<string> {
    return this.client.presign(key, {
      method: "GET",
      expiresIn: options?.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS,
      endpoint: this.publicEndpoint,
      contentDisposition: options?.contentDisposition,
    });
  }
}
