<?php

use App\Services\StockCosts;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Prevent a live intake/issue from racing with the historical replay.
        DB::statement('LOCK TABLE items, movements, item_units IN SHARE ROW EXCLUSIVE MODE');
        Schema::create('stock_batches', function (Blueprint $t) {
            $t->id();
            $t->foreignId('item_id')->constrained();
            $t->foreignId('receipt_movement_id')->nullable()->unique()->constrained('movements');
            $t->foreignId('supplier_id')->nullable()->constrained();
            $t->string('reference')->nullable();
            $t->string('batch')->nullable();
            $t->string('cost_source');
            $t->bigInteger('unit_cost');
            $t->integer('quantity');
            $t->integer('remaining_quantity');
            $t->timestampTz('received_at');
            $t->index(['item_id', 'id']);
        });
        Schema::create('cost_allocations', function (Blueprint $t) {
            $t->id();
            $t->foreignId('movement_id')->constrained();
            $t->foreignId('stock_batch_id')->constrained();
            $t->integer('quantity');
            $t->bigInteger('unit_cost');
            $t->foreignId('return_of_id')->nullable()->constrained('cost_allocations');
            $t->index(['stock_batch_id', 'movement_id']);
        });
        Schema::table('item_units', fn (Blueprint $t) => $t->foreignId('stock_batch_id')->nullable()->constrained());
        DB::statement('ALTER TABLE stock_batches ADD CONSTRAINT valid_batch CHECK (unit_cost >= 0 AND quantity > 0 AND remaining_quantity BETWEEN 0 AND quantity)');
        DB::statement('ALTER TABLE cost_allocations ADD CONSTRAINT valid_allocation CHECK (quantity <> 0 AND unit_cost >= 0)');

        // Do not rewrite immutable movements or guess that all old stock cost the latest price.
        app(StockCosts::class)->backfill();
        DB::unprepared('CREATE TRIGGER immutable_cost_allocations BEFORE UPDATE OR DELETE ON cost_allocations FOR EACH ROW EXECUTE FUNCTION inventory_immutable();');
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION inventory_batch_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP = 'DELETE' THEN
                    RAISE EXCEPTION 'Posted stock batches cannot be deleted; create a compensating entry';
                END IF;
                IF ROW(NEW.item_id, NEW.supplier_id, NEW.reference, NEW.batch, NEW.cost_source, NEW.unit_cost, NEW.quantity, NEW.received_at)
                    IS DISTINCT FROM ROW(OLD.item_id, OLD.supplier_id, OLD.reference, OLD.batch, OLD.cost_source, OLD.unit_cost, OLD.quantity, OLD.received_at)
                    OR (OLD.receipt_movement_id IS NOT NULL AND NEW.receipt_movement_id IS DISTINCT FROM OLD.receipt_movement_id) THEN
                    RAISE EXCEPTION 'Posted stock batch details are immutable; create a compensating entry';
                END IF;
                RETURN NEW;
            END; $$;
            CREATE TRIGGER immutable_batch_details BEFORE UPDATE OR DELETE ON stock_batches FOR EACH ROW EXECUTE FUNCTION inventory_batch_snapshot_immutable();
            SQL);
    }

    public function down(): void
    {
        Schema::table('item_units', fn (Blueprint $t) => $t->dropConstrainedForeignId('stock_batch_id'));
        Schema::dropIfExists('cost_allocations');
        Schema::dropIfExists('stock_batches');
        DB::statement('DROP FUNCTION IF EXISTS inventory_batch_snapshot_immutable()');
    }
};
