# syntax=docker/dockerfile:1
# Dockerfile for llm-council-app — zero-dependency Node.js SSE server.
# No npm install needed (built-in Node fetch + vanilla JS UI).
FROM node:22-slim AS base

WORKDIR /app

# Copy app files (no node_modules — zero dependencies)
COPY server.mjs council.mjs config.mjs eval.mjs eval2.mjs ./
COPY public/ ./public/

# Non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --gid 1001 nodejs

USER nodejs

ENV NODE_ENV=production
ENV PORT=5050
ENV HOSTNAME=0.0.0.0

EXPOSE 5050

CMD ["node", "server.mjs"]