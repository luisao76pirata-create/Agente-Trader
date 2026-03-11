FROM node:23-alpine AS builder
RUN apk add --no-cache curl git python3 make g++
RUN npm install -g bun@1.3.5
WORKDIR /app
COPY package.json ./
RUN bun install --production
COPY . .

FROM node:23-alpine AS runtime
RUN apk add --no-cache python3
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/index.js ./
COPY --from=builder /app/characters ./characters
CMD ["node", "index.js"]
