<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('supplier_returns', function (Blueprint $table) {
            $table->id();
            $table->uuid('request_key')->unique();
            $table->string('fingerprint', 64);
            $table->foreignId('item_id')->constrained();
            $table->foreignId('supplier_id')->constrained();
            $table->integer('quantity');
            $table->string('status')->default('process')->index();
            $table->string('reference', 120)->nullable();
            $table->string('reason');
            $table->text('serials')->nullable();
            $table->foreignId('stock_movement_id')->nullable()->constrained('movements');
            $table->foreignId('created_by')->constrained('users');
            $table->foreignId('updated_by')->constrained('users');
            $table->timestampsTz();
        });
        DB::statement("ALTER TABLE supplier_returns ADD CONSTRAINT supplier_returns_status_check CHECK (status IN ('process', 'delivered', 'rejected'))");
        DB::statement('ALTER TABLE supplier_returns ADD CONSTRAINT supplier_returns_quantity_check CHECK (quantity > 0 AND quantity <= 100000000)');
    }

    public function down(): void
    {
        Schema::dropIfExists('supplier_returns');
    }
};
