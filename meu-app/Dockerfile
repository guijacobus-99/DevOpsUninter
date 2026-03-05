FROM node:18
WORKDIR /meu-app
COPY package.json ./
RUN npm install
COPY . .
EXPOSE 5173
CMD [ "npm", "start" ]