FROM node:20-slim AS base
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run prisma:generate
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY --from=base /app/dist ./dist
COPY --from=base /app/prisma ./prisma
RUN npm run prisma:generate
EXPOSE 3000
CMD ["node", "dist/server.js"]
