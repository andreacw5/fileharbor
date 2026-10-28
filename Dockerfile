FROM node:24.15.0-slim AS builder

ENV NODE_ENV=build

# Create app directory
WORKDIR /usr/src/app

# Install pnpm
RUN npm install -g pnpm@10.14.0

# Install app dependencies (including dev dependencies) for the build
COPY package.json pnpm-lock.yaml .npmrc pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Bundle app source
COPY . .

# Generate Prisma client and build
RUN pnpm run prisma:generate
RUN pnpm build

# Remove devDependencies to keep only production deps (pruned node_modules)
RUN pnpm prune --prod

# Drop what prune keeps but the runtime never loads:
# - the prisma CLI (+ studio, react, typescript, pglite): kept as a resolved peer of @prisma/client;
#   migrations aren't shipped in this image anyway
# - the query compilers of every database but postgres
# - ffprobe binaries for other platforms (darwin, win32, linux/ia32), sharp's musl libvips
RUN cd node_modules/.pnpm \
 && rm -rf prisma@* @prisma+studio-core@* @prisma+engines@* @prisma+dev@* @electric-sql+pglite* \
           typescript@* effect@* react@* react-dom@* @img+sharp-libvips-linuxmusl* @img+sharp-linuxmusl* \
 && find @prisma+client@*/node_modules/@prisma/client/runtime \
      \( -name '*cockroachdb*' -o -name '*mysql*' -o -name '*sqlite*' -o -name '*sqlserver*' \) -delete \
 && find ffprobe-static@*/node_modules/ffprobe-static/bin -mindepth 2 -maxdepth 2 \
      ! -path "*/linux/$(node -p process.arch)" -exec rm -rf {} +

# Start a fresh runtime image
FROM node:24.15.0-slim AS prod

# Set the NODE_ENV to production
ENV NODE_ENV=production

# Create app directory
WORKDIR /usr/src/app

# Create a non-root user and group with specific UID/GID to match host user
RUN groupadd -g 1001 app && useradd -u 1001 -g app -m app

# Copy built artifacts and dependencies from builder with ownership set during copy
COPY --chown=app:app package.json pnpm-lock.yaml ./
COPY --from=builder --chown=app:app /usr/src/app/prisma ./prisma
COPY --from=builder --chown=app:app /usr/src/app/dist ./dist
COPY --from=builder --chown=app:app /usr/src/app/node_modules ./node_modules

# Switch to non-root user
USER app

# Start the server using the production build
CMD [ "node", "dist/main.js" ]
