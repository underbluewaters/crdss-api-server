FROM node:21 AS base

FROM base AS builder

# RUN apk add --no-cache gcompat
WORKDIR /app

# Optional: Create a .env file in the container with these paths
RUN echo "ATTRIBUTES_PATH=/app/attributes.json" > /app/.env && \
    echo "DUCKDB_PATH=/app/crdss.duckdb" >> /app/.env && \
    echo "PORT=3000" >> /app/.env
  
COPY package*json tsconfig.json src ./

RUN ln -s /usr/bin/python3 /usr/bin/python

RUN npm ci --no-optional && \
    npm run build && \
    npm prune --production

FROM base AS runner

# Define build arguments for file paths
ARG ATTRIBUTES_PATH
ARG DUCKDB_PATH

WORKDIR /app

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 hono
# Add home directory to hono user as /app
RUN usermod -d /app hono

COPY --from=builder --chown=hono:nodejs /app/node_modules /app/node_modules
COPY --from=builder --chown=hono:nodejs /app/dist /app/dist
COPY --from=builder --chown=hono:nodejs /app/package.json /app/package.json
COPY --from=builder --chown=hono:nodejs /app/.env /app/.env
COPY --chown=hono:nodejs data/attributes.json /app/attributes.json
COPY --chown=hono:nodejs data/crdss.duckdb /app/crdss.duckdb

# Make sure hono user can write to /app
RUN chown -R hono:nodejs /app

RUN node --env-file=/app/.env /app/dist/install_extensions.js

USER hono
EXPOSE 3000

CMD ["node", "--env-file=/app/.env", "/app/dist/server.js"]