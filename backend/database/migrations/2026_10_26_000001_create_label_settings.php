<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('label_settings', function (Blueprint $table) {
            $table->id();
            $table->string('sku_prefix', 20)->default('PRN');
            $table->string('barcode_prefix', 20)->default('SBM-P');
            $table->string('serial_prefix', 20)->default('SN');
            $table->timestamps();
        });
        DB::table('label_settings')->insert([
            'id' => 1, 'sku_prefix' => 'PRN', 'barcode_prefix' => 'SBM-P', 'serial_prefix' => 'SN',
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    public function down(): void
    {
        Schema::dropIfExists('label_settings');
    }
};
