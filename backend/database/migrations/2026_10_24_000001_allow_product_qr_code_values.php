<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE items DROP CONSTRAINT items_barcode_format');
        DB::statement('ALTER TABLE items ALTER COLUMN barcode TYPE VARCHAR(500)');
        DB::statement(<<<'SQL'
            ALTER TABLE items ADD CONSTRAINT items_barcode_format CHECK (
                barcode IS NULL OR (
                    char_length(barcode) BETWEEN 1 AND 500
                    AND barcode !~ U&'[\0001-\001F\007F-\009F]'
                )
            )
            SQL);
    }

    public function down(): void
    {
        if (DB::table('items')->whereRaw("barcode !~ '^[A-Za-z0-9]{1,100}$'")->exists()) {
            throw new RuntimeException('Cannot restore alphanumeric-only barcodes while QR code or extended values exist.');
        }

        DB::statement('ALTER TABLE items DROP CONSTRAINT items_barcode_format');
        DB::statement('ALTER TABLE items ALTER COLUMN barcode TYPE VARCHAR(100)');
        DB::statement("ALTER TABLE items ADD CONSTRAINT items_barcode_format CHECK (barcode IS NULL OR barcode ~ '^[A-Za-z0-9]{1,100}$')");
    }
};
