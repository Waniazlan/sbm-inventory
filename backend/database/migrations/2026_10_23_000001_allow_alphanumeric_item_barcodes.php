<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE items DROP CONSTRAINT items_barcode_format');
        DB::statement('ALTER TABLE items ALTER COLUMN barcode TYPE VARCHAR(100)');
        DB::statement("ALTER TABLE items ADD CONSTRAINT items_barcode_format CHECK (barcode IS NULL OR barcode ~ '^[A-Za-z0-9]{1,100}$')");
    }

    public function down(): void
    {
        // Refuse rollback while newer values exist instead of truncating identifiers.
        if (DB::table('items')->whereRaw("barcode !~ '^[0-9]{16}$'")->exists()) {
            throw new RuntimeException('Cannot restore numeric barcodes while alphanumeric or variable-length barcodes exist.');
        }

        DB::statement('ALTER TABLE items DROP CONSTRAINT items_barcode_format');
        DB::statement('ALTER TABLE items ALTER COLUMN barcode TYPE VARCHAR(16)');
        DB::statement("ALTER TABLE items ADD CONSTRAINT items_barcode_format CHECK (barcode IS NULL OR barcode ~ '^[0-9]{16}$')");
    }
};
