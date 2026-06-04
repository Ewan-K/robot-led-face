FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . ./

ENV NODE_ENV=production
ENV PORT=8765

EXPOSE 8765

CMD ["node", "proxy-tce.js"]
