#!/bin/bash
# ════════════════════════════════════════════════════════════
# Deploy / actualización del frontend
# Correr cada vez que hagas push a master en GitHub
# ════════════════════════════════════════════════════════════
set -e

cd /var/www/CristalFrontend

echo "→ git pull origin master..."
git pull origin master

echo "→ npm ci..."
npm ci

echo "→ Build (Vite lee .env.production automáticamente)..."
npm run build

echo "✅ Frontend deployado"
echo "(nginx sirve /var/www/CristalFrontend/dist/ — no requiere reload)"
