FROM node:24.11.1-alpine AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY relay ./relay
RUN npx esbuild relay/start.ts --bundle --platform=node --format=esm --packages=bundle --external:bufferutil --external:utf-8-validate --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" --outfile=/relay.mjs

FROM node:24.11.1-alpine
WORKDIR /app
COPY --from=build /relay.mjs ./relay.mjs
ENV HOST=0.0.0.0 PORT=8091
USER node
EXPOSE 8091
CMD ["node", "relay.mjs"]
