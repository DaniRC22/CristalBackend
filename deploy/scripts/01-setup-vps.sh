#!/bin/bash
# ════════════════════════════════════════════════════════════
# Setup inicial VPS Ubuntu 24.04 - cristalequipamientos
# Correr UNA SOLA VEZ como root: bash 01-setup-vps.sh
# ════════════════════════════════════════════════════════════
set -e

echo "→ Actualizando sistema..."
apt update && apt upgrade -y

echo "→ Instalando Node.js 22 LTS..."
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

echo "→ Instalando libvips (sharp) + build tools..."
apt install -y libvips-dev build-essential

echo "→ Instalando nginx, certbot, git..."
apt install -y nginx certbot python3-certbot-nginx git

echo "→ Instalando pm2 global..."
npm install -g pm2

echo "→ Configurando firewall ufw..."
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo "→ Instalando fail2ban (banea IPs tras intentos fallidos de SSH)..."
apt install -y fail2ban
systemctl enable --now fail2ban

echo "→ Habilitando actualizaciones de seguridad automáticas..."
apt install -y unattended-upgrades
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "→ Creando /var/www y clonando repos..."
mkdir -p /var/www
cd /var/www
git clone https://github.com/DaniRC22/CristalBackend.git
git clone https://github.com/DaniRC22/CristalFrontend.git

echo "→ Creando carpeta de logs de pm2..."
mkdir -p /var/log/pm2

cat <<'EOF'

════════════════════════════════════════════════════════════
  ✅ Setup base completado
════════════════════════════════════════════════════════════

Pasos siguientes (manuales):

1) Crear el .env del backend con valores reales:
     nano /var/www/CristalBackend/.env
   (copiar el template de deploy/.env.production.example)

2) Crear el .env.production del frontend:
     nano /var/www/CristalFrontend/.env.production

3) Correr deploys:
     bash /var/www/CristalBackend/deploy/scripts/02-deploy-backend.sh
     bash /var/www/CristalBackend/deploy/scripts/03-deploy-frontend.sh

4) Instalar nginx config:
     cp /var/www/CristalBackend/deploy/nginx/cristalequipamientos.conf /etc/nginx/sites-available/
     ln -s /etc/nginx/sites-available/cristalequipamientos.conf /etc/nginx/sites-enabled/
     rm /etc/nginx/sites-enabled/default
     nginx -t
     systemctl reload nginx

5) DNS apuntando a la IP del VPS (en panel Hostinguer):
     @       A    IP_DEL_VPS
     www     A    IP_DEL_VPS
     api     A    IP_DEL_VPS

6) SSL gratis con Let's Encrypt (esperá que DNS propague ~10 min):
     certbot --nginx -d cristalequipamientos.com -d www.cristalequipamientos.com -d api.cristalequipamientos.com

7) Configurar pm2 startup (arranca automáticamente tras reboot):
     pm2 startup
     # (pegar el comando que devuelve)
     pm2 save

8) En MP: cambiar webhook URL a https://api.cristalequipamientos.com/api/webhook/mp

EOF
