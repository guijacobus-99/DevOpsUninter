FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Imagem sem root: nginx escutando na 8080.
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/cabecalhos-seguranca.conf /etc/nginx/cabecalhos-seguranca.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
