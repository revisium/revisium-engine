FROM node:24.11.1-alpine AS builder

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts && pnpm rebuild sharp @swc/core @prisma/engines prisma

COPY src ./src
COPY prisma ./prisma
COPY tsconfig.json tsconfig.build.json nest-cli.json prisma.config.ts ./

RUN pnpm run build

FROM node:24.11.1-alpine

RUN apk add --no-cache curl && \
    addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma

RUN chown -R appuser:appgroup /app

USER appuser

CMD ["npm", "run", "start:prod"]
