<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sso_account_links', function (Blueprint $table): void {
            $table->id();
            $table->string('issuer', 512);
            $table->string('subject', 255);
            $table->unsignedBigInteger('application_id');
            $table->unsignedBigInteger('branch_id');
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('local_shop_id')->nullable();
            $table->timestamps();
            $table->unique(['issuer', 'subject', 'application_id'], 'sso_links_identity_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sso_account_links');
    }
};
