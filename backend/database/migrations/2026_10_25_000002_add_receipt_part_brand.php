<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('movements', fn (Blueprint $t) => $t->string('brand', 100)->nullable());
    }

    public function down(): void
    {
        Schema::table('movements', fn (Blueprint $t) => $t->dropColumn('brand'));
    }
};
