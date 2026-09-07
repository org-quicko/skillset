import type { PresignOptions, StorageAdapter, StorageObject } from "./types.js";

/**
 * In-memory StorageAdapter for tests. Presigned URLs are deterministic
 * fake:// URLs rather than real ones — nothing serves them.
 */
export class FakeStorageAdapter implements StorageAdapter {
  private readonly objects = new Map<string, Uint8Array>();

  async put(key: string, body: Uint8Array, _contentType?: string): Promise<void> {
    // contentType isn't tracked — nothing reads it back from this fake.
    this.objects.set(key, body);
  }

  async get(key: string): Promise<Uint8Array | null> {
    return this.objects.get(key) ?? null;
  }

  async exists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async list(prefix: string): Promise<StorageObject[]> {
    return [...this.objects.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, body]) => ({ key, size: body.byteLength }));
  }

  async presignUpload(key: string, options?: PresignOptions): Promise<string> {
    return `fake://upload/${encodeURIComponent(key)}?expires=${options?.expiresInSeconds ?? 60}`;
  }

  async presignDownload(key: string, options?: PresignOptions): Promise<string> {
    const disposition = options?.contentDisposition ? `&disposition=${encodeURIComponent(options.contentDisposition)}` : "";
    return `fake://download/${encodeURIComponent(key)}?expires=${options?.expiresInSeconds ?? 60}${disposition}`;
  }
}
