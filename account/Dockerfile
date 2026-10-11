FROM node:24.11.1-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY account/ ./account/
CMD ["node", "account/server.mjs"]
