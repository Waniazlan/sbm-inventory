<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\Item;
use App\Models\ItemUnit;
use App\Models\Movement;
use App\Models\StockBatch;
use App\Models\Supplier;
use App\Models\User;
use App\Services\Ledger;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class SupplierStockEditTest extends TestCase
{
    use RefreshDatabase;

    private Item $item;

    private Supplier $a;

    private Supplier $b;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actingAs(User::create(['name' => 'Admin', 'email' => 'supplier-editor@example.test', 'password' => 'test-password-123', 'role' => 'admin']));
        $this->a = Supplier::create(['name' => 'Supplier A']);
        $this->b = Supplier::create(['name' => 'Supplier B']);
        $this->item = Item::create(['name' => 'OLED', 'category_id' => Category::create(['name' => 'LCD'])->id, 'cost' => 99999]);
    }

    private function receive(Supplier $supplier, int $quantity, int $cost, ?string $brand = 'Original', ?string $serials = null): int
    {
        return app(Ledger::class)->post(['request_key' => (string) Str::uuid(), 'kind' => 'receipt', 'reference' => (string) Str::uuid(), 'reason' => 'Received stock', 'supplier_id' => $supplier->id, 'brand' => $brand, 'unit_cost' => $cost, 'serials' => $serials, 'items' => [['item_id' => $this->item->id, 'quantity' => $quantity]]], 'inventory', auth()->id())['movements'][0]['id'];
    }

    private function payload(Supplier $supplier, ?string $brand = 'Original'): array
    {
        $detail = $this->getJson('/api/v1/items/'.$this->item->id)->assertOk()->json();
        $row = collect($detail['supplier_stock'])->firstWhere('supplier_id', $supplier->id);
        $entry = collect($row['brands'])->firstWhere('brand', $brand);

        return ['request_key' => (string) Str::uuid(), 'supplier_id' => $supplier->id, 'original_brand' => $brand, 'brand' => $brand, 'counted_quantity' => $entry['quantity'], 'edit_token' => $entry['edit_token'], 'reason' => 'Physical stock correction'];
    }

    private function edit(array $payload)
    {
        return $this->putJson('/api/v1/items/'.$this->item->id.'/supplier-stock', $payload);
    }

    public function test_brand_correction_is_audited_replayable_and_preserves_posted_history_and_costs(): void
    {
        $id = $this->receive($this->a, 3, 12000);
        $before = Movement::findOrFail($id)->toArray();
        $payload = array_replace($this->payload($this->a), ['brand' => 'Corrected']);
        $response = $this->edit($payload)->assertOk()->json();
        $this->edit($payload)->assertExactJson($response);
        $this->edit(array_replace($payload, ['brand' => 'Changed retry']))->assertConflict();
        $this->assertSame($before, Movement::findOrFail($id)->toArray());
        $this->assertSame(1, Movement::count());
        $this->assertDatabaseHas('stock_batches', ['brand_override' => 'Corrected', 'brand_corrected' => true, 'unit_cost' => 12000, 'remaining_quantity' => 3]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'supplier_stock.updated']);
        $this->getJson('/api/v1/items/'.$this->item->id)->assertJsonPath('supplier_stock.0.brands.0.brand', 'Corrected')->assertJsonPath('stock_value', 36000);
        $this->artisan('inventory:reconcile')->assertExitCode(0);
    }

    public function test_quantity_decrease_targets_the_selected_supplier_and_brand_only(): void
    {
        $this->receive($this->a, 10, 10000);
        $this->receive($this->b, 3, 12000);
        $this->receive($this->b, 4, 13000, 'Other brand');
        $this->edit(array_replace($this->payload($this->b), ['counted_quantity' => 1]))->assertOk();
        $this->assertSame(15, $this->item->fresh()->stock);
        $this->assertDatabaseHas('stock_batches', ['supplier_id' => $this->a->id, 'remaining_quantity' => 10]);
        $this->assertDatabaseHas('stock_batches', ['supplier_id' => $this->b->id, 'unit_cost' => 13000, 'remaining_quantity' => 4]);
        $movement = Movement::where('type', 'adjustment')->firstOrFail();
        $this->assertSame(-2, $movement->delta);
        $this->assertSame([$this->b->id], $movement->costAllocations()->with('batch')->get()->pluck('batch.supplier_id')->unique()->all());
        $this->artisan('inventory:reconcile')->assertExitCode(0);
    }

    public function test_increase_creates_new_stock_at_latest_group_cost_and_preserves_old_prices(): void
    {
        $this->receive($this->a, 2, 10000);
        $this->receive($this->a, 2, 12000);
        $this->edit(array_replace($this->payload($this->a), ['counted_quantity' => 6, 'brand' => 'Corrected']))->assertOk();
        $this->assertSame([10000, 12000, 12000], StockBatch::orderBy('id')->pluck('unit_cost')->all());
        $this->getJson('/api/v1/items/'.$this->item->id)->assertJsonPath('stock_value', 68000)
            ->assertJsonPath('supplier_stock.0.quantity', 6)->assertJsonPath('supplier_stock.0.brands.0.brand', 'Corrected');
        $this->artisan('inventory:reconcile')->assertExitCode(0);
    }

    public function test_stale_form_is_rejected_before_any_change_and_same_successful_retry_does_not_recount(): void
    {
        $this->receive($this->a, 3, 12000);
        $stale = $this->payload($this->a);
        $this->receive($this->a, 1, 12000);
        $this->edit(array_replace($stale, ['counted_quantity' => 2, 'brand' => 'Stale']))->assertConflict();
        $payload = array_replace($this->payload($this->a), ['counted_quantity' => 2]);
        $response = $this->edit($payload)->assertOk()->json();
        $this->edit($payload)->assertExactJson($response);
        $this->assertSame(2, $this->item->fresh()->stock);
        $this->assertSame(1, Movement::where('type', 'adjustment')->count());
    }

    public function test_serialized_loss_requires_missing_serials_from_this_group_and_added_units_get_matching_serial_cost(): void
    {
        $this->item->update(['serial_tracking' => true]);
        $this->receive($this->a, 1, 10000, 'Original', 'A-UNIT');
        $this->receive($this->b, 2, 12000, 'Original', "B-UNIT-1\nB-UNIT-2");
        $payload = array_replace($this->payload($this->b), ['counted_quantity' => 1, 'brand' => 'Corrected']);
        $this->edit($payload)->assertUnprocessable();
        $this->edit($payload + ['serials' => 'A-UNIT'])->assertUnprocessable();
        $this->assertSame(3, $this->item->fresh()->stock);
        $this->assertSame(0, StockBatch::where('brand_corrected', true)->count());
        $this->edit($payload + ['serials' => 'B-UNIT-2'])->assertOk();
        $this->assertDatabaseHas('item_units', ['serial_number' => 'B-UNIT-2', 'in_stock' => false]);
        $this->assertDatabaseHas('item_units', ['serial_number' => 'A-UNIT', 'in_stock' => true]);
        $this->edit(array_replace($this->payload($this->b, 'Corrected'), ['counted_quantity' => 2]))->assertOk();
        $serial = ItemUnit::orderByDesc('id')->firstOrFail()->serial_number;
        $this->assertStringEndsWith('-12000-'.$this->b->id, $serial);
        $this->artisan('inventory:reconcile')->assertExitCode(0);
    }

    public function test_brand_can_be_cleared_and_groups_with_same_brand_merge(): void
    {
        $this->receive($this->a, 1, 12000);
        $this->receive($this->a, 2, 13000, null);
        $this->edit(array_replace($this->payload($this->a), ['brand' => null]))->assertOk();
        $this->getJson('/api/v1/items/'.$this->item->id)->assertJsonCount(1, 'supplier_stock.0.brands')
            ->assertJsonPath('supplier_stock.0.brands.0.brand', null)->assertJsonPath('supplier_stock.0.brands.0.quantity', 3);
    }

    public function test_validation_and_technician_permissions_prevent_edits_and_cost_metadata_leaks(): void
    {
        $this->receive($this->a, 2, 12000);
        $payload = $this->payload($this->a);
        $this->edit(array_replace($payload, ['reason' => '']))->assertUnprocessable();
        $this->edit(array_replace($payload, ['counted_quantity' => -1]))->assertUnprocessable();
        $this->actingAs(User::create(['name' => 'Tech', 'email' => 'supplier-tech@example.test', 'password' => 'test-password-123', 'role' => 'technician']));
        $this->edit(array_replace($payload, ['brand' => 'Forbidden']))->assertForbidden();
        $this->getJson('/api/v1/items/'.$this->item->id)->assertOk()
            ->assertJsonMissingPath('supplier_stock.0.brands.0.latest_unit_cost')->assertJsonMissingPath('supplier_stock.0.brands.0.edit_token');
    }
}
