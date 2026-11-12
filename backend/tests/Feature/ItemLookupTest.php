<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\Item;
use App\Models\Supplier;
use App\Models\User;
use App\Services\Ledger;
use App\Services\SupplierReturns;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class ItemLookupTest extends TestCase
{
    use RefreshDatabase;

    private Item $item;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actingAs(User::create(['name' => 'Admin', 'email' => 'lookup@example.test', 'password' => 'test-password', 'role' => 'admin', 'active' => true]));
        $this->item = Item::create(['name' => 'Screen', 'barcode' => 'PRODUCT-001', 'category_id' => Category::create(['name' => 'Screens'])->id,
            'serial_tracking' => true, 'cost' => 1234, 'price' => 2500]);
    }

    private function move(string $kind = 'receipt', string $source = 'inventory', array $extra = []): array
    {
        return app(Ledger::class)->post(array_replace([
            'request_key' => (string) Str::uuid(), 'kind' => $kind, 'reason' => 'Lookup test movement',
            'reference' => 'REFERENCE-'.$kind, 'items' => [['item_id' => $this->item->id, 'quantity' => 1, 'serials' => '0000123']],
        ], $extra), $source, auth()->id());
    }

    private function lookup(string $code = '0000123')
    {
        return $this->getJson('/api/v1/items/lookup?'.http_build_query(['barcode' => $code]));
    }

    public function test_exact_unit_lookup_preserves_leading_zeroes_and_does_not_change_stock(): void
    {
        $this->move();
        $this->lookup()->assertOk()->assertHeader('Cache-Control', 'no-store, private')
            ->assertJsonPath('match', 'unit')->assertJsonPath('unit.serial_number', '0000123')
            ->assertJsonPath('status', 'In stock')->assertJsonPath('item.available_stock', 1)
            ->assertJsonPath('movement.reference', 'REFERENCE-receipt');
        $this->lookup('123')->assertNotFound();
        $this->assertDatabaseCount('movements', 1);
        $this->assertSame(1, $this->item->fresh()->stock);
    }

    public function test_product_barcode_reports_aggregate_stock_without_claiming_a_unit_is_sold(): void
    {
        $this->lookup('PRODUCT-001')->assertOk()->assertJsonPath('match', 'product')
            ->assertJsonPath('status', 'Out of stock')->assertJsonPath('unit', null)->assertJsonPath('movement', null);
        $this->move();
        $this->lookup('PRODUCT-001')->assertOk()->assertJsonPath('status', 'In stock');
    }

    public function test_product_lookup_preserves_spaces_case_and_url_punctuation(): void
    {
        $code = ' 00AbC / +?& ';
        $this->item->update(['barcode' => $code]);
        $this->lookup($code)->assertOk()->assertJsonPath('item.barcode', $code);
        $this->lookup(trim($code))->assertNotFound();
        $this->lookup(strtolower($code))->assertNotFound();
    }

    public function test_sale_return_and_reversals_use_the_units_current_effective_movement(): void
    {
        $this->move();
        $sale = $this->move('sale', 'sales');
        $this->lookup()->assertOk()->assertJsonPath('status', 'Sold')->assertJsonPath('movement.reference', 'REFERENCE-sale');
        $return = $this->move('return', 'sales', ['original_reference' => 'REFERENCE-sale']);
        $this->lookup()->assertOk()->assertJsonPath('status', 'Returned to stock');
        $this->move('reversal', extra: ['movement_id' => $return['movements'][0]['id']]);
        $this->lookup()->assertOk()->assertJsonPath('status', 'Sold');
        $this->move('reversal', extra: ['movement_id' => $sale['movements'][0]['id']]);
        $this->lookup()->assertOk()->assertJsonPath('status', 'In stock');
    }

    public function test_manual_issue_and_repair_usage_are_distinguished_from_sales(): void
    {
        $this->move();
        $issue = $this->move('manual_out');
        $this->lookup()->assertOk()->assertJsonPath('status', 'Issued');
        $this->move('reversal', extra: ['movement_id' => $issue['movements'][0]['id']]);
        $this->move('repair_usage', 'repair', ['repair_job_reference' => 'REPAIR-22']);
        $this->lookup()->assertOk()->assertJsonPath('status', 'Used for repair')->assertJsonPath('movement.reference', 'REPAIR-22');
    }

    public function test_supplier_reservations_and_delivered_returns_have_distinct_statuses(): void
    {
        $supplier = Supplier::create(['name' => 'Supplier']);
        $this->move(extra: ['supplier_id' => $supplier->id]);
        $return = app(SupplierReturns::class)->create([
            'request_key' => (string) Str::uuid(), 'item_id' => $this->item->id, 'supplier_id' => $supplier->id,
            'quantity' => 1, 'status' => 'process', 'serials' => '0000123', 'reason' => 'Faulty screen',
        ], auth()->id());
        $this->lookup()->assertOk()->assertJsonPath('status', 'Pending supplier return')->assertJsonPath('item.available_stock', 0);
        $this->lookup('PRODUCT-001')->assertOk()->assertJsonPath('status', 'Stock unavailable');
        app(SupplierReturns::class)->update($return, ['expected_status' => 'process', 'status' => 'delivered'], auth()->id());
        $this->lookup()->assertOk()->assertJsonPath('status', 'Returned to supplier');
    }

    public function test_archived_sold_items_remain_identifiable(): void
    {
        $this->move();
        $this->move('sale', 'sales');
        $this->item->update(['active' => false]);
        $this->item->delete();
        $this->lookup()->assertOk()->assertJsonPath('status', 'Sold')->assertJsonPath('item.archived', true);
        $this->lookup('PRODUCT-001')->assertOk()->assertJsonPath('item.archived', true);
    }

    public function test_technicians_can_lookup_without_receiving_cost_or_internal_movement_data(): void
    {
        $this->move();
        $this->actingAs(User::create(['name' => 'Tech', 'email' => 'lookup-tech@example.test', 'password' => 'test-password', 'role' => 'technician', 'active' => true]));
        $this->lookup()->assertOk()->assertJsonMissingPath('item.cost')->assertJsonMissingPath('item.stock_value')
            ->assertJsonMissingPath('movement.unit_cost')->assertJsonMissingPath('movement.actor_reference');
    }

    public function test_lookup_rejects_unknown_invalid_and_unauthenticated_requests(): void
    {
        $this->lookup('UNKNOWN')->assertNotFound();
        $this->lookup('')->assertUnprocessable();
        $this->lookup("INVALID\nCODE")->assertUnprocessable();
        $this->lookup(str_repeat('x', 501))->assertUnprocessable();
        auth()->forgetGuards();
        $this->getJson('/api/v1/items/lookup?barcode=PRODUCT-001')->assertUnauthorized();
    }
}
