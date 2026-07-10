FROM node:22-alpine
EXPOSE 8150
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install --production

COPY . .
CMD ["npm", "start"]