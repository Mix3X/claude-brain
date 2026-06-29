# Web viewer image for claude-brain. Build + run on the NAS (or any Docker host).
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src
ENV BRAIN_WEB_HOST=0.0.0.0
ENV BRAIN_WEB_PORT=8787
EXPOSE 8787
CMD ["node", "src/web.js"]
