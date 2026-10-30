<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\Item;
use App\Models\ItemUnit;
use App\Models\Movement;
use App\Models\StockBatch;
use App\Models\StockReservation;
use App\Models\Supplier;
use App\Models\SupplierReturn;
use App\Models\User;
use App\Services\Ledger;
use App\Services\StockAvailability;
use App\Services\SupplierReturns;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

class StockReservationTest extends TestCase
{
    use RefreshDatabase;

    private Item $item;

    private Supplier $supplier;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actingAs(User::create(['name' => 'Reservation Admin', 'email' => 'frozen@example.test', 'password' => 'test-password', 'role' => 'admin']));
        $this->supplier = Supplier::create(['name' => 'Frozen supplier']);
        $this->item = Item::create(['name' => 'Reserved battery', 'category_id' => Category::create(['name' => 'Battery'])->id, 'price' => 3000]);
        config(['sbm.sales_token' => str_repeat('s', 40), 'sbm.repair_token' => str_repeat('r', 40)]);
    }

    private function movement(string $kind, int $quantity, array $extra = [], string $source = 'inventory'): array
    {
        return app(Ledger::class)->post(array_replace([
            'request_key' => (string) Str::uuid(), 'kind' => $kind, 'reference' => (string) Str::uuid(),
            'reason' => 'Reservation verification', 'supplier_id' => $this->supplier->id,
            'items' => [['item_id' => $this->item->id, 'quantity' => $quantity]],
        ], $extra), $source, auth()->id());
    }

    private function createReturn(array $extra = []): array
    {
        return $this->postJson('/api/v1/supplier-returns', array_replace([
            'request_key' => (string) Str::uuid(), 'item_id' => $this->item->id,
            'supplier_id' => $this->supplier->id, 'quantity' => 1, 'status' => 'process', 'reason' => 'Defective supplied part',
        ], $extra))->assertCreated()->json();
    }

    public function test_fifo_usage_skips_frozen_batches_and_final_status_deducts_original_reserved_costs(): void
    {
        $this->movement('receipt', 1, ['unit_cost' => 1000]);
        $this->movement('receipt', 3, ['unit_cost' => 2000]);
        $return = $this->createReturn(['quantity' => 2]);
        $this->assertSame(4, $this->item->fresh()->stock);
        $this->assertSame(2, StockAvailability::available($this->item->fresh()));
        $sale = $this->movement('sale', 1, [], 'sales');
        $this->assertSame(2000, Movement::findOrFail($sale['movements'][0]['id'])->unit_cost);
        $this->assertSame([1, 2], StockBatch::orderBy('id')->pluck('remaining_quantity')->all());
        $this->putJson('/api/v1/supplier-returns/'.$return['id'], ['expected_status' => 'process', 'status' => 'rejected'])->assertOk();
        $this->assertSame([0, 1], StockBatch::orderBy('id')->pluck('remaining_quantity')->all());
        $deduction = Movement::where('type', 'supplier_return')->firstOrFail();
        $this->assertSame([1000, 2000], $deduction->costAllocations->pluck('unit_cost')->all());
        $this->assertSame(1, $this->item->fresh()->stock);
        $this->assertSame(0, StockReservation::active()->count());
        $this->artisan('inventory:reconcile')->assertExitCode(0);
    }

    public function test_frozen_serial_cannot_be_sold_issued_used_in_repair_adjusted_or_reversed(): void
    {
        $this->item->update(['serial_tracking' => true]);
        $receipt = $this->movement('receipt', 2, ['serials' => "FROZEN-A\nFREE-B"]);
        $return = $this->createReturn(['serials' => 'FROZEN-A']);
        foreach ([['manual_out', 'inventory'], ['sale', 'sales'], ['repair_usage', 'repair'], ['adjustment', 'inventory']] as [$kind, $source]) {
            try {
                $this->movement($kind, 1, ['serials' => 'FROZEN-A', 'counted_quantity' => 1], $source);
                $this->fail('Frozen serial was consumed by '.$kind);
            } catch (ValidationException $exception) {
                $this->assertStringContainsString('frozen', strtolower($exception->getMessage()));
            }
        }
        try {
            $this->movement('reversal', 2, ['movement_id' => $receipt['movements'][0]['id']]);
            $this->fail('A receipt containing frozen units was reversed.');
        } catch (ValidationException $exception) {
            $this->assertStringContainsString('frozen', strtolower($exception->getMessage()));
        }
        $this->postJson('/api/v1/supplier-returns', [
            'request_key' => (string) Str::uuid(), 'item_id' => $this->item->id, 'supplier_id' => $this->supplier->id,
            'quantity' => 1, 'serials' => 'FROZEN-A', 'reason' => 'Duplicate unit return',
        ])->assertUnprocessable();
        $this->assertDatabaseCount('movements', 1);
        $this->assertSame(2, $this->item->fresh()->stock);
        $this->movement('sale', 1, ['serials' => 'FREE-B'], 'sales');
        $this->putJson('/api/v1/supplier-returns/'.$return['id'], ['expected_status' => 'process', 'status' => 'delivered'])->assertOk();
        $this->assertSame(0, $this->item->fresh()->stock);
        $this->assertSame(0, ItemUnit::where('in_stock', true)->count());
        $this->artisan('inventory:reconcile')->assertExitCode(0);
    }

    public function test_sales_validation_catalogue_and_available_serials_exclude_frozen_stock(): void
    {
        $this->item->update(['serial_tracking' => true]);
        $this->movement('receipt', 2, ['serials' => "FROZEN-A\nFREE-B"]);
        $this->createReturn(['serials' => 'FROZEN-A']);
        $this->getJson('/api/v1/items/'.$this->item->id)->assertOk()->assertJsonPath('stock', 2)->assertJsonPath('available_stock', 1)->assertJsonPath('frozen_stock', 1)
            ->assertJsonPath('supplier_stock.0.available_quantity', 1)->assertJsonPath('supplier_stock.0.frozen_quantity', 1);
        $this->getJson('/api/v1/items/'.$this->item->id.'/units?state=available')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.serial_number', 'FREE-B');
        $header = ['Authorization' => 'Bearer '.str_repeat('s', 40)];
        $this->withHeaders($header)->getJson('/api/v1/products/'.$this->item->id)->assertOk()->assertJsonPath('data.stock', 1)->assertJsonPath('data.on_hand_stock', 2)->assertJsonPath('data.frozen_stock', 1);
        foreach ([['quantity' => 1, 'serials' => 'FROZEN-A'], ['quantity' => 2]] as $row) {
            $this->withHeaders($header)->postJson('/api/v1/stock/validate', ['items' => [['inventory_item_id' => $this->item->id] + $row]])->assertUnprocessable();
        }
        $this->withHeaders($header)->postJson('/api/v1/stock/validate', ['items' => [['inventory_item_id' => $this->item->id, 'quantity' => 1, 'serials' => 'FREE-B']]])->assertOk();
    }

    public function test_untracked_adjustment_and_receipt_reversal_cannot_spend_reserved_quantities(): void
    {
        $receipt = $this->movement('receipt', 2);
        $this->createReturn();
        foreach ([['kind' => 'adjustment', 'counted_quantity' => 0, 'reference' => 'PHYSICAL-COUNT', 'item_id' => $this->item->id], ['kind' => 'reversal', 'movement_id' => $receipt['movements'][0]['id']]] as $payload) {
            $this->postJson('/api/v1/movements', $payload + ['request_key' => (string) Str::uuid(), 'reason' => 'Attempt frozen stock change'])->assertUnprocessable();
        }
        $this->assertSame(2, $this->item->fresh()->stock);
        $this->assertSame(1, StockAvailability::reserved($this->item));
        $this->artisan('inventory:reconcile')->assertExitCode(0);
    }

    public function test_sales_repair_and_supplier_correction_endpoints_cannot_consume_frozen_serials(): void
    {
        $this->item->update(['serial_tracking' => true]);
        $this->movement('receipt', 2, ['serials' => "FROZEN-A\nFREE-B"]);
        $this->createReturn(['serials' => 'FROZEN-A']);
        foreach ([['stock/out', 's'], ['repair/usage', 'r']] as [$path, $token]) {
            $this->withHeaders(['Authorization' => 'Bearer '.str_repeat($token, 40), 'Idempotency-Key' => (string) Str::uuid()])->postJson('/api/v1/'.$path, [
                'reference' => 'FROZEN-USE', 'actor_reference' => 'cashier', 'reason' => 'Attempt frozen use',
                'payment_status' => 'paid', 'finalized' => true, 'repair_job_reference' => 'REPAIR-1',
                'items' => [['inventory_item_id' => $this->item->id, 'quantity' => 1, 'serials' => 'FROZEN-A', 'line_id' => 'LINE-1']],
            ])->assertUnprocessable();
        }
        $brand = $this->getJson('/api/v1/items/'.$this->item->id)->assertOk()->json('supplier_stock.0.brands.0');
        $this->putJson('/api/v1/items/'.$this->item->id.'/supplier-stock', [
            'request_key' => (string) Str::uuid(), 'supplier_id' => $this->supplier->id,
            'original_brand' => null, 'brand' => null, 'edit_token' => $brand['edit_token'],
            'counted_quantity' => 1, 'serials' => 'FROZEN-A', 'reason' => 'Attempt frozen correction',
        ])->assertUnprocessable();
        $this->assertDatabaseCount('movements', 1);
        $this->assertSame(2, $this->item->fresh()->stock);
        $this->assertSame(1, StockReservation::active()->count());
    }

    public function test_failed_finalization_rolls_back_releasing_the_freeze(): void
    {
        $this->movement('receipt', 1);
        $return = $this->createReturn();
        $this->item->update(['active' => false]);
        $this->putJson('/api/v1/supplier-returns/'.$return['id'], ['expected_status' => 'process', 'status' => 'rejected'])->assertUnprocessable();
        $this->assertSame(1, $this->item->fresh()->stock);
        $this->assertSame(1, StockReservation::active()->count());
        $this->assertDatabaseHas('supplier_returns', ['id' => $return['id'], 'status' => 'process', 'stock_movement_id' => null]);
    }

    public function test_serial_tracking_cannot_change_the_identity_of_frozen_untracked_stock(): void
    {
        $this->movement('receipt', 2);
        $return = $this->createReturn();
        $payload = ['name' => $this->item->name, 'category_id' => $this->item->category_id,
            'unit' => 'piece', 'price' => 3000, 'minimum_stock' => 0, 'active' => true,
            'phone_model_ids' => [], 'serial_tracking' => true];
        $this->putJson('/api/v1/items/'.$this->item->id, $payload)->assertUnprocessable()->assertJsonValidationErrors('serial_tracking');
        $this->assertFalse($this->item->fresh()->serial_tracking);
        $this->assertDatabaseCount('item_units', 0);
        $this->assertSame(1, StockReservation::active()->count());
        $this->putJson('/api/v1/supplier-returns/'.$return['id'], ['expected_status' => 'process', 'status' => 'rejected'])->assertOk();
        $this->putJson('/api/v1/items/'.$this->item->id, $payload)->assertOk();
        $this->assertSame(1, ItemUnit::available()->count());
        $this->artisan('inventory:reconcile')->assertExitCode(0);
    }

    public function test_legacy_conversion_restores_then_freezes_process_and_deducts_old_rejected_rows(): void
    {
        $this->item->update(['serial_tracking' => true]);
        $this->movement('receipt', 4, ['serials' => "LEGACY-A\nLEGACY-B\nLEGACY-C\nLEGACY-D"]);
        $old = $this->movement('supplier_return', 1, ['serials' => 'LEGACY-A']);
        $base = ['item_id' => $this->item->id, 'supplier_id' => $this->supplier->id, 'quantity' => 1,
            'reason' => 'Legacy return', 'fingerprint' => str_repeat('a', 64), 'created_by' => auth()->id(), 'updated_by' => auth()->id()];
        $process = SupplierReturn::create($base + ['request_key' => (string) Str::uuid(), 'status' => 'process', 'serials' => 'LEGACY-A', 'stock_movement_id' => $old['movements'][0]['id']]);
        $rejected = SupplierReturn::create($base + ['request_key' => (string) Str::uuid(), 'status' => 'rejected', 'serials' => 'LEGACY-B']);
        app(SupplierReturns::class)->upgradeLegacy();
        $this->assertNull($process->fresh()->stock_movement_id);
        $this->assertNotNull($rejected->fresh()->stock_movement_id);
        $this->assertSame(3, $this->item->fresh()->stock);
        $this->assertSame(1, StockAvailability::reserved($this->item));
        $this->assertSame(2, StockAvailability::available($this->item->fresh()));
        $this->artisan('inventory:reconcile')->assertExitCode(0);
    }
}
