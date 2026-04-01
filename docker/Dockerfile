FROM node:24.11.1-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY src ./src
COPY prisma ./prisma
COPY tsconfig.json tsconfig.build.json nest-cli.json prisma.config.ts ./

RUN npm run build

FROM node:24.11.1-alpine

RUN apk add --no-cache curl

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma

RUN chown -R appuser:appgroup /app

USER appuser

CMD ["npm", "run", "start:prod"]
