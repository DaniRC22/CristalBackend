#!/bin/bash
# ════════════════════════════════════════════════════════════
# Deploy / actualización del backend
# Correr cada vez que hagas push a master en GitHub
# ════════════════════════════════════════════════════════════
set -e

cd /var/www/CristalBackend

# El .env contiene secretos (service-role key, MP token): solo el dueño
# debe poder leerlo. Un .env recién creado queda 644 (world-readable).
if [ -f .env ]; then
  chmod 600 .env
fi

echo "→ git pull origin master..."
git pull origin master

echo "→ npm ci (instala deps + devDeps para poder compilar)..."
npm ci

echo "→ Build TypeScript..."
npm run build

echo "→ Limpiando devDeps (deja solo runtime)..."
npm prune --omit=dev

echo "→ pm2 reload (zero-downtime)..."
pm2 reload cristal-backend || pm2 start /var/www/CristalBackend/deploy/pm2/ecosystem.config.js
pm2 save

echo "✅ Backend deployado"
