ARG GO_VERSION=1.26.10
FROM node:24-alpine AS frontend
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY components.json tsconfig.json vite.config.ts postcss.config.mjs index.html ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM golang:${GO_VERSION}-alpine AS build
WORKDIR /src
ENV CGO_ENABLED=0 GOTOOLCHAIN=local
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
COPY web ./web
COPY --from=frontend /src/web/dist ./web/dist
RUN go build -trimpath -ldflags="-s -w" -o /out/agent-store ./cmd/agent-store

FROM node:24-alpine
RUN apk add --no-cache tini
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /out/agent-store /app/agent-store
COPY data /app/data
COPY auth/config.mjs auth/server.mjs auth/store-plugin.mjs /app/auth/
COPY start /app/start
ENV PORT=8080 AGENT_STORE_DB=/data/agent-store.db NODE_ENV=production AGENT_STORE_AUTH_DIR=/data/auth
EXPOSE 8080
ENTRYPOINT ["/sbin/tini", "--", "/bin/sh", "/app/start"]
