FROM node:20-bookworm-slim

RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3 make g++ \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV DATA_DIR=/data
ENV DATABASE_PATH=/data/githubarchive.db
ENV ARCHIVE_DIR=/data/archives
ENV BACKUPS_DIR=/data/backups

EXPOSE 3000

CMD ["sh", "-c", "npm run db:migrate && echo Starting web server && npm run start:server"]
