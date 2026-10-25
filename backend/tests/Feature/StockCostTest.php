<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\CostAllocation;
use App\Models\Item;
use App\Models\ItemUnit;
use App\Models\Movement;
use App\Models\StockBatch;
use App\Models\Supplier;
use App\Models\User;
use App\Services\Ledger;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

class StockCostTest extends TestCase
{
    use RefreshDatabase;

    private Item $item;

    private User $admin;

    private Supplier $supplier;

    protected function setUp(): void
    {
        parent::setUp();
        $this->admin = User::create(['name' => 'Cost admin', 'email' => 'cost@example.test', 'password' => 'test-password-123', 'role' => 'admin']);
        $this->actingAs($this->admin);
        $this->supplier = Supplier::create(['name' => 'Supplier A']);
        $this->item = Item::create(['name' => 'LCD iPhone 13 OLED', 'category_id' => Category::create(['name' => 'Displays'])->id, 'supplier_id' => $this->supplier->id, 'cost' => 12000, 'price' => 20000]);
    }

    private function record(string $kind, int $quantity, array $extra = [], string $source = 'inventory'): Movement
    {
        $result = app(Ledger::class)->post(array_replace(['request_key' => (string) Str::uuid(), 'kind' => $kind, 'reason' => 'Cost allocation test', 'reference' => (string) Str::uuid(), 'items' => [['item_id' => $this->item->id, 'quantity' => $quantity]]], $extra), $source, $source === 'inventory' ? $this->admin->id : null);

        return Movement::findOrFail($result['movements'][0]['id']);
    }

    private function value(): int
    {
        return (int) StockBatch::selectRaw('COALESCE(SUM(remaining_quantity::bigint * unit_cost), 0) as total')->value('total');
    }

    public function test_receipts_keep_suppliers_and_costs_without_changing_product_defaults(): void
    {
        $other = Supplier::create(['name' => 'Supplier B']);
        $this->record('receipt', 10, ['supplier_id' => $this->supplier->id, 'unit_cost' => 12000, 'batch' => 'LOT-A']);
        $this->record('receipt', 5, ['supplier_id' => $other->id, 'unit_cost' => 13500, 'batch' => 'LOT-B']);
        $this->assertSame(187500, $this->value());
        $this->assertSame(12000, $this->item->fresh()->cost);
        $this->assertSame(20000, $this->item->fresh()->price);
        $this->assertSame($this->supplier->id, $this->item->fresh()->supplier_id);
        $this->item->update(['cost' => 99999, 'supplier_id' => $other->id, 'minimum_stock' => 20]);
        $this->assertSame(187500, $this->value());
        $this->getJson('/api/v1/dashboard')->assertOk()->assertJsonPath('valuation', 187500)->assertJsonPath('low_items.0.stock_value', 187500);
        $this->getJson('/api/v1/items')->assertOk()->assertJsonPath('data.0.stock_value', 187500);
        $this->getJson('/api/v1/items/'.$this->item->id)->assertOk()->assertJsonPath('stock_value', 187500);
        $this->getJson('/api/v1/reports?kind=valuation')->assertOk()->assertJsonPath('data.0.Value (sen)', 187500);
        $csv = $this->get('/api/v1/reports?kind=valuation&format=csv')->assertOk();
        $this->assertStringContainsString('187500', $csv->streamedContent());
        $this->getJson('/api/v1/items/'.$this->item->id.'/batches')->assertOk()->assertJsonCount(2, 'data')->assertJsonPath('data.0.supplier.name', 'Supplier A')->assertJsonPath('data.1.unit_cost', 13500);
    }

