<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\Item;
use App\Models\Movement;
use App\Models\StockBatch;
use App\Models\StockReservation;
use App\Models\Supplier;
use App\Models\User;
use App\Services\Ledger;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class SupplierReturnReportTest extends TestCase
{
    use RefreshDatabase;

    private Item $item;

    private Supplier $supplier;

    protected function setUp(): void
    {
        parent::setUp();
        config(['sbm.timezone' => 'Asia/Kuala_Lumpur']);
        $this->travelTo(CarbonImmutable::parse('2026-10-30 12:00:00', 'Asia/Kuala_Lumpur'));
        $this->actingAs(User::create(['name' => 'Reports admin', 'email' => 'return-reports@example.test', 'password' => 'test-password', 'role' => 'admin']));
        $this->supplier = Supplier::create(['name' => 'Original supplier']);
        $this->item = Item::create(['name' => 'Return screen', 'category_id' => Category::create(['name' => 'Screens'])->id, 'cost' => 99999]);
    }

    private function receive(int $quantity, int $cost): void
    {
        app(Ledger::class)->post([
            'request_key' => (string) Str::uuid(), 'kind' => 'receipt', 'reason' => 'Supplier delivery',
            'supplier_id' => $this->supplier->id, 'unit_cost' => $cost,
            'items' => [['item_id' => $this->item->id, 'quantity' => $quantity]],
        ], 'inventory', auth()->id());
    }

    private function createReturn(int $quantity, string $status): array
    {
        return $this->postJson('/api/v1/supplier-returns', [
            'request_key' => (string) Str::uuid(), 'item_id' => $this->item->id,
            'supplier_id' => $this->supplier->id, 'quantity' => $quantity,
            'status' => $status, 'reason' => 'Faulty stock returned',
        ])->assertCreated()->json();
    }

    private function changeStatus(int $id, string $from, string $to): array
    {
        return $this->putJson('/api/v1/supplier-returns/'.$id, ['expected_status' => $from, 'status' => $to])->assertOk()->json();
    }

    public function test_empty_returns_have_zero_status_and_loss_totals(): void
    {
        $this->getJson('/api/v1/reports/overview')->assertOk()->assertJsonPath('supplier_returns', [
            'process' => ['returns' => 0, 'quantity' => 0],
            'delivered' => ['returns' => 0, 'quantity' => 0],
            'rejected' => ['returns' => 0, 'quantity' => 0],
            'loss' => ['quantity' => 0, 'value' => 0],
        ]);
        $this->getJson('/api/v1/reports?kind=supplier_returns')->assertOk()->assertJsonCount(0, 'data')->assertJsonPath('total', 0);
    }

    public function test_snapshot_counts_units_and_prices_only_rejected_returns_at_actual_mixed_batch_costs(): void
    {
        $this->receive(1, 1000);
        $this->receive(3, 2000);
        $this->receive(10, 3500);
        $firstRejected = $this->createReturn(2, 'rejected'); // 1,000 + 2,000.
        $secondRejected = $this->createReturn(3, 'rejected'); // 2,000 + 2,000 + 3,500.
        $this->createReturn(4, 'delivered');
        $this->createReturn(3, 'process');
        $this->item->update(['cost' => 123456]);
        $before = [
            $this->item->fresh()->stock, Movement::count(),
            StockBatch::orderBy('id')->pluck('remaining_quantity')->all(),
            StockReservation::active()->orderBy('id')->pluck('quantity')->all(),
        ];

        $this->getJson('/api/v1/reports/overview?from=2020-01-01&to=2020-01-01')->assertOk()
            ->assertJsonPath('supplier_returns', [
                'process' => ['returns' => 1, 'quantity' => 3],
                'delivered' => ['returns' => 1, 'quantity' => 4],
                'rejected' => ['returns' => 2, 'quantity' => 5],
                'loss' => ['quantity' => 5, 'value' => 10500],
            ])
            ->assertJsonPath('stock.units', 5)->assertJsonPath('stock.value', 17500)
            ->assertJsonPath('activity.movements', 0);
        $this->getJson('/api/v1/reports?kind=supplier_returns&from=2020-01-01&to=2020-01-01')->assertOk()
            ->assertJsonCount(4, 'data')
            ->assertJsonPath('data.0.Status', 'process')->assertJsonPath('data.0.Quantity', 3)
            ->assertJsonPath('data.0.Classification', 'Frozen')->assertJsonPath('data.0.Loss value (sen)', 0)
            ->assertJsonPath('data.1.Status', 'delivered')->assertJsonPath('data.1.Classification', 'Supplier return')
            ->assertJsonPath('data.1.Loss value (sen)', 0)
            ->assertJsonPath('data.2.Return', 'SR-'.str_pad((string) $secondRejected['id'], 6, '0', STR_PAD_LEFT))
            ->assertJsonPath('data.2.Classification', 'Loss')->assertJsonPath('data.2.Loss value (sen)', 7500)
            ->assertJsonPath('data.3.Return', 'SR-'.str_pad((string) $firstRejected['id'], 6, '0', STR_PAD_LEFT))
            ->assertJsonPath('data.3.Loss value (sen)', 3000)
            ->assertJsonPath('data.0.Created at', '2026-10-30 12:00:00+08:00');
        $this->assertSame($before, [
            $this->item->fresh()->stock, Movement::count(),
            StockBatch::orderBy('id')->pluck('remaining_quantity')->all(),
            StockReservation::active()->orderBy('id')->pluck('quantity')->all(),
        ]);
    }

    public function test_current_status_switches_and_reopening_do_not_count_old_deductions_twice(): void
    {
        $this->receive(1, 1000);
        $this->receive(4, 2000);
        $return = $this->createReturn(2, 'rejected');
        $oldMovement = $return['stock_movement_id'];
        $this->getJson('/api/v1/reports/overview')->assertOk()->assertJsonPath('supplier_returns.loss', ['quantity' => 2, 'value' => 3000]);

        $delivered = $this->changeStatus($return['id'], 'rejected', 'delivered');
        $this->assertSame($oldMovement, $delivered['stock_movement_id']);
        $this->getJson('/api/v1/reports/overview')->assertOk()
            ->assertJsonPath('supplier_returns.delivered', ['returns' => 1, 'quantity' => 2])
            ->assertJsonPath('supplier_returns.loss', ['quantity' => 0, 'value' => 0]);
        $this->changeStatus($return['id'], 'delivered', 'rejected');
        $this->getJson('/api/v1/reports/overview')->assertOk()->assertJsonPath('supplier_returns.loss', ['quantity' => 2, 'value' => 3000]);

        $process = $this->changeStatus($return['id'], 'rejected', 'process');
        $this->assertNull($process['stock_movement_id']);
        $this->getJson('/api/v1/reports/overview')->assertOk()
            ->assertJsonPath('supplier_returns.process', ['returns' => 1, 'quantity' => 2])
            ->assertJsonPath('supplier_returns.loss', ['quantity' => 0, 'value' => 0]);
        $rejected = $this->changeStatus($return['id'], 'process', 'rejected');
        $this->assertNotSame($oldMovement, $rejected['stock_movement_id']);
        $this->getJson('/api/v1/reports/overview')->assertOk()->assertJsonPath('supplier_returns.loss', ['quantity' => 2, 'value' => 3000]);
        $this->getJson('/api/v1/reports?kind=supplier_returns')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.Loss value (sen)', 3000);
        $this->assertSame(3, $this->item->fresh()->stock);
        $this->assertSame(2, Movement::where('type', 'supplier_return')->count());
        $this->assertSame(1, Movement::whereNotNull('reverses_id')->count());
    }

    public function test_current_returns_paginate_and_export_every_row_with_safe_csv_values(): void
    {
        $this->item->update(['name' => '@Return, "screen"']);
        $this->supplier->update(['name' => '=-Supplier "Ltd", Inc']);
        $this->receive(62, 1234);
        for ($index = 0; $index < 31; $index++) {
            $this->createReturn(2, $index === 30 ? 'rejected' : 'process');
        }
        $this->getJson('/api/v1/reports?kind=supplier_returns&from=2020-01-01&to=2020-01-01')->assertOk()
            ->assertJsonCount(25, 'data')->assertJsonPath('total', 31);
        $this->getJson('/api/v1/reports?kind=supplier_returns&page=2')->assertOk()
            ->assertJsonCount(6, 'data')->assertJsonPath('current_page', 2);
        $this->getJson('/api/v1/reports?kind=supplier_returns&per_page=5')->assertOk()->assertJsonCount(5, 'data');
        $this->getJson('/api/v1/reports?kind=supplier_returns&per_page=101')->assertUnprocessable();
        $csv = $this->get('/api/v1/reports?kind=supplier_returns&per_page=5&from=2020-01-01&to=2020-01-01&format=csv')
            ->assertOk()->assertDownload('inventory-supplier_returns.csv')->streamedContent();
        $rows = array_map(fn ($line) => str_getcsv($line, ',', '"', ''), explode("\n", trim($csv)));
        $this->assertCount(32, $rows);
        $this->assertSame(['Return', 'SKU', 'Name', 'Supplier', 'Status', 'Quantity', 'Classification', 'Loss value (sen)', 'Created at'], $rows[0]);
        $this->assertSame("'".$this->item->name, $rows[1][2]);
        $this->assertSame("'".$this->supplier->name, $rows[1][3]);
        $this->assertSame('rejected', $rows[1][4]);
        $this->assertSame('2468', $rows[1][7]);
        $this->assertSame('0', $rows[31][7]);
    }

    public function test_deleted_items_remain_in_supplier_return_history(): void
    {
        $this->receive(2, 1750);
        $this->createReturn(2, 'rejected');
        $this->item->delete();
        $this->getJson('/api/v1/reports?kind=supplier_returns')->assertOk()
            ->assertJsonPath('data.0.SKU', $this->item->sku)->assertJsonPath('data.0.Name', $this->item->name)
            ->assertJsonPath('data.0.Loss value (sen)', 3500);
        $this->getJson('/api/v1/reports/overview')->assertOk()->assertJsonPath('supplier_returns.loss', ['quantity' => 2, 'value' => 3500]);
    }

    public function test_return_reports_and_exports_require_an_active_administrator(): void
    {
        $tech = User::create(['name' => 'Technician', 'email' => 'return-reports-tech@example.test', 'password' => 'test-password', 'role' => 'technician']);
        $this->actingAs($tech);
        foreach (['/api/v1/reports/overview', '/api/v1/reports?kind=supplier_returns', '/api/v1/reports?kind=supplier_returns&format=csv'] as $url) {
            $this->getJson($url)->assertForbidden();
        }
        $tech->update(['role' => 'admin', 'active' => false]);
        $this->getJson('/api/v1/reports?kind=supplier_returns')->assertForbidden();
        $this->getJson('/api/v1/reports/overview')->assertForbidden();
    }
}
