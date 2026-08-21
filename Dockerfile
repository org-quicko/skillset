FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN bun install --frozen-lockfile

FROM deps AS build-web
COPY tsconfig.base.json ./
COPY apps/web apps/web
RUN bun run --filter '@skill-registry/web' build

FROM oven/bun:1-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/apps/api/node_modules apps/api/node_modules
COPY tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/api/src apps/api/src
COPY apps/api/drizzle apps/api/drizzle
COPY --from=build-web /app/apps/web/dist apps/web/dist

WORKDIR /app/apps/api
EXPOSE 3000
CMD ["bun", "src/server.ts"]
