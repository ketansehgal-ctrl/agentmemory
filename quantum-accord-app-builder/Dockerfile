FROM node:22-bookworm-slim

# keytool (from the Java runtime) creates each app's Android signing key.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openjdk-17-jre-headless ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev

# Mount a persistent volume at /data: saved projects, signing keys and build workspaces live there.
ENV NODE_ENV=production \
  DATA_DIR=/data/studio \
  WORK_DIR=/data/work
EXPOSE 3000
CMD ["node", "dist/index.js"]
