# Deployment and data recovery

Build `frontend/dist` with `npm ci && npm run build`. Serve it with SPA fallback and route `/api/*`, `/sanctum/*` and `/up` to Laravel's `backend/public/index.php` through PHP-FPM. Keep the frontend and API on the same origin; `docs/nginx.conf.example` is a starting point. Application/stock APIs must never serve the repository root.

Use PHP 8.4+, PostgreSQL 14+ (16 recommended for the included development container), persistent storage, HTTPS, a process supervisor for PHP-FPM, and a narrowly privileged runtime database role. Run migrations with a separate owner role where possible. The database immutable-history triggers are not a substitute for protecting privileged database accounts.

Set `APP_ENV=production`, `APP_DEBUG=false`, `APP_URL` and `FRONTEND_URL` to your HTTPS origin, `SANCTUM_STATEFUL_DOMAINS` to its host, `SESSION_SECURE_COOKIE=true`, and a unique `SESSION_COOKIE`. Preserve `APP_KEY`; rotate integration tokens through a coordinated sender/receiver update. Configure trusted proxies explicitly if TLS is terminated upstream. Never publish `.env` or review credentials.

```sh
cd backend
composer install --no-dev --optimize-autoloader
php artisan migrate --force
php artisan db:seed --force
php artisan config:cache
php artisan route:cache
php artisan inventory:reconcile
```

The migrations use PostgreSQL check constraints, advisory/row locks and immutable-history triggers; SQLite is not supported. Seeders only add missing categories. Create a production administrator interactively with `php artisan sbm:create-admin email@example.com`. Do not copy a local review user/database into production.

Inventory posts synchronously. There is no Inventory queue worker requirement; Sales/Repair outboxes remain responsible for retrying deliveries. Monitor 422/409/429/5xx responses and run `inventory:reconcile` regularly through your operational scheduler. A nonzero exit means a cached balance differs from the ledger; investigate and restore correctly rather than overwriting history.

## PostgreSQL backup

Use your deployment's secret manager or `.pgpass` (mode 0600), not a password in shell command arguments. Set the standard PostgreSQL host/user variables for the intended server. Back up to a protected destination with retention and off-host copies:

```sh
pg_dump --format=custom --file=sbm_inventory.dump sbm_inventory
pg_restore --list sbm_inventory.dump
```

Also back up the deployment configuration and `APP_KEY` securely, separately from public artifacts. Decide backup frequency and point-in-time recovery based on acceptable transaction loss; enable WAL archival if needed.

## Login appearance and private RustFS storage

Administrators can change the shared login background in **Settings → User interface**. Choose a file, review the preview, then select **Save background**. **Restore animated default** removes the uploaded background and restores the aurora. JPEG, PNG, WebP, GIF and AVIF images are limited to 10 MB; MP4 and WebM videos are limited to 50 MB.

Set `LOGIN_BACKGROUND_DISK=rustfs`, `RUSTFS_ENDPOINT`, `RUSTFS_REGION`, `RUSTFS_BUCKET=sbm-inventory-private`, `RUSTFS_ACCESS_KEY` and `RUSTFS_SECRET_KEY` in the protected backend environment. Provision a private bucket and allow the app's storage account to read, write and delete objects in `login-backgrounds/`. Apply migrations and clear/cache configuration after changes. Credentials and bucket URLs remain server-side; the login page retrieves the selected file through a public token route in Inventory. The background itself is visible to everyone visiting the login page, so use an image suitable for public display.

Replacement and reset delete the previous object after the database change commits. Include the RustFS bucket in off-host backups alongside the database, which records the current object path and token. A database backup alone does not contain uploaded media. Coordinate object retention with database restore points.

The included PHP-FPM, Caddy and Nginx configurations allow 50 MB uploads with a 55 MB request limit. Apply those limits to any upstream proxy as well. For local development, `bash scripts/serve-backend.sh` starts the backend on port 8000 with the same PHP upload limits; set `INVENTORY_API_PORT` if a different port is required and update the Vite proxy accordingly.

## Restore rehearsal

Always restore into a new, empty isolated database first. Do not restore over live business data.

```sh
createdb sbm_inventory_restore
pg_restore --exit-on-error --no-owner --dbname=sbm_inventory_restore sbm_inventory.dump
```

Point an isolated copy of the app at the restored database, run `php artisan inventory:reconcile`, inspect catalogue/history and external acknowledgements, then test login and a controlled new movement. The dump includes immutable-history triggers; schema restore creates them after table data. If rehearsal succeeds, plan downtime and cutover explicitly. Record backup time, restore duration and reconciliation result. Backup/restore commands are documented; an operational disaster-recovery rehearsal has not been performed by this implementation task.

## Docker PostgreSQL for ongoing development

`docker compose up -d` starts only PostgreSQL with a persistent named volume on host port 55441, avoiding the temporary test cluster. Set `INVENTORY_DB_PASSWORD` in the root ignored `.env` before starting. Update backend DB values to database/user `sbm_inventory`, port `55441`, and that password. Create a separate test database and configure `.env.testing` if using this server for tests. Never remove the volume unless intentionally deleting all development data.

## inventory.vgadget.my — native Caddy + PHP 8.4-FPM

The native deployment installer is `scripts/install-production.sh`. It uses `/home/system/sbm-inventory`, a separate FPM socket, and the existing Caddy site without replacing Main or Sales. Production selects `DO_DB_*` credentials with SSL; local/testing retains `DB_*`. The installer creates the dedicated `sbm-inventory` database and schema before migrations and seeds only categories. It preserves APP_KEY and storage, keeps the project `.env` as a regular protected file, and installs a minute timer for `inventory:reconcile`. Inventory posts synchronously and needs no queue worker.

```bash
cd /home/system/sbm-inventory
composer install --working-dir=backend --no-dev --no-interaction --optimize-autoloader
(cd frontend && npm ci && npm run build)
sudo bash scripts/install-production.sh
cd /home/system/sbm-inventory/backend
sudo -u www-data php artisan sbm:create-admin YOUR_EMAIL
```

Set DNS for inventory.vgadget.my to this server and use Cloudflare Full (strict). Verify `https://inventory.vgadget.my/up` and login after deployment. Back up the dedicated database and protected environment. Sales integration still requires the adapter changes described in integration-contracts.md.

After backend code or route changes, rebuild the route cache and gracefully reload PHP-FPM:

```bash
cd /home/system/sbm-inventory/backend
php artisan route:cache
sudo systemctl reload php8.4-fpm
```

This server sets `opcache.validate_timestamps=0`, so PHP-FPM continues using cached PHP code until it is reloaded. CLI route checks can pass while HTTPS requests still use old routes. The production installer already performs this reload. Verify through HTTPS after manual updates as well.

For the existing server, first run `sudo bash /home/system/caddy/migrate-app-paths.sh`. It switches Main, Inventory and Sales together, preserves live storage and environment settings, and archives the old deployments after HTTPS health and frontend checks pass. The path migration does not migrate or seed databases. The installer refuses to run while Caddy still uses the legacy Inventory directory. Source ownership stays with the developer.
