# Playwright's official image ships Chromium + all OS deps already installed,
# which is what makes this "just work" on any host (Render/Railway/Fly/Docker).
FROM mcr.microsoft.com/playwright:v1.48.2-jammy

WORKDIR /app

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY . .

# Long-lived worker process. No ports to expose — it polls the queue.
CMD ["npm", "start"]
