<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\Item;
use App\Models\Movement;
use App\Models\User;
use App\Services\Ledger;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class ReportOverviewTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['sbm.timezone' => 'Asia/Kuala_Lumpur']);
        $this->travelTo(CarbonImmutable::parse('2026-10-27 12:00:00', 'Asia/Kuala_Lumpur'));
        $this->actingAs(User::create(['name' => 'Reports admin', 'email' => 'reports@example.test', 'password' => 'test-password-123', 'role' => 'admin']));
    }

    private function item(string $name = 'LCD', string $category = 'Displays', int $minimum = 0): Item
    {
        return Item::create(['name' => $name, 'category_id' => Category::firstOrCreate(['name' => $category])->id, 'cost' => 99999, 'minimum_stock' => $minimum]);
    }

    private function move(Item $item, string $kind, int $quantity, array $extra = []): Movement
    {
        $result = app(Ledger::class)->post(array_replace([
            'request_key' => (string) Str::uuid(), 'kind' => $kind, 'reference' => (string) Str::uuid(), 'reason' => 'Report verification',
            'occurred_at' => '2026-10-26T05:00:00Z', 'unit_cost' => 1000,
            'items' => [['item_id' => $item->id, 'quantity' => $quantity]],
        ], $extra), 'inventory', auth()->id());

        return Movement::findOrFail($result['movements'][0]['id']);
    }

    public function test_summary_uses_shop_day_boundaries_and_batch_values_without_filtering_current_stock(): void
    {
        $item = $this->item(minimum: 20);
        $this->move($item, 'receipt', 5, ['occurred_at' => '2026-10-25T15:59:59Z', 'unit_cost' => 1000]);
        $this->move($item, 'receipt', 2, ['occurred_at' => '2026-10-25T16:00:00Z', 'unit_cost' => 2000]);
        $this->move($item, 'receipt', 3, ['occurred_at' => '2026-10-26T15:59:59Z', 'unit_cost' => 3000]);
        $this->move($item, 'receipt', 7, ['occurred_at' => '2026-10-26T16:00:00Z', 'unit_cost' => 4000]);
        $issue = $this->move($item, 'manual_out', 1, ['occurred_at' => '2026-10-26T10:00:00Z', 'reason' => 'Damaged screen']);
        $this->move($item, 'reversal', 1, ['movement_id' => $issue->id, 'occurred_at' => '2026-10-26T11:00:00Z']);
        $other = $this->item('Battery', 'Batteries');
        $this->move($other, 'receipt', 3, ['occurred_at' => '2026-10-25T10:00:00Z', 'unit_cost' => 5000]);
        $inactive = $this->item('Inactive part');
        $inactive->update(['active' => false]);
        $deleted = $this->item('Deleted part');
        $deleted->delete();
        $item->update(['cost' => 123456]);

        $this->getJson('/api/v1/reports/overview?from=2026-10-26&to=2026-10-26')->assertOk()
            ->assertJsonPath('stock', ['items' => 3, 'units' => 20, 'low_stock' => 1, 'value' => 61000])
            ->assertJsonPath('activity', ['movements' => 4, 'stock_in' => 6, 'stock_out' => 1])
            ->assertJsonPath('series', [['date' => '2026-10-26', 'stock_in' => 6, 'stock_out' => 1]])
            ->assertJsonPath('categories', [['name' => 'Displays', 'units' => 17, 'value' => 46000], ['name' => 'Batteries', 'units' => 3, 'value' => 15000]])
            ->assertJsonPath('reasons.0.reason', 'Damaged screen')->assertJsonPath('reasons.0.quantity', 1);
        $this->artisan('inventory:reconcile')->assertExitCode(0);
    }

    public function test_chart_totals_cover_all_movements_and_csv_is_not_limited_to_the_visible_page(): void
    {
        $item = $this->item();
        for ($index = 0; $index < 31; $index++) {
            $this->move($item, 'receipt', 1, ['unit_cost' => 100]);
        }
        $this->move($item, 'manual_out', 5, ['reason' => 'Counter usage']);
        $this->getJson('/api/v1/reports/overview?from=2026-10-26&to=2026-10-26')->assertOk()
            ->assertJsonPath('activity', ['movements' => 32, 'stock_in' => 31, 'stock_out' => 5])
            ->assertJsonPath('stock.units', 26)->assertJsonPath('stock.value', 2600)
            ->assertJsonPath('series.0.stock_in', 31)->assertJsonPath('series.0.stock_out', 5);
        $this->getJson('/api/v1/reports?kind=movements&per_page=5')->assertOk()->assertJsonCount(5, 'data')->assertJsonPath('total', 32);
        $this->getJson('/api/v1/reports?kind=movements&per_page=5&page=2')->assertOk()->assertJsonCount(5, 'data')->assertJsonPath('current_page', 2);
        $this->getJson('/api/v1/reports?kind=movements&per_page=')->assertOk()->assertJsonCount(25, 'data');
        $csv = $this->get('/api/v1/reports?kind=movements&per_page=5&format=csv')->assertOk()->streamedContent();
        $this->assertCount(33, explode("\n", trim($csv)));
        $this->getJson('/api/v1/reports?kind=current&per_page=101')->assertUnprocessable();
    }

    public function test_empty_periods_are_zero_filled_and_long_periods_use_weeks_or_months(): void
    {
        $this->getJson('/api/v1/reports/overview')->assertOk()->assertJsonPath('from', '2026-09-28')->assertJsonPath('to', '2026-10-27')
            ->assertJsonPath('stock', ['items' => 0, 'units' => 0, 'low_stock' => 0, 'value' => 0])
            ->assertJsonPath('activity', ['movements' => 0, 'stock_in' => 0, 'stock_out' => 0])
            ->assertJsonCount(30, 'series')->assertJsonPath('series.0', ['date' => '2026-09-28', 'stock_in' => 0, 'stock_out' => 0]);
        $item = $this->item();
        $this->move($item, 'receipt', 2);
        foreach ([['2026-01-01', '2026-10-27', 'week'], ['2025-01-01', '2026-10-27', 'month']] as [$from, $to, $interval]) {
            $data = $this->getJson('/api/v1/reports/overview?from='.$from.'&to='.$to)->assertOk()->assertJsonPath('interval', $interval)->json();
            $this->assertSame(2, array_sum(array_column($data['series'], 'stock_in')));
            $this->assertLessThanOrEqual(53, count($data['series']));
        }
    }

    public function test_invalid_ranges_and_non_admins_cannot_access_summary_data(): void
    {
        $this->getJson('/api/v1/reports/overview?from=2026-10-27&to=2026-10-26')->assertUnprocessable();
        $this->getJson('/api/v1/reports/overview?from=not-a-date')->assertUnprocessable();
        $tech = User::create(['name' => 'Tech', 'email' => 'reports-tech@example.test', 'password' => 'test-password-123', 'role' => 'technician']);
        $this->actingAs($tech)->getJson('/api/v1/reports/overview')->assertForbidden();
        $tech->update(['role' => 'admin', 'active' => false]);
        $this->getJson('/api/v1/reports/overview')->assertForbidden();
    }
}
