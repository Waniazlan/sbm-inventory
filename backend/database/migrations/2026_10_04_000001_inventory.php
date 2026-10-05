<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $t) {
            $t->string('role')->default('technician');
            $t->boolean('active')->default(true);
        });
        Schema::create('categories', function (Blueprint $t) {
            $t->id();
            $t->string('name')->unique();
            $t->timestamps();
        });
        Schema::create('phone_models', function (Blueprint $t) {
            $t->id();
            $t->string('brand');
            $t->string('name');
            $t->unique(['brand', 'name']);
            $t->timestamps();
        });
        Schema::create('suppliers', function (Blueprint $t) {
            $t->id();
            $t->string('name')->unique();
            $t->string('contact')->nullable();
            $t->timestamps();
        });
        Schema::create('items', function (Blueprint $t) {
            $t->id();
            $t->string('sku')->unique();
            $t->string('name');
            $t->foreignId('category_id')->constrained();
            $t->foreignId('supplier_id')->nullable()->constrained();
            $t->string('brand')->nullable();
            $t->string('part_number')->nullable();
            $t->string('colour')->nullable();
            $t->string('grade')->nullable();
            $t->string('capacity')->nullable();
            $t->string('unit')->default('piece');
            $t->bigInteger('cost')->default(0);
            $t->bigInteger('price')->nullable();
            $t->integer('minimum_stock')->default(0);
            $t->integer('stock')->default(0);
            $t->boolean('active')->default(true);
            $t->text('notes')->nullable();
            $t->timestamps();
        });
        Schema::create('item_phone_model', function (Blueprint $t) {
            $t->foreignId('item_id')->constrained()->cascadeOnDelete();
            $t->foreignId('phone_model_id')->constrained();
            $t->primary(['item_id', 'phone_model_id']);
        });
        Schema::create('repair_jobs', function (Blueprint $t) {
            $t->id();
            $t->string('reference')->unique();
            $t->foreignId('technician_id')->constrained('users');
            $t->boolean('active')->default(true);
            $t->timestamps();
        });
        Schema::create('operations', function (Blueprint $t) {
            $t->id();
            $t->string('source');
            $t->string('key');
            $t->string('fingerprint', 64);
            $t->string('kind');
            $t->string('reference')->nullable();
            $t->jsonb('response')->nullable();
            $t->timestamps();
            $t->unique(['source', 'key']);
            $t->unique(['source', 'kind', 'reference']);
        });
        Schema::create('movements', function (Blueprint $t) {
            $t->id();
            $t->foreignId('item_id')->constrained();
            $t->foreignId('operation_id')->constrained();
            $t->string('type');
            $t->integer('quantity');
            $t->integer('delta');
            $t->integer('balance_before');
            $t->integer('balance_after');
            $t->string('reason');
            $t->string('source');
            $t->string('reference')->nullable();
            $t->string('line_id')->nullable();
            $t->string('original_reference')->nullable()->index();
            $t->string('repair_job_reference')->nullable()->index();
            $t->foreignId('actor_id')->nullable()->constrained('users');
            $t->string('actor_reference')->nullable();
            $t->foreignId('supplier_id')->nullable()->constrained();
            $t->bigInteger('unit_cost')->nullable();
            $t->string('batch')->nullable();
            $t->text('serials')->nullable();
            $t->text('approval_note')->nullable();
            $t->foreignId('reverses_id')->nullable()->unique()->constrained('movements');
            $t->timestampTz('occurred_at');
            $t->timestampTz('created_at');
            $t->index(['item_id', 'occurred_at']);
            $t->index(['source', 'reference']);
            $t->index(['actor_id', 'occurred_at']);
        });
        Schema::create('audit_logs', function (Blueprint $t) {
            $t->id();
            $t->foreignId('actor_id')->nullable()->constrained('users');
            $t->string('source');
            $t->string('action');
            $t->string('target');
            $t->jsonb('details');
            $t->timestampTz('created_at');
        });
        DB::statement('ALTER TABLE items ADD CONSTRAINT stock_nonnegative CHECK (stock >= 0)');
        DB::statement('ALTER TABLE movements ADD CONSTRAINT valid_movement CHECK (quantity > 0 AND abs(delta) = quantity AND balance_before >= 0 AND balance_after >= 0 AND balance_after = balance_before + delta)');
        DB::unprepared("CREATE OR REPLACE FUNCTION inventory_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Posted inventory history is immutable; create a compensating entry'; END; $$; CREATE TRIGGER immutable_movements BEFORE UPDATE OR DELETE ON movements FOR EACH ROW EXECUTE FUNCTION inventory_immutable(); CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION inventory_immutable();");
    }

    public function down(): void
    {
        foreach (['audit_logs', 'movements', 'operations', 'repair_jobs', 'item_phone_model', 'items', 'suppliers', 'phone_models', 'categories'] as $t) {
            Schema::dropIfExists($t);
        } DB::unprepared('DROP FUNCTION IF EXISTS inventory_immutable()');
        Schema::table('users', fn (Blueprint $t) => $t->dropColumn(['role', 'active']));
    }
};
