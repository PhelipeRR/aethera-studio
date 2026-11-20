# syntax = docker/dockerfile:1

ARG BUN_VERSION=1.4.4
FROM oven/bun:${BUN_VERSION}-slim AS base

LABEL fly_launch_runtime="Bun"

WORKDIR /app

ENV NODE_ENV="production"

# --- Build stage ---
FROM base AS build

# Native build deps for better-sqlite3 + other C++ addons
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential pkg-config python-is-python3

# Copy root manifest AND workspace package.json files BEFORE bun install
# so the workspace resolution succeeds at install time.
COPY package.json bun.lock ./
COPY apps/aethera-web/package.json apps/aethera-web/
COPY apps/aethera-remote-host/package.json apps/aethera-remote-host/

RUN bun install

# Now copy full source and build
COPY . .

RUN bun run build:web

# --- Final stage ---
FROM base

# FFmpeg is required by FfmpegRenderManager at runtime
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y ffmpeg libstdc++6 libgcc-s1 && \
    rm -rf /var/lib/apt/lists/*

# Copy everything from build stage (includes node_modules with production deps)
COPY --from=build /app /app

# Create data directory for SQLite (mount a Fly volume here)
RUN mkdir -p /app/apps/aethera-web/data

EXPOSE 3000

CMD ["bun", "run", "start:web"]