# Production image for demos/CI/friends: bind 8787 and pass secrets via --env-file.
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY lib ./lib
COPY server.js ./

ENV NODE_ENV=production
ENV PORT=8787

EXPOSE 8787

CMD ["node", "server.js"]
