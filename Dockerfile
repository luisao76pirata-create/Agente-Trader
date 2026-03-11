FROM node:23-alpine
RUN apk add --no-cache curl git python3 make g++
RUN npm install -g bun@1.3.5
WORKDIR /app
COPY package.json ./
RUN bun install --production
COPY . .
CMD ["node", "index.js"]
