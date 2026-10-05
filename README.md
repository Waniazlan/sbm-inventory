# SBM Inventory

Inventory Management for the SBM phone repair shop suite. Laravel 12 / PHP 8.4, PostgreSQL, React 18 / TypeScript and Vite. This is a separate application from `sbm-main` (launcher) and `sbm-sales` (invoices/payments).

## Open the local application

- Frontend: **http://127.0.0.1:5175**
- API: **http://127.0.0.1:8018**
- Initial local administrator: see the ignored `backend/.review-credentials.json` file. This account has a randomly generated password; no fixed production credentials are shipped.
- Database: isolated PostgreSQL cluster at port `55440`, databases `sbm_inventory` and `sbm_inventory_test`.

The locally created cluster lives at `/private/tmp/sbm-inventory-pg`. This is temporary development storage: use a persistent PostgreSQL installation or the included Docker volume for ongoing work. Local development PostgreSQL 14 was available and tested; the supplied Docker configuration uses PostgreSQL 16.

## Workflows

| Screen | Features |
| --- | --- |
| Overview | Live stock counts, standard-cost value, low-stock attention list, recent movements |
| Item catalogue | Unique SKU, category, supplier, brand, variants, compatible phone models, cost, optional selling price, minimum level, active status |
| Receive stock | Quantity, supplier/reference, actual unit cost, optional batch and serial notes |
| Movement ledger | Receipts, issues, counts, sales, repair usage, returns and linked reversals; search, date/type/user filters |
| Repair parts | Administrator assigns external repair references; technicians consume parts only on their active assignments |
| Low-stock watch | Active items at or below minimum, including out-of-stock items |
| Reports | Current stock, low stock, movements, stock-out reasons, repair usage, sales linkage, valuation; paginated display and CSV export |
| Integrations | Accepted external operations and acknowledgements |
| Settings | Categories, phone models, suppliers, staff roles/activation and immutable audit history |

Start by adding phone models and suppliers in Settings. Create items with compatibility mappings, then record receipts for opening stock. To issue or count a specific item, click its name in the catalogue and choose **Issue or adjust stock**. A technician can use **Repair parts → Record usage** after an administrator assigns a repair reference.

No business sample stock is seeded. Browser checks create explicitly named verification items and immutable history; successful runs reverse their receipts and deactivate those items.

## Business rules

- The movement ledger owns stock. A cached item balance is updated in the same database transaction. Catalogue edits cannot overwrite quantity.
- Positive whole-unit quantities only; pieces, sets and packs are supported. No negative stock or reservations.
- PostgreSQL item locks prevent concurrent over-issue. An entire external request succeeds or rolls back together.
- Posted movements and audit entries cannot be updated/deleted, enforced by database triggers. Corrections create linked reversals or reasoned count adjustments.
- Administrators manage catalogue, staff, receipts, manual issues, counts and reversals. Technicians see availability and their own movements, consume assigned repair parts, and cannot read item costs or valuation reports.
- Money uses integer MYR sen. Valuation is **current standard cost × on-hand quantity**, not FIFO or weighted average. Receipt costs are retained separately and do not silently change standard cost.
- UTC storage; display and report date boundaries use `SHOP_TIMEZONE` (Asia/Kuala_Lumpur by default).
- One inventory location per installation. Portal branch selection is not an inventory permission or tenant boundary.
- Batch/serial fields are receipt annotations, not serial-by-serial stock tracking.

## Installation

Requirements: PHP 8.4 with PDO PostgreSQL, mbstring, XML, ctype, curl; Composer 2; Node 24 recommended (22.14+ supported); PostgreSQL 14+.

```sh
cd backend
composer install
cp .env.example .env
# Set DB_HOST/PORT/DATABASE/USERNAME/PASSWORD for your PostgreSQL installation.
php artisan key:generate
php artisan migrate --seed
php artisan sbm:create-admin you@yourshop.com
php artisan serve --host=127.0.0.1 --port=8018
```

In another terminal:

```sh
cd frontend
npm ci
npm run dev
```

Create `sbm_inventory` and a separate `sbm_inventory_test` database before migrating/testing. Seeders only create component categories. The administrator command prompts for a password of at least 12 characters. Staff accounts are managed in Settings.

If restarting the development cluster created during implementation:

```sh
pg_ctl -D /private/tmp/sbm-inventory-pg -l /private/tmp/sbm-inventory-pg.log -o '-p 55440 -h 127.0.0.1 -k /private/tmp' start
```

The development cluster uses local trust authentication and listens only on loopback. Do not expose it externally.

## Integration status

The Inventory endpoints are implemented and tested, but **the current sbm-sales adapter is not compatible without changes**. Its existing invoice-creation stock-out lacks payment confirmation, actor and sale-line references. Inventory deliberately rejects that older payload.

[Integration contract](docs/integration-contracts.md) describes request bodies, tokens, idempotency, return rules, pagination and the exact Sales changes needed. Neither Sales nor the portal was modified. No real Repair Tracking service was available to test.

For the portal, set the Inventory application's URL to `http://127.0.0.1:5175` in the appropriate branch settings. Login remains separate; there is no cross-application SSO.

## Verification

```sh
# backend; dedicated sbm_inventory_test database only
php artisan test
vendor/bin/pint --test
composer validate --strict
php artisan inventory:reconcile
# frontend
npm run build
npm test
```

Browser tests require both servers, installed Chrome (override `SBM_CHROME_PATH`), and the ignored local review credentials. Create these only on a local development database with `php scripts/create-review-user.php` from the project root. Browser tests create development ledger entries; they never erase history.

See [verification evidence](docs/verification.md) and [deployment / backup instructions](docs/deployment.md).

## Native production setup

Deployment files for `inventory.vgadget.my` are prepared under `deploy/` and `scripts/install-production.sh`. See [deployment instructions](docs/deployment.md). Dependencies and frontend build are installed; activation requires running the installer with sudo.
