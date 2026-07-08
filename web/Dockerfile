# budgetr — self-hosted single-user deployment.
# Build:  docker build -t budgetr .
# Run:    docker run -p 3000:3000 -v budgetr-data:/data --env-file .env.local budgetr
# (or use docker-compose.yml alongside this file)

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Migrate a throwaway DB so any build-time page evaluation has a schema to hit.
RUN DATABASE_PATH=/tmp/build.db npx tsx db/migrate.ts && npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    DATABASE_PATH=/data/budgetr.db \
    ATTACHMENTS_DIR=/data/attachments \
    PORT=3000
COPY --from=build /app ./
VOLUME /data
EXPOSE 3000
# Migrations + seed are idempotent; run them on every start so upgrades are
# just "pull new image, restart".
CMD ["sh", "-c", "npx tsx db/migrate.ts && npx tsx scripts/seed-categories.ts && npx next start -H 0.0.0.0 -p ${PORT}"]
