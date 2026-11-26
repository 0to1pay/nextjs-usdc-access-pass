FROM node:22.23.5-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY app ./app
COPY lib ./lib
COPY scripts ./scripts
COPY next.config.mjs ./
ARG NEXT_PUBLIC_BASE_PATH=""
ENV NEXT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build && mkdir -p .merchant && chown -R node:node .merchant .next
ENV NODE_ENV=production
USER node
EXPOSE 3000
CMD ["npm","start"]
