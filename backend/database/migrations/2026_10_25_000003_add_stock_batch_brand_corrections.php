<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('stock_batches', function (Blueprint $t) {
            $t->boolean('brand_corrected')->default(false);
            $t->string('brand_override', 100)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('stock_batches', fn (Blueprint $t) => $t->dropColumn(['brand_corrected', 'brand_override']));
    }
};
