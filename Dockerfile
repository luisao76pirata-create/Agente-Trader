FROM node:23-slim
RUN apt-get update && apt-get install -y \
    curl git python3 \
    && rm -rf /var/lib/apt/lists/*
RUN npm install -g bun@1.3.5
WORKDIR /app
COPY package.json ./
RUN bun install
COPY . .
CMD ["/bin/sh", "-c", "echo \"TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN\" > .env && echo \"OPENAI_API_KEY=$OPENAI_API_KEY\" >> .env && bun run start"]
