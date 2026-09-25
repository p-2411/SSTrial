# One image, two processes. APP_PROCESS picks which one a container runs:
#   docker run … label-extractor                         → API + web UI on :3000 (default)
#   docker run -e APP_PROCESS=worker … label-extractor   → worker
# Hosts like Railway then need no per-service start command — just a different variable.
# The server runs its TypeScript directly (Node's built-in type stripping), so only the web app
# needs a build step.

# ---- Build the web app -----------------------------------------------------------------------
FROM node:24-slim AS web-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY tsconfig.base.json ./
COPY shared shared
COPY web web
RUN npm run build -w web

# ---- Runtime -----------------------------------------------------------------------------------
FROM node:24-slim
ENV NODE_ENV=production \
    WEB_DIST_DIR=/app/web/dist \
    PORT=3000 \
    APP_PROCESS=api
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
# Production dependencies of the server (and the shared package it imports) only.
RUN npm ci --omit=dev --workspace server --include-workspace-root=false && npm cache clean --force
COPY shared/src shared/src
COPY server/src server/src
COPY --from=web-build /app/web/dist web/dist

USER node
EXPOSE 3000
# `exec` makes Node PID 1 so it receives SIGTERM directly and can shut down gracefully.
CMD ["sh", "-c", "case \"$APP_PROCESS\" in api|worker) exec node server/src/$APP_PROCESS/main.ts ;; *) echo \"APP_PROCESS must be api or worker, got '$APP_PROCESS'\" >&2; exit 1 ;; esac"]
