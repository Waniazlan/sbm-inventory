# SBM Inventory

Inventory Management for the SBM phone repair shop suite. Laravel 12 / PHP 8.4, PostgreSQL, React 18 / TypeScript and Vite. This is a separate application from `sbm-main` (launcher) and `sbm-sales` (invoices/payments).

## Open the local application

- Frontend: **http://127.0.0.1:5175**
- API: **http://127.0.0.1:8000**
- Initial local administrator: see the ignored `backend/.review-credentials.json` file. This account has a randomly generated password; no fixed production credentials are shipped.
- Database: local Homebrew PostgreSQL at port `5432`, with separate databases `sbm_inventory` and `sbm_inventory_test`. Set `DB_PORT=5432` in `backend/.env` for this setup; the included Docker setup uses `55441`.

Use persistent PostgreSQL storage for ongoing work. The original development cluster at `/private/tmp/sbm-inventory-pg` on port `55440` used temporary storage and may disappear when temporary files are cleared. The current local setup uses Homebrew PostgreSQL 16 storage at `/opt/homebrew/var/postgresql@16`; the supplied Docker configuration uses PostgreSQL 16 with a persistent volume.

## Workflows

| Screen | Features |
| --- | --- |
| Overview | Live stock counts, standard-cost value, low-stock attention list, recent movements |
| Item catalogue | Unique SKU and alphanumeric barcode, camera/photo capture and barcode lookup, category, supplier, brand, variants, compatible phone models, cost, optional selling price, minimum level, active status |
| Receive stock | Quantity, supplier/reference, actual unit cost, optional batch and serial notes |
| Movement ledger | Receipts, issues, counts, sales, repair usage, returns and linked reversals; search, date/type/user filters |
| Repair parts | Administrator assigns external repair references; technicians consume parts only on their active assignments |
| Low-stock watch | Active items at or below minimum, including out-of-stock items |
| Reports | Current stock, low stock, movements, stock-out reasons, repair usage, sales linkage, valuation; paginated display and CSV export |
| Integrations | Accepted external operations and acknowledgements |
| Settings | Categories, phone models, suppliers, staff roles/activation and immutable audit history |

Start by adding phone models and suppliers in Settings. Create items with compatibility mappings, then record receipts for opening stock. To issue or count a specific item, click its name in the catalogue and choose **Issue or adjust stock**. A technician can use **Repair parts → Record usage** after an administrator assigns a repair reference.

No business sample stock is seeded. Browser checks create explicitly named verification items and immutable history; successful runs reverse their receipts and deactivate those items.

## Barcode flow

1. Open **Item catalogue → Add item** (or **Edit** an existing item).
2. Select **Scan barcode**, allow camera access, frame the entire barcode, and hold steady. The camera automatically detects a valid alphanumeric barcode, captures its value, and stops for review. Select **Scan again** to restart.
3. Review the detected letters and numbers and select **Use barcode**. Complete the item details and **Save item**.
4. To find it later, select **Scan barcode** at the top of the catalogue, let the camera detect the label, then select **Find item**. Scans search all items, including inactive items, regardless of category or stock filters.

The barcode belongs to a catalogue item (all stock of that item), not to each individual physical unit. New items require a unique alphanumeric barcode; existing items can be assigned one when available. Barcodes accept 1–100 letters and numbers. Leading zeroes and letter case are retained, duplicates are rejected, and assigned barcodes cannot be cleared. A scan only fills the form; saving the item commits it.

Camera access requires HTTPS or localhost. **Choose barcode photo** and manual entry are available if camera access is unavailable. Photos are decoded locally using ZXing and are never uploaded or stored. This reads encoded barcode bars (including Code 128, Code 39 and ITF), not OCR of printed text. Real labels should be checked on the intended phone before rollout.

For a preview label, use [this sample Code 128 barcode](frontend/e2e/fixtures/barcode-0012345678901234.svg), containing `0012345678901234`. For letters and numbers, use [this mixed-case Code 128 barcode](frontend/e2e/fixtures/barcode-code128-00AbC123xyZ.svg), containing `00AbC123xyZ`. Automated browser tests use these labels with a simulated camera and mocked API; they cover automatic decoding after empty frames, letters and numbers, confirmation, lookup, scanning again, cancellation, permission denial, unreadable images, and mobile layout.

Existing installations must run `cd backend && php artisan migrate` to widen the barcode column and update its format constraint before saving alphanumeric barcodes.

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

The repository's `.tool-versions` selects Node 24.13.0 when using asdf. Install that version with `asdf install nodejs 24.13.0` if it is not already available.

```sh
cd backend
mkdir -p bootstrap/cache storage/framework/{cache/data,sessions,views} storage/logs
composer install
cp .env.example .env
# Set DB_HOST/PORT/DATABASE/USERNAME/PASSWORD for your PostgreSQL installation.
php artisan key:generate
php artisan migrate --seed
php artisan sbm:create-admin you@yourshop.com
bash ../scripts/serve-backend.sh
```

In another terminal:

```sh
cd frontend
npm ci
npm run dev
```

Create `sbm_inventory` and a separate `sbm_inventory_test` database before migrating/testing. Seeders only create component categories. The administrator command prompts for a password of at least 12 characters. Staff accounts are managed in Settings.

For the current Homebrew development setup, start PostgreSQL before starting the backend:

```sh
brew services start postgresql@16
```

Pulling code and starting Vite do not start PostgreSQL or restore database data. If the backend reports `connection refused`, check the server and the `DB_HOST`/`DB_PORT` values in `backend/.env`, then run `php artisan config:clear` from `backend`. The example environment and PHPUnit configuration default to port `5432` for Homebrew. When using Docker, set `DB_PORT=55441` in `backend/.env` and run tests with `DB_PORT=55441 php artisan test`.

Only if the original temporary cluster is still complete (including `PG_VERSION`, configuration, and database files), it can be restarted with:

```sh
pg_ctl -D /private/tmp/sbm-inventory-pg -l /private/tmp/sbm-inventory-pg.log -o '-p 55440 -h 127.0.0.1 -k /private/tmp' start
```

The development cluster uses local trust authentication and listens only on loopback. Do not expose it externally.

## Integration status

The Inventory endpoints are implemented and tested, but **the current sbm-sales adapter is not compatible without changes**. Its existing invoice-creation stock-out lacks payment confirmation, actor and sale-line references. Inventory deliberately rejects that older payload.

[Integration contract](docs/integration-contracts.md) describes request bodies, tokens, idempotency, return rules, pagination and the exact Sales changes needed. Neither Sales nor the portal was modified. No real Repair Tracking service was available to test.

For the portal, set the Inventory application's URL to `http://127.0.0.1:5175` in the appropriate branch settings. Administrator SSO is available through SmartBusinessManager; see [SSO setup](docs/sso.md).

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

## Central administrator sign-in

SmartBusinessManager administrator SSO is implemented with OpenID Connect. See [configuration, account linking, hosting and logout](docs/sso.md). Existing local password login remains available.
