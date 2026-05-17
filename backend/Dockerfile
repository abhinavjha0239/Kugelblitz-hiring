FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# Create a dedicated non-root user. Keeps the container off the host's root
# privileges if a process ever escapes the node sandbox.
RUN addgroup -S app -g 1001 && adduser -S app -u 1001 -G app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
RUN mkdir -p /app/uploads && chown -R app:app /app

USER app
EXPOSE 4000
CMD ["node", "dist/main"]
