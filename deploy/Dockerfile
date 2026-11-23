FROM node:22-slim

WORKDIR /app

# Dipendenze di sistema leggere per sharp e better-sqlite3 su ARM64/x86_64
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

RUN mkdir -p /app/data/uploads

ENV NODE_ENV=production
ENV PORT=8000

EXPOSE 8000

CMD ["npx", "tsx", "server.ts"]
