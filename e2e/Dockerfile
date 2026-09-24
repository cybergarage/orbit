FROM node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c
RUN apt-get update && apt-get install -y --no-install-recommends git bash python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/orbit
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
COPY bin/build-gui.mjs ./bin/build-gui.mjs
RUN npm run build
COPY e2e/worker.mjs ./e2e/worker.mjs
RUN mkdir /workspace /output && chown node:node /workspace /output
USER node
WORKDIR /workspace
CMD ["node", "/opt/orbit/e2e/worker.mjs"]
