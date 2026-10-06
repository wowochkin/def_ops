# Один образ на все сервисы платформы; какой запускать — задаёт SERVICE.
FROM node:22-alpine AS deps
WORKDIR /app
# Закрытые/корпоративные сети: сертификаты прокси кладутся в deploy/extra-ca/*.crt,
# адреса прокси передаются стандартными аргументами HTTP_PROXY / HTTPS_PROXY / NO_PROXY.
COPY deploy/extra-ca/ /usr/local/share/ca-certificates/extra/
RUN cat /usr/local/share/ca-certificates/extra/*.crt > /tmp/extra-ca.pem 2>/dev/null || true
ENV NODE_EXTRA_CA_CERTS=/tmp/extra-ca.pem
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/service-kit/package.json packages/service-kit/
COPY packages/api-client/package.json packages/api-client/
COPY services/documents/package.json services/documents/
COPY services/render/package.json services/render/
COPY services/gateway/package.json services/gateway/
COPY apps/editor/package.json apps/editor/
RUN npm ci --no-audit --no-fund

FROM deps AS editor-build
COPY . .
RUN npm run build -w @def-ops/editor

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY packages ./packages
COPY services ./services
COPY --from=editor-build /app/apps/editor/dist ./apps/editor/dist
ENV SERVICE=gateway
# каталог данных (том) должен принадлежать непривилегированному пользователю
RUN mkdir -p /data && chown node:node /data
USER node
CMD ["sh", "-c", "exec node_modules/.bin/tsx services/$SERVICE/src/main.ts"]
