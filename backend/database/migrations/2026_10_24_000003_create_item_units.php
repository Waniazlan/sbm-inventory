<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement('CREATE SEQUENCE IF NOT EXISTS inventory_barcode_seq');
        DB::statement('CREATE SEQUENCE IF NOT EXISTS inventory_unit_serial_seq');
        Schema::table('items', fn (Blueprint $t) => $t->boolean('serial_tracking')->default(false));
        Schema::create('item_units', function (Blueprint $t) {
            $t->id();
            $t->foreignId('item_id')->constrained();
            $t->string('serial_number', 120)->unique();
            $t->boolean('in_stock')->default(true);
            $t->foreignId('last_movement_id')->nullable()->constrained('movements');
            $t->timestamps();
            $t->index(['item_id', 'in_stock']);
        });
        Schema::create('movement_units', function (Blueprint $t) {
            $t->foreignId('movement_id')->constrained();
            $t->foreignId('item_unit_id')->constrained();
            $t->foreignId('previous_movement_id')->nullable()->constrained('movements');
            $t->primary(['movement_id', 'item_unit_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('movement_units');
        Schema::dropIfExists('item_units');
        Schema::table('items', fn (Blueprint $t) => $t->dropColumn('serial_tracking'));
        DB::statement('DROP SEQUENCE inventory_barcode_seq');
        DB::statement('DROP SEQUENCE inventory_unit_serial_seq');
    }
};
