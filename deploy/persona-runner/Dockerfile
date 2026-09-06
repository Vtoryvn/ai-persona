FROM node:22-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl gnupg wget \
    fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 libcups2 \
    libdbus-1-3 libdrm2 libgbm1 libgtk-3-0 libnspr4 libnss3 libx11-xcb1 \
    libxcomposite1 libxdamage1 libxrandr2 xdg-utils \
  && rm -rf /var/lib/apt/lists/*

RUN wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
  && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" \
    > /etc/apt/sources.list.d/google-chrome.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends google-chrome-stable \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
COPY packages/shared/package.json /app/packages/shared/package.json
COPY deploy/persona-runner/package.json /app/deploy/persona-runner/package.json

RUN npm install --omit=dev --workspace=@persona-system/runner --workspace=@persona-system/shared || npm install

COPY packages/shared /app/packages/shared
COPY deploy/persona-runner /app/deploy/persona-runner

RUN npm run build --workspace=@persona-system/shared \
  && npm run build --workspace=@persona-system/runner

WORKDIR /app/deploy/persona-runner
RUN chmod +x start.sh

ENV PORT=8080
ENV MCP_PORT=9223
ENV NODE_ENV=production

EXPOSE 8080

CMD ["./start.sh"]
