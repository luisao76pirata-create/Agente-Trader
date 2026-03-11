FROM node:23-slim
RUN apt-get update && apt-get install -y \
    curl git python3 build-essential \
    && rm -rf /var/lib/apt/lists/*
RUN npm install -g bun@1.3.5
WORKDIR /app
COPY package.json ./
RUN bun install
COPY . .
CMD ["node", "index.js"]
