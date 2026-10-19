# Koyeb builds this Dockerfile on its builder, then runs the runtime stage on the
# free instance (512 MB RAM, 0.1 vCPU). The Next.js build does not run inside that
# 512 MB instance. Koyeb does not publish a builder memory limit.
# https://www.koyeb.com/docs/build-and-deploy/build-from-git
# https://www.koyeb.com/docs/reference/instances

FROM node:24.19.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev --include=optional
COPY . .
# Build-time public value. Koyeb passes a service env var into the Docker build
# only when an ARG of the same name exists.
# https://www.koyeb.com/docs/build-and-deploy/environment-variables
ARG NEXT_PUBLIC_SUPPORT_EMAIL=
ENV NEXT_PUBLIC_SUPPORT_EMAIL=$NEXT_PUBLIC_SUPPORT_EMAIL
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_BUILD_CPUS=1
RUN npm run build:capped && npm prune --omit=dev

FROM node:24.19.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# start.mjs and `next start` share 512 MB. Leave room for the second process.
ENV NODE_OPTIONS=--max-old-space-size=320
ENV PORT=8000
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 8000
CMD ["npm", "start"]
