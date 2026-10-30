<?php

use App\Services\SupplierReturns;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('stock_reservations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('supplier_return_id')->constrained();
            $table->foreignId('item_id')->constrained();
            $table->foreignId('stock_batch_id')->constrained();
            $table->foreignId('item_unit_id')->nullable()->constrained();
            $table->integer('quantity');
            $table->timestampTz('created_at');
            $table->timestampTz('released_at')->nullable();
            $table->index(['item_id', 'released_at']);
            $table->index(['stock_batch_id', 'released_at']);
            $table->index(['supplier_return_id', 'released_at']);
        });
        DB::statement('ALTER TABLE stock_reservations ADD CONSTRAINT stock_reservations_quantity_check CHECK (quantity > 0 AND (item_unit_id IS NULL OR quantity = 1))');
        DB::statement('CREATE UNIQUE INDEX stock_reservations_active_unit_unique ON stock_reservations (item_unit_id) WHERE released_at IS NULL');
        app(SupplierReturns::class)->upgradeLegacy();
    }

    public function down(): void
    {
        if (DB::table('stock_reservations')->whereNull('released_at')->exists()) {
            throw new RuntimeException('Complete Process supplier returns before removing stock reservation storage.');
        }
        Schema::dropIfExists('stock_reservations');
    }
};
