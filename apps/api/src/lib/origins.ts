/** Vite's dev server, which proxies `/api` to this app but keeps its own Origin. */
const VITE_DEV_ORIGIN = "http://localhost:5173";

/**
 * The origins allowed to make a mutating request to this app.
 *
 * @remarks
 * Exactly the `publicUrl` in a real deployment. The Vite dev server is added
 * only when `publicUrl` is a loopback address, because it proxies `/api` here
 * while keeping the browser's Origin as its own — which both Better Auth's
 * origin check and `hono/csrf` are otherwise right to refuse. `NODE_ENV` is
 * always "production" in the Docker image this runs from, even in local dev,
 * so it cannot be used to tell the two apart.
 *
 * One list, read by both checks, so a change to what counts as trusted cannot
 * land in one and not the other.
 *
 * @param publicUrl - The absolute base URL this Registry is reached at.
 * @returns The trusted origins, `publicUrl` first.
 * @example
 * ```ts
 * trustedOrigins("http://localhost:3000"); // ["http://localhost:3000", "http://localhost:5173"]
 * trustedOrigins("https://registry.example"); // ["https://registry.example"]
 * ```
 */
export function trustedOrigins(publicUrl: string): string[] {
  const loopback = ["localhost", "127.0.0.1"].includes(new URL(publicUrl).hostname);
  return loopback ? [publicUrl, VITE_DEV_ORIGIN] : [publicUrl];
}
