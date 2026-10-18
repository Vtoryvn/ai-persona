FROM node:22-bookworm

RUN if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
      sed -i 's/Components: main/Components: main non-free/' /etc/apt/sources.list.d/debian.sources; \
    else \
      echo "deb http://deb.debian.org/debian bookworm non-free" > /etc/apt/sources.list.d/nonfree.list; \
    fi \
  && apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl gnupg wget git \
    gcc libc6-dev x11-utils locales \
    xvfb openbox x11vnc \
    fonts-liberation fonts-dejavu-core fonts-freefont-ttf fonts-noto-core fonts-noto-color-emoji \
    fonts-lohit-deva fonts-lohit-taml fonts-lohit-telu \
    fonts-noto-cjk fonts-sil-padauk fonts-ubuntu fonts-tlwg-norasi fonts-tlwg-waree \
    python3 python3-fonttools \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libcups2 \
    libdbus-1-3 libdrm2 libgbm1 libegl1 libgl1-mesa-dri libgtk-3-0 libnspr4 libnss3 libx11-xcb1 \
    libxcomposite1 libxdamage1 libxrandr2 xdg-utils \
  && sed -i 's/^# *\(en_US.UTF-8\|de_DE.UTF-8\|vi_VN.UTF-8\)/\1/' /etc/locale.gen \
  && locale-gen \
  && git clone --depth 1 https://github.com/novnc/noVNC.git /opt/noVNC \
  && rm -rf /var/lib/apt/lists/*

RUN wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
  && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" \
    > /etc/apt/sources.list.d/google-chrome.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends google-chrome-stable \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /etc/opt/chrome/policies/managed /etc/chromium/policies/managed

WORKDIR /app

COPY package.json package-lock.json* ./
COPY packages/shared/package.json /app/packages/shared/package.json
COPY deploy/persona-runner/package.json /app/deploy/persona-runner/package.json

RUN npm install --workspace=@persona-system/runner --workspace=@persona-system/shared

COPY packages/shared /app/packages/shared
COPY deploy/persona-runner /app/deploy/persona-runner

RUN python3 /app/deploy/persona-runner/scripts/patch-linux-fonts.py \
  && gcc -shared -fPIC -O2 /app/deploy/persona-runner/engine/persona_engine.c \
    -o /usr/local/lib/libpersona_engine.so -ldl -pthread \
  && ln -sf /usr/local/lib/libpersona_engine.so /usr/lib/x86_64-linux-gnu/libspeechd.so.2 \
  && ln -sf /usr/local/lib/libpersona_engine.so /usr/local/lib/libspeechd.so.2 \
  && ldconfig \
  && node -e 'const fs=require("fs"),p="/opt/google/chrome/chrome";if(fs.existsSync(p)){const b=fs.readFileSync(p),n=Buffer.from("$cdc_"),r=Buffer.from("$pna_");let i=0,c=0;while((i=b.indexOf(n,i))!==-1){r.copy(b,i);i+=n.length;c++;}if(c>0)fs.writeFileSync(p,b);console.log("Binary scrubbed markers:",c);}' \
  && npm run build --workspace=@persona-system/shared \
  && npm run build --workspace=@persona-system/runner \
  && npm prune --omit=dev

WORKDIR /app/deploy/persona-runner
RUN chmod +x start.sh

ENV PORT=8080
ENV NOVNC_PORT=6080
ENV CHROME_DEBUG_PORT=9222
ENV CHROME_EXECUTABLE=/usr/bin/google-chrome-stable
ENV CHROME_USER_DATA_DIR=/data/chrome-profile
ENV PERSONA_MCP_DRIVER=veil
ENV PERSONA_REQUIRE_HEADED=1
ENV PERSONA_HOST_CORES=8
ENV PERSONA_DEVICE_MEMORY_GB=8
ENV NODE_ENV=production

EXPOSE 8080 6080

CMD ["./start.sh"]
