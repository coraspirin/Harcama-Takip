# syntax=docker/dockerfile:1

# ---------- Stage 1: Frontend build ----------
FROM node:26-alpine AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---------- Stage 2: Backend build (TypeScript -> JavaScript) ----------
FROM node:26-alpine AS server-build
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
# tsc hem tip kontrolu yapar hem dist/ uretir: tip hatasi imaji bozar,
# uretime kacmaz.
RUN npm run build

# ---------- Stage 3: Runtime ----------
FROM node:26-alpine
ENV NODE_ENV=production
WORKDIR /app/server

# pdftoppm: metin katmani olmayan (taranmis) PDF ekstreleri goruntuye cevirmek
# icin (Faz 8). font-liberation: alpine'da font yoktur; metin katmani bozuk
# PDF'ler rasterize edilirken fontsuz sayfa bos render olur.
# Kod degisiminden bagimsiz cache'lensin diye COPY'lerden ONCE.
RUN apk add --no-cache poppler-utils font-liberation tzdata

# Yalnizca uretim bagimliliklari. node:sqlite yerlesiktir, bcryptjs ve
# tesseract.js saf JS/WASM oldugu icin native derleme gerekmez.
COPY server/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=server-build /app/server/dist ./dist
COPY --from=client-build /app/client/dist /app/client/dist

ENV CLIENT_DIR=/app/client/dist \
    DATA_DIR=/data/db \
    UPLOAD_DIR=/data/uploads \
    PORT=4000 \
    TZ=Europe/Istanbul

EXPOSE 4000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:4000/api/health || exit 1

CMD ["node", "dist/index.js"]
