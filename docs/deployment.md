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

## Restore rehearsal

Always restore into a new, empty isolated database first. Do not restore over live business data.

```sh
createdb sbm_inventory_restore
pg_restore --exit-on-error --no-owner --dbname=sbm_inventory_restore sbm_inventory.dump
```

Point an isolated copy of the app at the restored database, run `php artisan inventory:reconcile`, inspect catalogue/history and external acknowledgements, then test login and a controlled new movement. The dump includes immutable-history triggers; schema restore creates them after table data. If rehearsal succeeds, plan downtime and cutover explicitly. Record backup time, restore duration and reconciliation result. Backup/restore commands are documented; an operational disaster-recovery rehearsal has not been performed by this implementation task.

## Docker PostgreSQL for ongoing development

`docker compose up -d` starts only PostgreSQL with a persistent named volume on host port 55441, avoiding the temporary test cluster. Set `INVENTORY_DB_PASSWORD` in the root ignored `.env` before starting. Update backend DB values to database/user `sbm_inventory`, port `55441`, and that password. Create a separate test database and configure `.env.testing` if using this server for tests. Never remove the volume unless intentionally deleting all development data.
