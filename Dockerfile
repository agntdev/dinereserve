FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/bot-toolkit/package.json ./packages/bot-toolkit/

RUN npm ci --production=false

COPY . .

RUN npm run build

CMD ["node", "dist/index.js"]
