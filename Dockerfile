FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build \
    && npm prune --omit=dev \
    && install -d -m 0700 -o node -g node /app/storage

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/app/storage
COPY --chown=node:node --from=build /app ./
EXPOSE 3000
USER node
CMD ["node", "scripts/start.js"]

FROM runtime AS worker
USER root
RUN apk add --no-cache ca-certificates ffmpeg
USER node
