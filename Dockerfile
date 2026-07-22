FROM node:20-alpine
WORKDIR /app
RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001 -G appgroup
COPY package.json ./
RUN echo "rebuild-2026-07-22T0430" > /tmp/build-id && npm install --omit=dev
COPY server ./server
USER appuser
EXPOSE 3001
CMD ["node", "--import", "tsx", "server/index.ts"]