    public function test_product_details_group_remaining_stock_by_actual_supplier_and_exclude_exhausted_stock(): void
    {
        $other = Supplier::create(['name' => 'Supplier B']);
        $this->record('receipt', 3, ['supplier_id' => $this->supplier->id, 'unit_cost' => 12000]);
        $this->record('receipt', 2, ['supplier_id' => $this->supplier->id, 'unit_cost' => 12500]);
        $receiptB = $this->record('receipt', 4, ['supplier_id' => $other->id, 'unit_cost' => 13500]);
        $this->record('receipt', 2, ['unit_cost' => 13000]);
        $this->record('manual_out', 4);
        $this->getJson('/api/v1/items/'.$this->item->id)->assertOk()
            ->assertJsonPath('stock', 7)
            ->assertJsonPath('supplier_stock', [
                ['supplier_id' => $this->supplier->id, 'supplier_name' => 'Supplier A', 'quantity' => 1],
                ['supplier_id' => $other->id, 'supplier_name' => 'Supplier B', 'quantity' => 4],
                ['supplier_id' => null, 'supplier_name' => null, 'quantity' => 2],
            ]);
        $this->record('manual_out', 1);
        $this->getJson('/api/v1/items/'.$this->item->id)->assertOk()
            ->assertJsonCount(2, 'supplier_stock')->assertJsonPath('supplier_stock.0.supplier_id', $other->id);
        $this->record('reversal', 4, ['movement_id' => $receiptB->id]);
        $this->getJson('/api/v1/items/'.$this->item->id)->assertOk()->assertJsonPath('stock', 2)
            ->assertJsonPath('supplier_stock', [['supplier_id' => null, 'supplier_name' => null, 'quantity' => 2]]);
    }

    public function test_product_details_with_no_stock_have_an_empty_supplier_breakdown(): void
    {
        $this->getJson('/api/v1/items/'.$this->item->id)->assertOk()->assertJsonPath('stock', 0)->assertJsonPath('supplier_stock', []);
    }

    public function test_fifo_spans_batches_and_records_exact_total_instead_of_rounding_a_unit_average(): void
    {
        $this->record('receipt', 2, ['unit_cost' => 100]);
        $this->record('receipt', 3, ['unit_cost' => 101]);
        $issue = $this->record('manual_out', 3, ['unit_cost' => 999999]);
        $this->assertNull($issue->unit_cost);
        $this->assertSame([-2, -1], $issue->costAllocations()->orderBy('id')->pluck('quantity')->all());
        $this->assertSame(202, $this->value());
        $this->getJson('/api/v1/movements?type=manual_out')->assertOk()->assertJsonPath('data.0.total_cost', 301);
        $this->getJson('/api/v1/items/'.$this->item->id.'/batches')->assertJsonCount(1, 'data');
        $this->getJson('/api/v1/items/'.$this->item->id.'/batches?state=all')->assertJsonCount(2, 'data');
        $this->artisan('inventory:reconcile')->assertExitCode(0);
    }

    public function test_blank_and_zero_receipt_costs_are_distinct(): void
    {
        $this->record('receipt', 2, ['unit_cost' => null]);
        $this->record('receipt', 1, ['unit_cost' => 0]);
        $this->assertSame([12000, 0], StockBatch::orderBy('id')->pluck('unit_cost')->all());
        $this->record('manual_out', 2);
        $issue = $this->record('manual_out', 1);
        $this->assertSame(0, $issue->unit_cost);
        $this->assertSame(0, $this->value());
    }

    public function test_backdating_new_receipts_does_not_change_fifo_posting_order(): void
    {
        $this->record('receipt', 1, ['unit_cost' => 12000]);
        $this->record('receipt', 1, ['unit_cost' => 13500, 'occurred_at' => now()->subYear()]);
        $this->assertSame(12000, $this->record('manual_out', 1)->unit_cost);
        $this->assertSame(13500, $this->value());
    }

    public function test_scanning_newer_serial_uses_its_actual_batch_and_return_restores_it(): void
    {
        $this->item->update(['serial_tracking' => true]);
        $this->record('receipt', 1, ['unit_cost' => 12000, 'serials' => 'OLD-SCREEN']);
        $this->record('receipt', 1, ['unit_cost' => 13500, 'serials' => 'NEW-SCREEN']);
        $sale = $this->record('sale', 1, ['reference' => 'SALE-SERIAL', 'serials' => 'NEW-SCREEN'], 'sales');
        $this->assertSame(13500, $sale->unit_cost);
        $this->assertSame(12000, $this->value());
        $this->item->update(['cost' => 99000]);
        $returned = $this->record('return', 1, ['original_reference' => 'SALE-SERIAL', 'serials' => 'NEW-SCREEN'], 'sales');
        $this->assertSame(13500, $returned->unit_cost);
        $this->assertSame(25500, $this->value());
        $this->record('reversal', 1, ['movement_id' => $returned->id]);
        $this->assertSame(12000, $this->value());
        $this->record('return', 1, ['original_reference' => 'SALE-SERIAL', 'serials' => 'NEW-SCREEN'], 'sales');
        $this->assertSame(25500, $this->value());
        $this->artisan('inventory:reconcile')->assertExitCode(0);
    }

