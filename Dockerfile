FROM node:20-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./
COPY prisma ./prisma

RUN npm ci --omit=dev && npm cache clean --force

COPY . .

RUN npm run build

CMD ["sh", "-c", "npm run env:check && npm run docker-start"]
