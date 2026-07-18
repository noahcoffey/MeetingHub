# syntax=docker/dockerfile:1

# ---- deps (full, for the build) ----
FROM node:22-alpine AS deps
WORKDIR /app
# .npmrc carries legacy-peer-deps (next-auth's optional simplewebauthn@9 peer vs our v13)
COPY package.json package-lock.json* .npmrc ./
RUN npm ci

# ---- prod deps (no devDependencies) — shipped in the runtime image ----
FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json* .npmrc ./
RUN npm ci --omit=dev

# ---- builder ----
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- runner ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Next.js standalone output
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Migration assets + runner (run at container start before the server). Uses
# prod-only node_modules (no drizzle-kit/eslint/playwright/vitest in the image);
# tsx + drizzle-orm + postgres + bcryptjs are runtime deps for migrate/seed.
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=prod-deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/src/db ./src/db
COPY --from=builder --chown=nextjs:nodejs /app/docker-entrypoint.sh ./docker-entrypoint.sh

USER nextjs
EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
