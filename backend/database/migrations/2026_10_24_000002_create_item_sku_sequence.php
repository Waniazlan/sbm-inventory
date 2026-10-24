<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement('CREATE SEQUENCE IF NOT EXISTS inventory_item_sku_seq MINVALUE 1');
        DB::statement('ALTER SEQUENCE inventory_item_sku_seq OWNED BY items.sku');
        // Continue after matching legacy SKUs without renumbering any items.
        DB::select(<<<'SQL'
            SELECT setval('inventory_item_sku_seq', COALESCE(
                (SELECT MAX(substring(sku FROM 5)::bigint) FROM items
                 WHERE sku ~ '^PR[NT]-[0-9]{1,18}$'), 0
            ) + 1, false)
            SQL);
    }

    public function down(): void
    {
        DB::statement('DROP SEQUENCE inventory_item_sku_seq');
    }
};
