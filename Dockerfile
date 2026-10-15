# ── Stage 1: build the React web app ─────────────────────────────────────────
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ── Stage 2: the server (serves the API and the built web app) ───────────────
FROM node:22-alpine
LABEL org.opencontainers.image.source="https://github.com/dragoneat666/MyLib" \
      org.opencontainers.image.description="MyLib - self-hosted home library"

RUN apk add --no-cache tzdata
WORKDIR /app

COPY server/package.json server/package-lock.json ./
# better-sqlite3 ships prebuilt binaries for Alpine; the build tools are only a fallback.
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
 && npm ci --omit=dev \
 && apk del .build-deps

COPY server/src ./src
COPY --from=web /web/dist ./public
# The Android APK is copied in by the CI build (server/apk/mylib.apk) when available.
COPY server/apk ./apk

ARG APP_VERSION=dev
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    BACKUP_DIR=/backups \
    APP_VERSION=$APP_VERSION

VOLUME ["/data", "/backups"]
EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/health >/dev/null || exit 1

CMD ["node", "src/index.js"]
