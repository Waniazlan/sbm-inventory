<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\Item;
use App\Models\PhoneModel;
use App\Models\Supplier;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class SalesCatalogueTest extends TestCase
{
    use RefreshDatabase;

    private string $token;

    private array $payload;

    protected function setUp(): void
    {
        parent::setUp();
        $this->token = str_repeat('s', 40);
        config(['sbm.sales_token' => $this->token]);
        $category = Category::create(['name' => 'POS parts']);
        $model = PhoneModel::create(['brand' => 'Apple', 'name' => 'iPhone 13']);
        $this->payload = ['actor_reference' => 'sales-user:7', 'name' => 'POS display',
            'category_id' => $category->id, 'price' => 2599, 'unit' => 'piece',
            'minimum_stock' => 2, 'serial_tracking' => true, 'phone_model_ids' => [$model->id], 'receipt' => ['quantity' => 2, 'unit_cost' => 1350, 'reference' => 'PO-TEST']];
    }

    private function authorize(string $key = 'sales-catalogue:7:test'): static
    {
        return $this->withToken($this->token)->withHeader('Idempotency-Key', $key);
    }

    public function test_metadata_and_creation_require_the_sales_integration_token(): void
    {
        $this->getJson('/api/v1/products/metadata')->assertUnauthorized();
        $this->postJson('/api/v1/products/with-stock', $this->payload)->assertUnauthorized();
        config(['sbm.repair_token' => str_repeat('r', 40)]);
        $this->withToken(str_repeat('r', 40))->getJson('/api/v1/products/metadata')->assertUnauthorized();
        $this->assertDatabaseCount('items', 0);
    }

    public function test_creation_reuses_catalogue_rules_generates_identifiers_and_replays_once(): void
    {
        $this->authorize()->getJson('/api/v1/products/metadata')->assertOk()
            ->assertJsonPath('categories.0.name', 'POS parts')->assertJsonPath('phone_models.0.brand', 'Apple');
        $response = $this->postJson('/api/v1/products/with-stock', $this->payload + ['stock' => 999, 'cost' => 999, 'sku' => 'CLIENT', 'active' => false])
            ->assertCreated()->assertJsonPath('data.stock', 2)->assertJsonPath('data.price', 2599)
            ->assertJsonPath('data.serial_tracking', true);
        $id = $response->json('data.id');
        $this->assertStringStartsWith('PRN-', $response->json('data.sku'));
        $this->assertNotEmpty($response->json('data.barcode'));
        $this->assertDatabaseHas('items', ['id' => $id, 'stock' => 2, 'cost' => 0, 'active' => true]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'item.created_from_sales', 'source' => 'sales']);
        $this->postJson('/api/v1/products/with-stock', $this->payload)->assertCreated()->assertExactJson($response->json());
        $this->postJson('/api/v1/products/with-stock', [...$this->payload, 'name' => 'Changed'])->assertConflict();
        $this->assertDatabaseCount('items', 1);
        $this->assertDatabaseCount('operations', 2);
        $this->assertDatabaseCount('movements', 1);
        $this->assertDatabaseCount('item_units', 2);
        $this->assertDatabaseHas('stock_batches', ['item_id' => $id, 'unit_cost' => 1350, 'remaining_quantity' => 2]);
        $this->assertDatabaseHas('movements', ['item_id' => $id, 'type' => 'receipt', 'actor_reference' => 'sales-user:7']);
        $this->getJson('/api/v1/products?search='.$response->json('data.sku'))->assertOk()->assertJsonPath('data.0.id', $id);
    }

    public function test_inventory_validates_category_model_price_and_duplicate_barcode(): void
    {
        $this->authorize()->postJson('/api/v1/products/with-stock', [...$this->payload, 'category_id' => 999999])->assertUnprocessable()->assertJsonValidationErrors('category_id');
        $this->postJson('/api/v1/products/with-stock', [...$this->payload, 'phone_model_ids' => [999999]])->assertUnprocessable()->assertJsonValidationErrors('phone_model_ids.0');
        $this->postJson('/api/v1/products/with-stock', [...$this->payload, 'price' => null])->assertUnprocessable()->assertJsonValidationErrors('price');
        $this->postJson('/api/v1/products/with-stock', [...$this->payload, 'barcode' => "BAD\nCODE"])->assertUnprocessable()->assertJsonValidationErrors('barcode');
        Item::create(['name' => 'Existing', 'barcode' => 'USED', 'category_id' => $this->payload['category_id']]);
        $this->postJson('/api/v1/products/with-stock', [...$this->payload, 'barcode' => 'USED'])->assertUnprocessable()->assertJsonValidationErrors('barcode');
        $this->assertDatabaseCount('operations', 0);
    }

    public function test_failed_validation_can_be_corrected_using_the_same_key(): void
    {
        $this->authorize()->postJson('/api/v1/products/with-stock', [...$this->payload, 'name' => ''])->assertUnprocessable();
        $this->postJson('/api/v1/products/with-stock', $this->payload)->assertCreated();
        $this->assertDatabaseCount('items', 1);
    }

    public function test_receipt_failure_rolls_back_the_item_stock_batches_audit_and_units(): void
    {
        $payload = $this->payload;
        $payload['receipt']['serials'] = 'ONLY-ONE';
        $this->authorize()->postJson('/api/v1/products/with-stock', $payload)->assertUnprocessable()
            ->assertJsonValidationErrors('receipt.serials');
        foreach (['items', 'item_units', 'stock_batches', 'movements', 'operations', 'audit_logs'] as $table) {
            $this->assertDatabaseCount($table, 0);
        }
        $this->postJson('/api/v1/products/with-stock', $this->payload)->assertCreated();
        $this->assertDatabaseCount('items', 1);
        $this->assertDatabaseCount('movements', 1);
    }

    public function test_receipt_is_required_and_validates_supplier_reference_quantity_and_cost(): void
    {
        $payload = $this->payload;
        unset($payload['receipt']);
        $this->authorize()->postJson('/api/v1/products/with-stock', $payload)->assertUnprocessable()->assertJsonValidationErrors('receipt');
        foreach ([['quantity' => 0], ['quantity' => 1001], ['unit_cost' => null], ['unit_cost' => -1],
            ['supplier_id' => 999999], ['reference' => null]] as $invalid) {
            $this->postJson('/api/v1/products/with-stock', [...$this->payload,
                'receipt' => [...$this->payload['receipt'], ...$invalid]])->assertUnprocessable();
        }
        $this->assertDatabaseCount('items', 0);
        $this->assertDatabaseCount('operations', 0);
    }

    public function test_suppliers_custom_serials_and_separate_receipts_keep_costs_and_sale_price(): void
    {
        $supplier = Supplier::create(['name' => 'POS supplier']);
        $this->authorize()->getJson('/api/v1/products/metadata')->assertOk()->assertJsonPath('suppliers.0.id', $supplier->id);
        $payload = [...$this->payload, 'receipt' => ['supplier_id' => $supplier->id, 'quantity' => 2,
            'unit_cost' => 1700, 'brand' => 'Parts brand', 'batch' => 'LOT-1', 'serials' => "SN-A\nSN-B"]];
        $first = $this->postJson('/api/v1/products/with-stock', $payload)->assertCreated()
            ->assertJsonPath('data.price', 2599)->assertJsonPath('receipt.acknowledged', true)->json('data.id');
        $this->assertDatabaseHas('item_units', ['item_id' => $first, 'serial_number' => 'SN-A', 'in_stock' => true]);
        $this->assertDatabaseHas('stock_batches', ['item_id' => $first, 'supplier_id' => $supplier->id, 'unit_cost' => 1700, 'batch' => 'LOT-1']);
        $this->assertDatabaseHas('movements', ['item_id' => $first, 'brand' => 'Parts brand']);
        // Two deliveries may legitimately reuse the same supplier invoice reference.
        $this->authorize('second-key')->postJson('/api/v1/products/with-stock', $this->payload)->assertCreated();
        $this->authorize('third-key')->postJson('/api/v1/products/with-stock', $this->payload)->assertCreated();
        $this->assertDatabaseCount('items', 3);
        $this->assertDatabaseCount('movements', 3);
        $this->assertSame(2599, Item::findOrFail($first)->price);
    }

    public function test_changed_receipt_on_a_saved_request_is_rejected_without_extra_stock(): void
    {
        $this->authorize()->postJson('/api/v1/products/with-stock', $this->payload)->assertCreated();
        $payload = $this->payload;
        $payload['receipt']['quantity'] = 3;
        $this->postJson('/api/v1/products/with-stock', $payload)->assertConflict();
        $this->assertDatabaseCount('items', 1);
        $this->assertDatabaseCount('item_units', 2);
        $this->assertSame(2, Item::sole()->stock);
    }
}
