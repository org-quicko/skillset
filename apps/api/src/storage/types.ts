export interface PresignOptions {
  expiresInSeconds?: number;
  contentType?: string;
  contentDisposition?: string;
}

/** One object a prefix listing found. `size` is the stored byte length. */
export interface StorageObject {
  key: string;
  size: number;
}

/**
 * One stored object opened for reading: how big it is, and its bytes on
 * demand.
 *
 * @remarks
 * The size arrives *before* any bytes do, which is the whole point of this
 * shape existing next to `get`. A read path can refuse an object that overran
 * what an Artifact may hold, and answer with a `content-length`, without ever
 * holding it in memory (ISSUE-5).
 */
export interface StorageObjectBody {
  size: number;
  stream(): ReadableStream<Uint8Array>;
}

/**
 * Standard object-storage contract. Only S3 is implemented (s3.ts); the
 * fake in fake.ts backs the API test harness (seam 1).
 *
 * `list` returns each object's size as well as its key because that is what
 * an Artifact's manifest is made of (ADR-0032): storage is the source of
 * truth for which files a Resource actually has, and both S3's listing and
 * the fake's map already know how big each one is, so asking for the sizes
 * separately would be a round-trip per file for data the listing carried
 * anyway.
 *
 * See ADR-0001: publishing uploads directly to storage, so `presignUpload`
 * is what the publish flow reaches for, while reads go through `get`/`list`
 * now that the API assembles the zip itself (ADR-0032). `presignDownload` is
 * implemented because the contract is the target a second implementation
 * aims at, not because a request flow uses it today.
 */
export interface StorageAdapter {
  put(key: string, body: Uint8Array, contentType?: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  /**
   * Opens an object for streaming, or `null` if there is none at `key`.
   * Prefer this to `get` wherever the bytes are only being passed on: `get`
   * buffers the whole object, so it belongs to the zip path alone, which has
   * to hold every file anyway.
   */
  open(key: string): Promise<StorageObjectBody | null>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<StorageObject[]>;
  presignUpload(key: string, options?: PresignOptions): Promise<string>;
  presignDownload(key: string, options?: PresignOptions): Promise<string>;
}