    public function test_partial_returns_restore_original_sale_costs_and_return_reversal_releases_allowance(): void
    {
        $this->record('receipt', 2, ['unit_cost' => 12000]);
        $this->record('receipt', 2, ['unit_cost' => 13500]);
        $this->record('sale', 3, ['reference' => 'SALE-MIXED'], 'sales');
        $this->item->update(['cost' => 99999]);
        $first = $this->record('return', 1, ['original_reference' => 'SALE-MIXED'], 'sales');
        $this->assertSame(12000, $first->unit_cost);
        $second = $this->record('return', 2, ['original_reference' => 'SALE-MIXED'], 'sales');
        $this->assertNull($second->unit_cost);
        $this->assertSame(51000, $this->value());
        $this->record('reversal', 2, ['movement_id' => $second->id]);
        $this->assertSame(25500, $this->value());
        $this->record('return', 2, ['original_reference' => 'SALE-MIXED'], 'sales');
        $this->assertSame(51000, $this->value());
    }

    public function test_reversal_restores_exact_issue_batches_and_rejects_consumed_receipt(): void
    {
        $receipt = $this->record('receipt', 2, ['unit_cost' => 12000]);
        $this->record('receipt', 4, ['unit_cost' => 13500]);
        $issue = $this->record('manual_out', 3);
        try {
            $this->record('reversal', 2, ['movement_id' => $receipt->id]);
            $this->fail('A consumed receipt must not remove a different supplier’s stock.');
        } catch (ValidationException $e) {
            $this->assertStringContainsString('later stock movements', $e->getMessage());
        }
        $this->assertSame(40500, $this->value());
        $this->record('reversal', 3, ['movement_id' => $issue->id]);
        $this->assertSame(78000, $this->value());
        $this->record('reversal', 2, ['movement_id' => $receipt->id]);
        $this->assertSame(54000, $this->value());
    }

    public function test_counts_use_fifo_for_losses_and_a_new_snapshot_for_gains(): void
    {
        $this->record('receipt', 2, ['unit_cost' => 12000]);
        $this->record('receipt', 2, ['unit_cost' => 13500]);
        $this->record('adjustment', 1, ['counted_quantity' => 1]);
        $this->assertSame(13500, $this->value());
        $this->item->update(['cost' => 14000]);
        $this->record('adjustment', 1, ['counted_quantity' => 3]);
        $this->assertSame(41500, $this->value());
        $this->assertDatabaseHas('stock_batches', ['cost_source' => 'adjustment', 'quantity' => 2, 'unit_cost' => 14000]);
    }

    public function test_failed_multi_item_receipt_rolls_back_batches_and_allocations_and_retry_posts_once(): void
    {
        $payload = ['request_key' => (string) Str::uuid(), 'kind' => 'receipt', 'reference' => 'MULTI', 'items' => [['item_id' => $this->item->id, 'quantity' => 2, 'unit_cost' => 12000], ['item_id' => $this->item->id, 'quantity' => 3, 'unit_cost' => 13500]]];
        $this->item->update(['serial_tracking' => true]);
        $payload['items'][1]['serials'] = 'WRONG-COUNT';
        $this->postJson('/api/v1/movements', $payload)->assertUnprocessable();
        $this->assertSame(0, StockBatch::count());
        $this->assertSame(0, CostAllocation::count());
        $this->assertSame(0, ItemUnit::count());
        unset($payload['items'][1]['serials']);
        $response = $this->postJson('/api/v1/movements', $payload)->assertOk()->json();
        $this->postJson('/api/v1/movements', $payload)->assertExactJson($response);
        $this->assertSame(2, StockBatch::count());
        $this->assertSame(2, CostAllocation::count());
        $this->assertSame(5, ItemUnit::count());
    }

    public function test_technicians_cannot_read_batch_costs_or_total_stock_costs(): void
    {
        $this->record('receipt', 1);
        $this->actingAs(User::create(['name' => 'Tech', 'email' => 'cost-tech@example.test', 'role' => 'technician', 'password' => 'test-password-123']));
        $this->getJson('/api/v1/items/'.$this->item->id.'/batches')->assertForbidden();
        $this->getJson('/api/v1/items')->assertJsonMissingPath('data.0.cost')->assertJsonMissingPath('data.0.stock_value');
        $this->getJson('/api/v1/items/'.$this->item->id)->assertJsonMissingPath('cost')->assertJsonMissingPath('stock_value')
            ->assertJsonPath('supplier_stock', [['supplier_id' => null, 'supplier_name' => null, 'quantity' => 1]])
            ->assertJsonMissingPath('supplier_stock.0.unit_cost');
        $this->getJson('/api/v1/dashboard')->assertJsonPath('valuation', null);
    }

