FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
# npm/corepack/yarn não são usados em execução (o processo roda `node` direto) e trazem
# dependências próprias com CVEs: saem da imagem final.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg
COPY src ./src
COPY sql ./sql
USER node
EXPOSE 9100
CMD ["node", "src/index.js"]
