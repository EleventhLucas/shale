FROM --platform=linux/amd64 oven/bun:1.3.14 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM --platform=linux/amd64 oven/bun:1.3.14-slim
WORKDIR /app
ENV NODE_ENV=production \
    SHALE_PORT=3000 \
    SHALE_DATA_DIR=/data
COPY --from=build --chown=bun:bun /app/package.json /app/bun.lock ./
COPY --from=build --chown=bun:bun /app/node_modules ./node_modules
COPY --from=build --chown=bun:bun /app/dist ./dist
COPY --from=build --chown=bun:bun /app/src ./src
COPY --from=build --chown=bun:bun /app/migrations ./migrations
RUN mkdir -p /data && chown bun:bun /data
USER bun
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "const r=await fetch('http://127.0.0.1:3000/healthz');process.exit(r.ok?0:1)"]
CMD ["bun", "src/server/index.ts"]
