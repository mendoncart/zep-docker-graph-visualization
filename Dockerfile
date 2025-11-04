# Etapa 1 - build da aplicação
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY yarn.lock* ./
RUN yarn install --frozen-lockfile

COPY . .

RUN yarn next build --no-lint

# Etapa 2 - runtime
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copia o resultado do build
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3000

CMD ["yarn", "start"]
