FROM node:20-slim

# Chromium on Debian Bookworm (more stable than Alpine for Puppeteer)
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-freefont-ttf \
    ca-certificates \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY package.json .
RUN npm install --omit=dev

COPY index.js .

CMD ["node", "index.js"]
