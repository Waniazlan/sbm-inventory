#!/usr/bin/env bash
set -euo pipefail
trap 'printf "Installation failed at line %s (exit %s).\n" "$LINENO" "$?" >&2' ERR
if [[ $EUID -ne 0 ]]; then
  echo 'Run with sudo: sudo bash scripts/install-production.sh' >&2
  exit 1
fi
project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
site_dir=/var/www/sbm-inventory
[[ -f "$project_dir/frontend/dist/index.html" && -f "$project_dir/backend/vendor/autoload.php" ]] || {
  echo 'First install production Composer dependencies and build frontend/dist.' >&2; exit 1;
}
echo 'Checking production installation prerequisites...'
for tool in php caddy rsync runuser grep curl; do
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
backup_stamp=$(date -u +%Y%m%d%H%M%S)
cp -p "$env_source" "$env_source.backup.$backup_stamp"
key_source="$env_source"
if [[ -f "$site_dir/backend/.env" ]]; then
  key_source="$site_dir/backend/.env"
  cp -p "$key_source" "$site_dir/backend/.env.backup.$backup_stamp"
fi
php "$project_dir/scripts/production-env.php" "$env_source" "$site_dir/backend/.env.next" digitalocean "$key_source"
php "$project_dir/scripts/production-schema.php" "$site_dir/backend/.env.next"
rsync -a --exclude='.env*' --exclude='tests/' --exclude='storage/' --exclude='bootstrap/cache/*.php' "$project_dir/backend/" "$site_dir/backend/"
rsync -a --delete "$project_dir/frontend/dist/" "$site_dir/frontend/dist/"
# Give PHP traversal access without making the user's home publicly readable.
if ! command -v setfacl >/dev/null; then
  apt-get update
  apt-get install -y acl
fi
setfacl -m u:www-data:--x /home/system
source_owner=$(stat -c '%u' "$env_source")
cat "$site_dir/backend/.env.next" > "$env_source"
chown "$source_owner":www-data "$env_source"
chmod 0640 "$env_source"
rm -f "$site_dir/backend/.env.next" "$site_dir/backend/.env"
ln -s "$env_source" "$site_dir/backend/.env"
# Laravel view:cache requires its configured source directory, even for this API backend.
mkdir -p "$site_dir/backend/resources/views"
mkdir -p "$site_dir/backend/storage/framework/"{cache/data,sessions,views} "$site_dir/backend/storage/app/private" "$site_dir/backend/storage/logs" "$site_dir/backend/bootstrap/cache"
chown -R root:www-data "$site_dir/backend"
chmod -R u=rwX,g=rX,o= "$site_dir/backend"
# Caddy needs only the public entrypoint and static frontend.
chmod 0755 "$site_dir/backend" "$site_dir/backend/public"
find "$site_dir/backend/public" -type d -exec chmod 0755 {} +
find "$site_dir/backend/public" -type f -exec chmod 0644 {} +
chown -R www-data:www-data "$site_dir/backend/storage" "$site_dir/backend/bootstrap/cache"
chmod -R u=rwX,g=rwX,o= "$site_dir/backend/storage" "$site_dir/backend/bootstrap/cache"
chmod 0640 "$site_dir/backend/.env"
chmod -R a+rX "$site_dir/frontend"
cd "$site_dir/backend"
runuser -u www-data -- php artisan config:clear
runuser -u www-data -- php artisan migrate --force --seed
runuser -u www-data -- php artisan config:cache
runuser -u www-data -- php artisan route:cache
runuser -u www-data -- php artisan view:cache
install -m 0644 "$project_dir/deploy/php-fpm.conf" /etc/php/8.4/fpm/pool.d/sbm-inventory.conf
/usr/sbin/php-fpm8.4 -t
install -d -m 0755 /etc/caddy/sites
install -m 0644 "$project_dir/deploy/Caddyfile" /etc/caddy/sites/sbm-inventory.caddy
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
printf 'Create an admin: cd /var/www/sbm-inventory/backend && sudo -u www-data php artisan sbm:create-admin YOUR_EMAIL\n'
