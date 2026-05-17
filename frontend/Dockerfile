FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG NEXT_PUBLIC_API_URL=http://localhost:4000/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# Match backend uid (1001) for consistency. Next.js standalone server only
# needs to read its own files; nothing on disk outside /app/.next/cache.
RUN addgroup -S app -g 1001 && adduser -S app -u 1001 -G app

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
RUN chown -R app:app /app

USER app
EXPOSE 3000
ENV PORT=3000
CMD ["node", "server.js"]
