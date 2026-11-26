import { GIT_PROVIDERS } from "@in-org-quicko/skillset-shared";
import { createMiddleware } from "hono/factory";
import { secureHeaders } from "hono/secure-headers";

/**
 * The Content-Security-Policy the web interface's own shell is served under.
 *
 * @remarks
 * `script-src 'self'` is the point of it: the SPA's code is hashed bundles
 * from this origin, so anything injected inline or pulled from elsewhere is
 * refused. The allowances are all things the build genuinely needs —
 * `'unsafe-inline'` styles because Vite emits them and Tailwind sets element
 * styles at runtime, `blob:` workers and `data:` fonts because that is how
 * Monaco ships its language workers and glyphs.
 *
 * `connect-src` has to name object storage as well as this origin. Publishing
 * from the interface uploads each file *straight to storage* under a
 * presigned URL (ADR-0001), which is a different origin — with `'self'`
 * alone the browser blocks every upload and publishing fails with nothing in
 * the API's logs to explain it.
 *
 * It also names every Git Provider's API and raw-file hosts. With no
 * Connection or Integration, the interface reads a public repository straight
 * from the provider (ADR-0010) — without these, an Import fails in the browser
 * as "Failed to fetch", again with nothing in the API's logs.
 *
 * `frame-ancestors 'none'` is the clickjacking half: without it the Settings
 * pages could be framed by a page that overlays its own controls on the real
 * ones.
 *
 * Not applied to the API, and not applied to Artifact files, which carry the
 * far stricter sandbox policy of their own (`ARTIFACT_FILE_CSP`) — a single
 * app-wide CSP set after the handler would overwrite it.
 *
 * @param storageOrigin - The origin presigned upload URLs point at, or
 * `undefined` when storage is AWS's own endpoint and this app therefore never
 * learns the bucket's hostname. `https:` is the fallback: broader than one
 * origin, narrower than the `*` that omitting `connect-src` would inherit
 * from `default-src`, and it still refuses every plaintext destination.
 */
export function spaPolicy(storageOrigin: string | undefined): string {
  const gitOrigins = Object.values(GIT_PROVIDERS).flatMap((provider) =>
    [provider.api_base, provider.raw_host].flatMap((url) => (url ? [new URL(url).origin] : [])),
  );
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    ["connect-src 'self'", storageOrigin ?? "https:", ...new Set(gitOrigins)].join(" "),
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * The headers every response carries, whatever produced it.
 *
 * @remarks
 * Nothing set `X-Frame-Options`, `Referrer-Policy`, `Strict-Transport-Security`
 * or `X-Content-Type-Options` at all (ISSUE-8). Set here rather than per route
 * so an error response and a static asset get them too.
 *
 * `contentSecurityPolicy` is deliberately absent. `secureHeaders` applies its
 * headers *after* the handler has run, so an app-wide CSP would overwrite the
 * sandbox policy the Artifact file route sets on a publisher's own bytes —
 * which is the one CSP here that is load-bearing (ISSUE-1). The SPA's policy
 * is applied by `spaContentSecurityPolicy` below instead, which only touches
 * HTML.
 *
 * HSTS is sent only when the Registry is reached over https. On an http
 * deployment it would be a header a browser must ignore, and on an http
 * *development* instance a browser that honoured it would pin localhost to
 * https and break the next project served from it.
 *
 * @param publicUrl - The absolute base URL this Registry is reached at.
 * @returns A middleware handler.
 * @example
 * ```ts
 * app.use("*", securityHeaders(deps.publicUrl));
 * ```
 */
export function securityHeaders(publicUrl: string) {
  const https = new URL(publicUrl).protocol === "https:";

  return secureHeaders({
    contentSecurityPolicy: undefined,
    // DENY, not the SAMEORIGIN default: nothing in this app frames itself.
    xFrameOptions: "DENY",
    // Enough for a Referer within the Registry, nothing but the origin to a
    // third party — a Skill's page path is not something to leak to whatever
    // a publisher linked to.
    referrerPolicy: "strict-origin-when-cross-origin",
    strictTransportSecurity: https ? "max-age=31536000; includeSubDomains" : false,
    // Off: the API is reached cross-origin by the CLI and the MCP server, and
    // `same-origin` here would have a browser block those reads for no gain —
    // the resources worth protecting are behind authentication, not behind a
    // reader's browser.
    crossOriginResourcePolicy: false,
    crossOriginEmbedderPolicy: false,
  });
}

/**
 * Applies the SPA's Content-Security-Policy to the web interface's HTML, and
 * makes browsers revalidate that HTML on every load.
 *
 * @remarks
 * The shell names the hashed bundle to load, so a cached shell keeps an old
 * interface running after a redeploy. `no-cache` still lets the browser keep
 * it, behind a cheap ETag check. The hashed assets are left cacheable.
 *
 * Conditioned on the response's `content-type` rather than on the path,
 * because the shell is served from two places — `serveStatic` for `/`, and
 * the SPA fallback for every client-side route — and both answer with HTML.
 * Hashed assets, JSON, and Artifact bytes are left alone.
 *
 * @param storageOrigin - Where presigned uploads go — see `spaPolicy`.
 * @returns A middleware handler.
 * @example
 * ```ts
 * app.use("*", spaContentSecurityPolicy("https://storage.example"));
 * ```
 */
export function spaContentSecurityPolicy(storageOrigin?: string) {
  const policy = spaPolicy(storageOrigin);

  return createMiddleware(async (c, next) => {
    await next();
    if (c.res.headers.get("content-type")?.includes("text/html")) {
      c.res.headers.set("content-security-policy", policy);
      c.res.headers.set("cache-control", "no-cache");
    }
  });
}
