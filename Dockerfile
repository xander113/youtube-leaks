FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY frontend ./frontend
COPY vite.config.js ./
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && install -d -m 0700 -o node -g node /app/storage
ENV NODE_ENV=production
ENV DATA_DIR=/app/storage
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/frontend/dist ./frontend/dist
COPY package.json server.js ./
COPY app ./app
COPY database ./database
COPY routes ./routes
COPY scripts ./scripts
EXPOSE 3000
USER node
CMD ["node", "scripts/start.js"]
