# AI Course Studio: one image for the web app and the background worker.
#   web:    docker run ... ai-course-studio            (next start on :3000)
#   worker: docker run ... ai-course-studio npm run worker
#   migrate (once per release): docker run ... ai-course-studio npx prisma migrate deploy
# NEXT_PUBLIC_* values are baked into the browser bundle at build time, so pass
# them as build arguments (see docs/14-deployment.md). Secrets are runtime only.

FROM node:24-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# Chromium renders slides and pictures; fonts make text look right in them.
# ffmpeg comes from the ffmpeg-static package.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium fonts-liberation fonts-noto-core fonts-noto-color-emoji ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*
ENV CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM deps AS build
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_APP_DOMAIN
ARG NEXT_PUBLIC_APP_NAME
ARG NEXT_PUBLIC_AUTH_PROVIDER=better-auth
ARG NEXT_PUBLIC_REGISTRATION_OPEN=true
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID
ARG NEXT_PUBLIC_SUBSCRIPTIONS_ENABLED
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_APP_DOMAIN=$NEXT_PUBLIC_APP_DOMAIN \
    NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME \
    NEXT_PUBLIC_AUTH_PROVIDER=$NEXT_PUBLIC_AUTH_PROVIDER \
    NEXT_PUBLIC_REGISTRATION_OPEN=$NEXT_PUBLIC_REGISTRATION_OPEN \
    NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID \
    NEXT_PUBLIC_SUBSCRIPTIONS_ENABLED=$NEXT_PUBLIC_SUBSCRIPTIONS_ENABLED \
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
COPY . .
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production PORT=3000
COPY --from=build /app /app
RUN useradd --create-home --uid 1001 studio && mkdir -p /app/.storage && chown -R studio /app/.storage
USER studio
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "start"]