    public function test_cost_allocation_history_is_immutable(): void
    {
        $this->record('receipt', 1);
        $this->expectException(QueryException::class);
        DB::transaction(fn () => CostAllocation::query()->update(['unit_cost' => 1]));
    }

    public function test_batch_cost_and_supplier_snapshots_cannot_be_overwritten(): void
    {
        $this->record('receipt', 1);
        $this->expectException(QueryException::class);
        DB::transaction(fn () => StockBatch::query()->update(['unit_cost' => 1, 'supplier_id' => null]));
    }

    public function test_migration_replays_original_receipt_costs_fifo_returns_and_reversals(): void
    {
        $this->record('receipt', 2, ['unit_cost' => 12000]);
        $this->record('receipt', 3, ['unit_cost' => 13500]);
        $sale = $this->record('sale', 3, ['reference' => 'OLD-SALE'], 'sales');
        $returned = $this->record('return', 2, ['original_reference' => 'OLD-SALE'], 'sales');
        $this->record('reversal', 2, ['movement_id' => $returned->id]);
        $this->item->update(['cost' => 99000]);
        $history = Movement::orderBy('id')->get()->toArray();
        $migration = require database_path('migrations/2026_10_25_000001_create_stock_batches.php');
        $migration->down();
        $migration->up();
        $this->assertSame($history, Movement::orderBy('id')->get()->toArray());
        $this->assertSame(27000, $this->value());
        $this->assertSame([12000, 13500], StockBatch::orderBy('id')->pluck('unit_cost')->all());
        $this->assertSame(3, abs((int) $sale->costAllocations()->sum('quantity')));
        $this->artisan('inventory:reconcile')->assertExitCode(0);
    }

    public function test_migration_preserves_serial_batch_identity_and_labels_unrecorded_opening_cost(): void
    {
        $this->item->update(['serial_tracking' => true]);
        $this->record('receipt', 1, ['unit_cost' => 12000, 'serials' => 'MIGRATE-A']);
        $this->record('receipt', 1, ['unit_cost' => 13500, 'serials' => 'MIGRATE-B']);
        $this->record('sale', 1, ['serials' => 'MIGRATE-B', 'reference' => 'OLD-SERIAL'], 'sales');
        $this->record('return', 1, ['serials' => 'MIGRATE-B', 'original_reference' => 'OLD-SERIAL'], 'sales');
        $legacy = Item::create(['name' => 'Unrecorded opening stock', 'category_id' => $this->item->category_id, 'cost' => 500, 'stock' => 3]);
        $migration = require database_path('migrations/2026_10_25_000001_create_stock_batches.php');
        $migration->down();
        $migration->up();
        $this->assertSame(27000, $this->value());
        $this->assertDatabaseHas('stock_batches', ['item_id' => $legacy->id, 'quantity' => 3, 'unit_cost' => 500, 'cost_source' => 'opening_standard_cost']);
        $serial = ItemUnit::where('serial_number', 'MIGRATE-B')->firstOrFail();
        $this->assertSame(13500, StockBatch::findOrFail($serial->stock_batch_id)->unit_cost);
    }

    public function test_enabling_serials_distributes_existing_units_across_their_batches(): void
    {
        $this->record('receipt', 2, ['unit_cost' => 12000]);
        $this->record('receipt', 1, ['unit_cost' => 13500]);
        $this->putJson('/api/v1/items/'.$this->item->id, ['name' => $this->item->name, 'category_id' => $this->item->category_id, 'unit' => 'piece', 'cost' => 99000, 'price' => 20000, 'minimum_stock' => 0, 'active' => true, 'phone_model_ids' => [], 'serial_tracking' => true])->assertOk();
        $unit = ItemUnit::orderByDesc('id')->firstOrFail();
        $issue = $this->record('manual_out', 1, ['serials' => $unit->serial_number]);
        $this->assertSame(13500, $issue->unit_cost);
        $this->assertSame(24000, $this->value());
        $this->artisan('inventory:reconcile')->assertExitCode(0);
    }
}
