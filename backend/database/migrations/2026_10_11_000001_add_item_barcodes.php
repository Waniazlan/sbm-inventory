<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('items', function (Blueprint $table) {
            $table->string('barcode', 16)->nullable()->unique();
        });
        DB::statement("ALTER TABLE items ADD CONSTRAINT items_barcode_format CHECK (barcode IS NULL OR barcode ~ '^[0-9]{16}$')");
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE items DROP CONSTRAINT items_barcode_format');
        Schema::table('items', function (Blueprint $table) {
            $table->dropColumn('barcode');
        });
    }
};
