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
