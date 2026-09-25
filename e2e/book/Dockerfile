FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS agent
RUN apt-get update && apt-get install -y --no-install-recommends git bash python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/orbit
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
COPY bin/build-gui.mjs ./bin/build-gui.mjs
RUN npm run build
COPY e2e/worker.mjs ./e2e/worker.mjs
COPY e2e/book/entry.mjs ./e2e/book/entry.mjs
WORKDIR /opt/book
COPY e2e/book/fixture/package*.json ./
RUN npm ci
RUN mkdir /workspace /output && chown node:node /workspace /output
USER node
WORKDIR /workspace
CMD ["node", "/opt/orbit/e2e/book/entry.mjs"]

FROM agent AS grader
USER root
WORKDIR /opt/browser
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/browser/browsers
COPY e2e/book/browser/package*.json ./
RUN npm ci && npx playwright install --with-deps chromium
COPY e2e/book/browser/grade.mjs ./grade.mjs
USER node
WORKDIR /workspace
ENTRYPOINT ["node", "/opt/browser/grade.mjs"]
