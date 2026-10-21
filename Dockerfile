# Backup mirror image (task 191) — ONE container serves the WHOLE app:
# the built client (STATIC_DIR=dist) + the /api gateway, so a Render or
# VPS deploy is a complete Netlify-independent mirror on a single origin.
#
# Build:  docker build -t suto-osnova .
# Run:    docker run -p 3000:3000 -e QLOO_API_KEY=... -e MOCK_MODE=false suto-osnova
FROM node:22-alpine

WORKDIR /app

# Install dependencies first (layer caching). `.dockerignore` keeps
# node_modules/.git/.env/dist out of the context.
COPY package.json package-lock.json ./
RUN npm ci

# Source (client + server + build config), then build the client.
COPY . .
RUN npm run build

# The server serves dist/ as the static client (opt-in static mirror).
ENV NODE_ENV=production
ENV STATIC_DIR=dist

EXPOSE 3000

# Liveness: the health endpoint must answer OK inside the container.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/src/index.js"]
