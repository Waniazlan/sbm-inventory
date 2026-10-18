#!/usr/bin/env bash
set -euo pipefail

# Apply upload limits to the actual PHP web-server process.
cd "$(dirname "$0")/../backend/public"
exec php -d upload_max_filesize=50M -d post_max_size=55M \
  -S "127.0.0.1:${INVENTORY_API_PORT:-8000}" \
  ../vendor/laravel/framework/src/Illuminate/Foundation/resources/server.php
