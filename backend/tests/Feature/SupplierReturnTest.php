<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Category;
use App\Models\Item;
use App\Models\ItemUnit;
use App\Models\Movement;
use App\Models\StockBatch;
use App\Models\StockReservation;
use App\Models\Supplier;
use App\Models\User;
use App\Services\Ledger;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class SupplierReturnTest extends TestCase
{
    use RefreshDatabase;

    private Item $item;

    private Supplier $supplier;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actingAs(User::create(['name' => 'Return Admin', 'email' => 'returns@example.test', 'password' => 'test-password', 'role' => 'admin']));
        $this->supplier = Supplier::create(['name' => 'Return supplier']);
        $this->item = Item::create(['name' => 'Return screen', 'category_id' => Category::create(['name' => 'Screens'])->id, 'cost' => 99999]);
    }

    private function receive(int $quantity, int $cost = 1000, ?Supplier $supplier = null, ?string $serials = null): void
    {
        app(Ledger::class)->post([
            'request_key' => (string) Str::uuid(), 'kind' => 'receipt', 'reason' => 'Supplier delivery',
            'supplier_id' => ($supplier ?? $this->supplier)->id, 'unit_cost' => $cost,
            'items' => [['item_id' => $this->item->id, 'quantity' => $quantity, 'serials' => $serials]],
        ], 'inventory', auth()->id());
    }

    private function payload(array $changes = []): array
    {
        return array_replace([
            'request_key' => (string) Str::uuid(), 'item_id' => $this->item->id,
            'supplier_id' => $this->supplier->id, 'quantity' => 2, 'status' => 'process',
            'reason' => 'Faulty screen received',
        ], $changes);
    }

    private function change(int $id, string $from, string $to)
    {
        return $this->putJson('/api/v1/supplier-returns/'.$id, ['expected_status' => $from, 'status' => $to]);
    }

    private function lookup(string $barcode)
    {
        return $this->getJson('/api/v1/supplier-returns/lookup?'.http_build_query(['barcode' => $barcode]));
    }

    public function test_scan_lookup_resolves_the_exact_unit_item_and_receipt_supplier_without_changing_stock(): void
    {
        $other = Supplier::create(['name' => 'Serial supplier']);
        $this->item->update(['serial_tracking' => true, 'supplier_id' => $this->supplier->id, 'barcode' => 'SHARED-PRODUCT-CODE']);
        $this->receive(1, 1200, $other, '0012345678901234');
        $this->lookup('0012345678901234')->assertOk()
            ->assertJsonPath('item.id', $this->item->id)->assertJsonPath('supplier_id', $other->id)
            ->assertJsonPath('serial_number', '0012345678901234')
            ->assertJsonMissingPath('item.cost')->assertJsonMissingPath('unit_cost');
        $this->lookup('12345678901234')->assertNotFound();
        $this->lookup('SHARED-PRODUCT-CODE')->assertUnprocessable();
        $this->lookup("bad\nserial")->assertUnprocessable();
        $this->lookup(str_repeat('X', 501))->assertUnprocessable();
        $this->assertDatabaseCount('supplier_returns', 0);
        $this->assertDatabaseCount('movements', 1);
        $this->assertSame(1, $this->item->fresh()->stock);
        $this->item->update(['active' => false]);
        $this->lookup('0012345678901234')->assertUnprocessable();
        $this->item->update(['active' => true]);
        $this->item->delete();
        $this->lookup('0012345678901234')->assertUnprocessable();
    }

    public function test_scan_lookup_rejects_issued_or_unattributed_serials(): void
    {
        $this->item->update(['serial_tracking' => true]);
        $this->receive(1, 1000, null, 'AVAILABLE-SERIAL');
        $created = $this->postJson('/api/v1/supplier-returns', $this->payload(['quantity' => 1, 'serials' => 'AVAILABLE-SERIAL']))->assertCreated()->json();
        $this->lookup('AVAILABLE-SERIAL')->assertUnprocessable();
        $this->change($created['id'], 'process', 'rejected')->assertOk();
        $this->lookup('AVAILABLE-SERIAL')->assertUnprocessable();
        ItemUnit::create(['item_id' => $this->item->id, 'serial_number' => 'NO-SUPPLIER-SERIAL', 'in_stock' => true]);
        $this->lookup('NO-SUPPLIER-SERIAL')->assertUnprocessable();
    }

    public function test_untracked_item_scan_uses_product_barcode_and_does_not_guess_between_suppliers(): void
    {
        $this->item->update(['barcode' => 'PRODUCT-001']);
        $this->lookup('PRODUCT-001')->assertUnprocessable();
        $this->receive(1);
        $this->lookup('PRODUCT-001')->assertOk()->assertJsonPath('item.id', $this->item->id)
            ->assertJsonPath('supplier_id', $this->supplier->id)->assertJsonPath('serial_number', null);
        $this->receive(1, 1000, Supplier::create(['name' => 'Another supplier']));
        $this->lookup('PRODUCT-001')->assertOk()->assertJsonPath('supplier_id', null);
    }

    public function test_process_freezes_supplier_batches_without_deducting_and_delivered_deducts_once(): void
    {
        $other = Supplier::create(['name' => 'Older supplier']);
        $this->receive(3, 500, $other);
        $this->receive(1, 1000);
        $this->receive(3, 2000);
        $payload = $this->payload();
        $created = $this->postJson('/api/v1/supplier-returns', $payload)->assertCreated()->assertJsonPath('status', 'process')->json();
        $this->assertSame(7, $this->item->fresh()->stock);
        $this->assertNull($created['stock_movement_id']);
        $this->assertSame([3, 1, 3], StockBatch::orderBy('id')->pluck('remaining_quantity')->all());
        $this->assertSame([1, 1], StockReservation::active()->orderBy('id')->pluck('quantity')->all());
        $this->postJson('/api/v1/supplier-returns', $payload)->assertOk()->assertJsonPath('id', $created['id']);
        $this->assertSame(0, Movement::where('type', 'supplier_return')->count());
        $this->assertSame(2, StockReservation::active()->count());
        $this->change($created['id'], 'process', 'delivered')->assertOk()->assertJsonPath('status', 'delivered');
        $this->change($created['id'], 'process', 'delivered')->assertOk();
        $this->assertSame(5, $this->item->fresh()->stock);
        $this->assertSame([3, 0, 2], StockBatch::orderBy('id')->pluck('remaining_quantity')->all());
        $this->assertSame(1, Movement::where('type', 'supplier_return')->count());
        $this->assertSame(0, StockReservation::active()->count());
        $this->assertSame(2, AuditLog::where('action', 'like', 'supplier_return.%')->count());
        $this->artisan('inventory:reconcile')->assertExitCode(0);
    }

    public function test_rejected_deducts_and_changing_between_terminal_statuses_never_deducts_twice(): void
    {
        $this->receive(1, 1000);
        $this->receive(3, 2000);
        $created = $this->postJson('/api/v1/supplier-returns', $this->payload())->assertCreated()->json();
        $this->change($created['id'], 'process', 'rejected')->assertOk();
        $this->change($created['id'], 'process', 'rejected')->assertOk();
        $this->assertSame(2, $this->item->fresh()->stock);
        $this->assertSame([0, 2], StockBatch::orderBy('id')->pluck('remaining_quantity')->all());
        $this->assertSame([1000, 2000], Movement::where('type', 'supplier_return')->firstOrFail()->costAllocations->pluck('unit_cost')->all());
        $this->change($created['id'], 'rejected', 'delivered')->assertOk();
        $this->change($created['id'], 'delivered', 'rejected')->assertOk();
        $this->assertSame(2, $this->item->fresh()->stock);
        $this->assertSame(1, Movement::where('type', 'supplier_return')->count());
        $this->change($created['id'], 'rejected', 'process')->assertOk();
        $this->change($created['id'], 'rejected', 'process')->assertOk();
        $this->assertSame(4, $this->item->fresh()->stock);
        $this->assertSame(2, (int) StockReservation::active()->sum('quantity'));
        $this->change($created['id'], 'process', 'rejected')->assertOk();
        $this->assertSame(2, $this->item->fresh()->stock);
        $this->artisan('inventory:reconcile')->assertExitCode(0);
    }

    public function test_creating_either_terminal_status_deducts_immediately(): void
    {
        $this->receive(3);
        $created = $this->postJson('/api/v1/supplier-returns', $this->payload(['status' => 'rejected']))->assertCreated()->json();
        $this->assertSame(1, $this->item->fresh()->stock);
        $this->assertNotNull($created['stock_movement_id']);
        $this->change($created['id'], 'rejected', 'delivered')->assertOk();
        $this->assertSame(1, $this->item->fresh()->stock);
        $this->postJson('/api/v1/supplier-returns', $this->payload(['status' => 'delivered', 'quantity' => 1]))->assertCreated();
        $this->assertSame(0, $this->item->fresh()->stock);
    }

    public function test_insufficient_supplier_stock_rolls_back_return_and_ledger(): void
    {
        $this->receive(1);
        $this->receive(5, 1000, Supplier::create(['name' => 'Different supplier']));
        $this->postJson('/api/v1/supplier-returns', $this->payload())->assertUnprocessable();
        $this->assertDatabaseCount('supplier_returns', 0);
        $this->assertDatabaseCount('movements', 2);
        $this->assertSame(6, $this->item->fresh()->stock);
        $this->assertSame([1, 5], StockBatch::orderBy('id')->pluck('remaining_quantity')->all());
    }

    public function test_serials_stay_on_hand_but_frozen_in_process_and_are_deducted_on_rejection(): void
    {
        $this->item->update(['serial_tracking' => true]);
        $this->receive(2, 1000, null, "RETURN-A\nRETURN-B");
        $this->receive(1, 2000, Supplier::create(['name' => 'Other serial supplier']), 'OTHER-UNIT');
        foreach ([null, 'RETURN-A', "RETURN-A\nOTHER-UNIT", "RETURN-A\nRETURN-A"] as $serials) {
            $this->postJson('/api/v1/supplier-returns', $this->payload(['serials' => $serials]))->assertUnprocessable();
        }
        $this->assertDatabaseCount('supplier_returns', 0);
        $created = $this->postJson('/api/v1/supplier-returns', $this->payload(['serials' => "RETURN-A\nRETURN-B"]))->assertCreated()->json();
        $this->assertSame(3, ItemUnit::where('in_stock', true)->count());
        $this->assertSame(1, ItemUnit::available()->count());
        $this->change($created['id'], 'process', 'rejected')->assertOk();
        $this->assertSame(1, ItemUnit::where('in_stock', true)->count());
        $this->artisan('inventory:reconcile')->assertExitCode(0);
    }

    public function test_conflicting_replay_stale_update_and_direct_ledger_reversal_are_blocked(): void
    {
        $this->receive(4);
        $payload = $this->payload();
        $created = $this->postJson('/api/v1/supplier-returns', $payload)->assertCreated()->json();
        $this->postJson('/api/v1/supplier-returns', array_replace($payload, ['quantity' => 1]))->assertConflict();
        $movement = $this->change($created['id'], 'process', 'delivered')->assertOk()->json('stock_movement_id');
        $this->postJson('/api/v1/movements', ['request_key' => (string) Str::uuid(), 'kind' => 'reversal', 'movement_id' => $movement, 'reason' => 'Bypass return status'])->assertUnprocessable();
        $this->change($created['id'], 'process', 'rejected')->assertConflict();
        $this->putJson('/api/v1/supplier-returns/'.$created['id'], ['status' => 'rejected', 'expected_status' => 'delivered', 'quantity' => 3])->assertUnprocessable();
        $this->assertSame(2, $this->item->fresh()->stock);
    }

    public function test_reopening_a_rejected_serialized_return_restores_then_freezes_units(): void
    {
        $this->item->update(['serial_tracking' => true]);
        $this->receive(2, 1000, null, "RETURN-A\nRETURN-B");
        $this->postJson('/api/v1/supplier-returns', $this->payload(['status' => 'rejected']))->assertUnprocessable();
        $created = $this->postJson('/api/v1/supplier-returns', $this->payload(['status' => 'rejected', 'serials' => "RETURN-A\nRETURN-B"]))->assertCreated()->json();
        $this->assertSame(0, $this->item->fresh()->stock);
        $this->change($created['id'], 'rejected', 'process')->assertOk();
        $this->assertSame(2, $this->item->fresh()->stock);
        $this->assertSame(0, ItemUnit::available()->count());
        $this->change($created['id'], 'process', 'rejected')->assertOk();
        $this->assertSame(0, $this->item->fresh()->stock);
        $this->artisan('inventory:reconcile')->assertExitCode(0);
    }

    public function test_validation_permissions_filters_and_historical_items(): void
    {
        $this->receive(2);
        $created = $this->postJson('/api/v1/supplier-returns', $this->payload())->assertCreated()->json();
        foreach ([['status' => 'unknown'], ['quantity' => 0], ['supplier_id' => null], ['reason' => '']] as $changes) {
            $this->postJson('/api/v1/supplier-returns', $this->payload($changes))->assertUnprocessable();
        }
        $this->getJson('/api/v1/supplier-returns?status=process&search=Return%20screen&supplier_id='.$this->supplier->id)->assertOk()->assertJsonPath('total', 1)->assertJsonPath('data.0.creator.name', 'Return Admin')->assertJsonMissingPath('data.0.fingerprint');
        $this->getJson('/api/v1/supplier-returns?status=rejected')->assertOk()->assertJsonPath('total', 0);
        $this->getJson('/api/v1/supplier-returns?search=SR-'.str_pad((string) $created['id'], 6, '0', STR_PAD_LEFT))->assertOk()->assertJsonPath('total', 1);
        $this->item->delete();
        $this->getJson('/api/v1/supplier-returns')->assertOk()->assertJsonPath('data.0.item.name', 'Return screen');
        $this->actingAs(User::create(['name' => 'Tech', 'email' => 'return-tech@example.test', 'password' => 'test-password', 'role' => 'technician']));
        $this->getJson('/api/v1/supplier-returns')->assertForbidden();
        $this->lookup('ANY-SERIAL')->assertForbidden();
        $this->postJson('/api/v1/supplier-returns', $this->payload())->assertForbidden();
        $this->change($created['id'], 'process', 'delivered')->assertForbidden();
        auth('web')->logout();
        auth()->forgetGuards();
        $this->getJson('/api/v1/supplier-returns')->assertUnauthorized();
    }
}
