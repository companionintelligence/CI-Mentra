FROM denoland/deno:alpine-2.9.5
WORKDIR /app

# Copy manifests first so dependency resolution is its own cached layer.
# deno.json sets "nodeModulesDir": "auto", so `deno check` below also
# materializes node_modules for the npm: packages (express, pg, ioredis,
# @mentra/sdk, etc.) the app imports via bare specifiers through Deno's npm
# compat layer, using deno.lock for reproducible resolution.
COPY deno.json deno.lock package.json package-lock.json ./
COPY src/ ./src/

# Resolves + caches all deps and type-checks the app; fails the build early
# if either is broken. Doubles as the "build" step for a runtime (Deno) that
# otherwise needs no separate compile/bundle before running.
RUN deno check src/index.ts

ENV NODE_ENV=production
EXPOSE 7010 8080

CMD ["run", "-A", "src/index.ts"]
