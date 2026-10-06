# syntax = docker/dockerfile:1

# Node runs the TypeScript server directly (type stripping); the only build
# step is bundling the browser client with esbuild. SQLite is node:sqlite,
# built in, so there's no native module to compile.

FROM docker.io/library/node:24.21.0-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@11.9.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm prune --prod

FROM docker.io/library/node:24.21.0-alpine
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/public public
COPY server server
COPY shared shared
COPY package.json README.md ./
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.ts"]
