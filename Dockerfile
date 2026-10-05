# Imagen oficial de Bun: incluye servidor web y cliente de PostgreSQL.
# La app no tiene dependencias externas, así que no hace falta "install".
FROM oven/bun:1-slim

WORKDIR /app
ENV NODE_ENV=production
COPY . .

USER bun
CMD ["bun", "src/server.js"]
