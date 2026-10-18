<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('login_backgrounds', function (Blueprint $table) {
            $table->unsignedTinyInteger('id')->primary();
            $table->uuid('token')->nullable()->unique();
            $table->string('path')->nullable();
            $table->string('disk', 80)->nullable();
            $table->string('kind', 10)->nullable();
            $table->string('name')->nullable();
            $table->string('mime_type', 80)->nullable();
            $table->unsignedBigInteger('size')->nullable();
            $table->timestamps();
        });

        DB::table('login_backgrounds')->insert(['id' => 1, 'created_at' => now(), 'updated_at' => now()]);
    }

    public function down(): void
    {
        Schema::dropIfExists('login_backgrounds');
    }
};
