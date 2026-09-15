# Pinned to an exact patch, not the floating `1` tag: a rebuild months from
# now must produce the same runtime as this one, and `oven/bun:1` silently
# moves under it (ISSUE-18).
FROM oven/bun:1.4.2 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN bun install --frozen-lockfile

FROM deps AS build-web
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN bun run --filter '@in-org-quicko/sqillset-web' build

FROM oven/bun:1.4.2-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/apps/api/node_modules apps/api/node_modules
COPY --from=deps /app/packages/shared/node_modules packages/shared/node_modules
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api/package.json apps/api/package.json
COPY apps/api/src apps/api/src
COPY apps/api/drizzle apps/api/drizzle
COPY --from=build-web /app/apps/web/dist apps/web/dist

WORKDIR /app/apps/api
EXPOSE 3000

# `/api/health` already answers a `SELECT 1`, so an orchestrator can tell "the
# process is up" from "the process can reach its database" — it just had no
# way to ask (ISSUE-18). `bun --eval` rather than curl: this image ships no
# curl, and adding one to run a health check would be a larger attack surface
# than the check is worth.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD bun --eval "const port = process.env.PORT ?? 3000; const res = await fetch('http://127.0.0.1:' + port + '/api/health'); process.exit(res.ok ? 0 : 1)"

# The image ships this user; without it Bun ran as root, so a remote-code
# path in the API would have started out as root inside the container
# (ISSUE-18). Everything above is copied in as root and only read from here,
# which is what makes dropping privileges after the copies safe.
USER bun

CMD ["bun", "src/server.ts"]
