FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Imagem sem root: nginx escutando na 8080. O `apk upgrade` traz as correções de segurança do
# Alpine publicadas depois da imagem base.
FROM nginxinc/nginx-unprivileged:1.30-alpine
USER root
RUN apk upgrade --no-cache
USER 101
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/cabecalhos-seguranca.conf /etc/nginx/cabecalhos-seguranca.conf
COPY nginx/limite-taxa.conf /etc/nginx/limite-taxa.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
