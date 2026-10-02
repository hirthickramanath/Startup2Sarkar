# Startup2Sarkar — single container: API + built web app on one port.
FROM node:22-alpine AS build
WORKDIR /app
# Native modules (argon2 ships prebuilt musl binaries; build tools are a fallback)
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run typecheck && npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3001 HOST=0.0.0.0
RUN apk add --no-cache curl
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/tsconfig.json ./
# Writable location for the optional embedded database and uploaded evidence (mount a volume here)
RUN mkdir -p /data && chown -R node:node /data /app
ENV UPLOAD_DIR=/data/uploads PGLITE_DATA_DIR=/data/pglite
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD curl -fs http://localhost:3001/health || exit 1
CMD ["node", "--import", "tsx", "server/src/server.ts"]
