FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
RUN mkdir -p /app/data
ENV NODE_ENV=production
ENV DATA_DIR=/app/data
CMD ["node", "dist/index.js"]
