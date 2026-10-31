<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\Item;
use App\Models\ItemUnit;
use App\Models\Operation;
use App\Models\Supplier;
use App\Models\User;
use App\Services\Ledger;
use App\Services\SupplierReturns;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class IntegrationUnitsTest extends TestCase
{
    use RefreshDatabase;

    private Item $item;

    private Supplier $supplier;

    private string $token;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actingAs(User::create(['name' => 'Serial Admin', 'email' => 'serial-admin@example.test', 'password' => 'test-password-123', 'role' => 'admin']));
        $this->token = str_repeat('s', 40);
        config(['sbm.sales_token' => $this->token]);
        $this->supplier = Supplier::create(['name' => 'Serial supplier']);
        $this->item = Item::create(['name' => 'Battery', 'category_id' => Category::create(['name' => 'Parts'])->id,
            'price' => 5000, 'serial_tracking' => true]);
    }

    private function receipt(string $serials): void
    {
        app(Ledger::class)->post(['request_key' => (string) Str::uuid(), 'kind' => 'receipt', 'supplier_id' => $this->supplier->id,
            'reason' => 'Units lookup fixture', 'items' => [['item_id' => $this->item->id, 'quantity' => count(explode("\n", $serials)),
                'serials' => $serials, 'unit_cost' => 1500, 'brand' => 'Test brand']]], 'inventory');
    }

    public function test_available_units_require_sales_credentials_and_do_not_expose_costs_or_change_stock(): void
    {
        $this->receipt("FREE\nFROZEN\nSOLD");
        app(SupplierReturns::class)->create(['request_key' => (string) Str::uuid(), 'item_id' => $this->item->id,
            'supplier_id' => $this->supplier->id, 'quantity' => 1, 'status' => 'process', 'reason' => 'Frozen unit fixture', 'serials' => 'FROZEN'], auth()->id());
        ItemUnit::where('serial_number', 'SOLD')->update(['in_stock' => false]);
        $path = '/api/v1/products/'.$this->item->id.'/units';
        $this->getJson($path)->assertUnauthorized();
        $operations = Operation::count();
        $response = $this->withToken($this->token)->getJson($path)->assertOk()->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.serial_number', 'FREE')->assertJsonPath('data.0.brand', 'Test brand');
        $this->assertSame(['id', 'serial_number', 'brand'], array_keys($response->json('data.0')));
        $this->assertSame($operations, Operation::count());
        $this->assertSame(3, $this->item->fresh()->stock);
    }

    public function test_serial_search_is_literal_paginated_and_scoped_to_a_sellable_product(): void
    {
        $serials = array_map(fn ($n) => 'SN-'.str_pad((string) $n, 3, '0', STR_PAD_LEFT), range(1, 52));
        $serials[] = 'LITERAL_%';
        $this->receipt(implode("\n", $serials));
        $path = '/api/v1/products/'.$this->item->id.'/units';
        $this->withToken($this->token)->getJson($path)->assertOk()->assertJsonCount(50, 'data')->assertJsonPath('total', 53);
        $this->getJson($path.'?page=2')->assertOk()->assertJsonCount(3, 'data');
        $this->getJson($path.'?search='.rawurlencode('LITERAL_%'))->assertOk()->assertJsonCount(1, 'data');
        $this->getJson($path.'?search=NO-MATCH')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson($path.'?page=0')->assertUnprocessable();
        $this->item->update(['active' => false]);
        $this->getJson($path)->assertNotFound();
    }
}
