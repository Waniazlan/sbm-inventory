#!/usr/bin/env bash
set -euo pipefail
umask 0027
trap 'printf "Installation failed at line %s (exit %s).\n" "$LINENO" "$?" >&2' ERR
if [[ $EUID -ne 0 ]]; then
  echo 'Run with sudo: sudo bash scripts/install-production.sh' >&2
  exit 1
fi
project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
site_dir=/home/system/sbm-inventory
[[ "$project_dir" == "$site_dir" ]] || { echo 'Run from /home/system/sbm-inventory.' >&2; exit 1; }
if grep -Rqs '/var/www/sbm-inventory' /etc/caddy/Caddyfile /etc/caddy/sites; then
  echo 'First migrate the live paths: sudo bash /home/system/caddy/migrate-app-paths.sh' >&2
  exit 1
fi
[[ -f "$project_dir/frontend/dist/index.html" && -f "$project_dir/backend/vendor/autoload.php" ]] || {
  echo 'First install production Composer dependencies and build frontend/dist.' >&2; exit 1;
}
echo 'Checking production installation prerequisites...'
for tool in php caddy runuser grep curl setfacl; do
  if ! command -v "$tool" >/dev/null; then
    printf 'Missing required command in sudo PATH: %s\n' "$tool" >&2
    exit 1
  fi
done
# GD is required for image receipts/logos and PDF rendering.
if ! php -r 'exit(extension_loaded("gd") ? 0 : 1);'; then
  apt-get update
  apt-get install -y php8.4-gd
fi
mkdir -p "$site_dir/backend" "$site_dir/frontend/dist"
env_source="$project_dir/backend/.env"
[[ -f "$env_source" ]] || { echo 'Missing project backend/.env' >&2; exit 1; }
backup_dir=$(mktemp -d /var/backups/sbm-inventory-config.XXXXXXXX)
chmod 0700 "$backup_dir"
cp -p "$env_source" "$backup_dir/environment"
cp -p /etc/caddy/Caddyfile "$backup_dir/Caddyfile"
php "$project_dir/scripts/production-env.php" "$env_source" "$backup_dir/production.env" digitalocean "$env_source"
php "$project_dir/scripts/production-schema.php" "$backup_dir/production.env"
source_owner=$(stat -c '%u' "$project_dir")
# The checkout is the live application. Never copy it onto itself or replace .env with a self-link.
cat "$backup_dir/production.env" > "$env_source"
chown "$source_owner":www-data "$env_source"
install -d -o "$source_owner" -g www-data -m 0750 "$site_dir/backend/resources/views"
mkdir -p "$site_dir/backend/storage/framework/"{cache/data,sessions,views} "$site_dir/backend/storage/app/private" "$site_dir/backend/storage/logs" "$site_dir/backend/bootstrap/cache"
setfacl -m u:www-data:--x,u:caddy:--x /home/system "$site_dir"
chmod -R o-rwx "$site_dir/backend"
setfacl -Rm u:www-data:rX "$site_dir/backend"
find "$site_dir/backend" -type d -exec setfacl -m d:u:www-data:r-x {} +
setfacl -m u:caddy:--x "$site_dir/backend" "$site_dir/frontend"
setfacl -Rm u:caddy:rX "$site_dir/backend/public" "$site_dir/frontend/dist"
find "$site_dir/backend/public" "$site_dir/frontend/dist" -type d -exec setfacl -m d:u:caddy:r-x {} +
setfacl -m d:u:caddy:r-x "$site_dir/frontend"
chmod 0600 "$env_source"
setfacl -b "$env_source"
setfacl -m u:www-data:r-- "$env_source"
chown -R "$source_owner":www-data "$site_dir/backend/storage" "$site_dir/backend/bootstrap/cache"
chmod -R u=rwX,g=rwX,o= "$site_dir/backend/storage" "$site_dir/backend/bootstrap/cache"
setfacl -Rm "u:$source_owner:rwX,u:www-data:rwX" "$site_dir/backend/storage" "$site_dir/backend/bootstrap/cache"
find "$site_dir/backend/storage" "$site_dir/backend/bootstrap/cache" -type d -exec setfacl -m "d:u:$source_owner:rwx,d:u:www-data:rwx,d:o::---" {} +
runuser -u caddy -- test -r "$site_dir/frontend/dist/index.html"
runuser -u www-data -- test -r "$site_dir/backend/resources/views"
cd "$site_dir/backend"
runuser -u www-data -- php artisan config:clear
runuser -u www-data -- php artisan migrate --force --seed
runuser -u www-data -- php artisan config:cache
runuser -u www-data -- php artisan route:cache
runuser -u www-data -- php artisan view:cache
install -m 0644 "$project_dir/deploy/php-fpm.conf" /etc/php/8.4/fpm/pool.d/sbm-inventory.conf
/usr/sbin/php-fpm8.4 -t
install -d -m 0755 /etc/caddy/sites
# Existing hosts keep the site in the main Caddyfile; avoid defining the domain twice.
if ! grep -Eq '^[[:space:]]*inventory\.vgadget\.my[[:space:]]*\{' /etc/caddy/Caddyfile; then
  install -m 0644 "$project_dir/deploy/Caddyfile" /etc/caddy/sites/sbm-inventory.caddy
fi
# Preserve the existing main.vgadget.my site.
cp -p /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.backup.$(date -u +%Y%m%d%H%M%S)"
if ! grep -Fxq 'import /etc/caddy/sites/*.caddy' /etc/caddy/Caddyfile; then
  printf '\nimport /etc/caddy/sites/*.caddy\n' >> /etc/caddy/Caddyfile
fi
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
for unit in sbm-inventory-scheduler.service sbm-inventory-scheduler.timer; do
  install -m 0644 "$project_dir/deploy/$unit" "/etc/systemd/system/$unit"
done
systemctl daemon-reload
systemctl enable --now php8.4-fpm caddy
systemctl reload php8.4-fpm
systemctl reload caddy
systemctl enable --now sbm-inventory-scheduler.timer
curl --fail --silent --show-error --retry 6 --retry-all-errors --retry-delay 5 --resolve inventory.vgadget.my:443:127.0.0.1 https://inventory.vgadget.my/up >/dev/null
printf '\nInstalled. Local HTTPS health check passed. Verify https://inventory.vgadget.my through Cloudflare.\n'
printf 'Create an admin: cd /home/system/sbm-inventory/backend && sudo -u www-data php artisan sbm:create-admin YOUR_EMAIL\n'
