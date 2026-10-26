<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\Item;
use App\Models\ItemUnit;
use App\Models\Movement;
use App\Models\StockBatch;
use App\Models\Supplier;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class UnitSerialTest extends TestCase
{
    use RefreshDatabase;

    private Item $item;

    private array $product;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actingAs(User::create(['name' => 'Admin', 'email' => 'units@example.test', 'password' => 'test-password-123', 'role' => 'admin']));
        $this->product = ['name' => 'iPhone LCD', 'category_id' => Category::create(['name' => 'LCD'])->id, 'unit' => 'piece', 'cost' => 1000, 'price' => 2000, 'minimum_stock' => 0, 'active' => true, 'phone_model_ids' => [], 'serial_tracking' => true];
        $id = $this->postJson('/api/v1/items', $this->product)->assertCreated()->json('id');
        $this->item = Item::findOrFail($id);
    }

    private function move(array $extra = [])
    {
        return $this->postJson('/api/v1/movements', array_replace(['request_key' => (string) Str::uuid(), 'kind' => 'receipt', 'item_id' => $this->item->id, 'quantity' => 2, 'reason' => 'Unit test receipt', 'reference' => 'DELIVERY-1'], $extra));
    }

    public function test_product_barcode_and_unit_serials_are_separate_generated_unique_and_searchable(): void
    {
        $this->assertMatchesRegularExpression('/^SBM-P-\d{8,}$/', $this->item->barcode);
        $payload = ['request_key' => (string) Str::uuid()];
        $response = $this->move($payload)->assertOk()->json();
        $this->move($payload)->assertExactJson($response);
        $this->assertSame(2, ItemUnit::count());
        $serials = ItemUnit::pluck('serial_number');
        $this->assertCount(2, $serials->unique());
        $this->assertNotEquals($this->item->barcode, $serials[0]);
        $this->getJson('/api/v1/items/'.$this->item->id.'/units')->assertOk()->assertJsonCount(2, 'data');
        $this->getJson('/api/v1/items?barcode='.$serials[0])->assertOk()->assertJsonPath('data.0.id', $this->item->id);
        $this->getJson('/api/v1/items?search='.$serials[0])->assertOk()->assertJsonCount(1, 'data');
        $this->assertDatabaseHas('movements', ['serials' => $response['movements'][0]['serials']]);
    }

    public function test_generated_serials_use_each_receipt_line_cost_and_actual_supplier_and_retry_keeps_them(): void
    {
        DB::select("SELECT setval('inventory_unit_serial_seq', 1, false)");
        $supplier = Supplier::create(['name' => 'Actual intake supplier']);
        $payload = ['request_key' => (string) Str::uuid(), 'kind' => 'receipt', 'supplier_id' => $supplier->id, 'items' => [
            ['item_id' => $this->item->id, 'quantity' => 2, 'unit_cost' => 12050],
            ['item_id' => $this->item->id, 'quantity' => 1, 'unit_cost' => 13500],
        ]];
        $response = $this->postJson('/api/v1/movements', $payload)->assertOk()->json();
        $this->assertSame("SN-0000000001-12050-{$supplier->id}\nSN-0000000002-12050-{$supplier->id}", $response['movements'][0]['serials']);
        $this->assertSame("SN-0000000003-13500-{$supplier->id}", $response['movements'][1]['serials']);
        $this->item->update(['cost' => 99999]);
        $this->postJson('/api/v1/movements', $payload)->assertExactJson($response);
        $this->assertSame(3, ItemUnit::count());
        $batch = StockBatch::where('receipt_movement_id', $response['movements'][0]['id'])->firstOrFail();
        $this->assertDatabaseHas('item_units', ['serial_number' => "SN-0000000001-12050-{$supplier->id}", 'stock_batch_id' => $batch->id]);
        $this->getJson('/api/v1/items?barcode=SN-0000000001-12050-'.$supplier->id)->assertOk()->assertJsonPath('data.0.id', $this->item->id);
    }

    public function test_serial_labels_use_each_batch_brand_including_corrections_and_blank_brands(): void
    {
        $this->item->update(['brand' => 'Legacy product brand']);
        foreach (['Original', 'Compatible', null] as $index => $brand) {
            $this->move(['quantity' => 1, 'brand' => $brand, 'serials' => 'LABEL-'.$index])->assertOk();
        }
        $labels = fn () => collect($this->getJson('/api/v1/items/'.$this->item->id.'/units')->assertOk()->json('data'))->keyBy('serial_number');
        $this->assertSame('Original', $labels()['LABEL-0']['brand']);
        $this->assertSame('Compatible', $labels()['LABEL-1']['brand']);
        $this->assertNull($labels()['LABEL-2']['brand']);
        $batch = StockBatch::findOrFail(ItemUnit::where('serial_number', 'LABEL-0')->value('stock_batch_id'));
        $batch->update(['brand_corrected' => true, 'brand_override' => 'Corrected brand']);
        $this->assertSame('Corrected brand', $labels()['LABEL-0']['brand']);
        $batch->update(['brand_override' => null]);
        $this->assertNull($labels()['LABEL-0']['brand']);
    }

    public function test_generated_serials_support_zero_cost_missing_supplier_and_skip_identifier_collisions(): void
    {
        DB::select("SELECT setval('inventory_unit_serial_seq', 1, false)");
        $this->item->update(['barcode' => 'SN-0000000001-0-0']);
        $this->move(['quantity' => 1, 'unit_cost' => 0])->assertOk()->assertJsonPath('movements.0.serials', 'SN-0000000002-0-0');
        $this->move(['quantity' => 1, 'unit_cost' => 13500, 'serials' => 'SN-0000000421'])->assertOk()->assertJsonPath('movements.0.serials', 'SN-0000000421');
        $this->move(['quantity' => 1, 'unit_cost' => 12050])->assertOk()->assertJsonPath('movements.0.serials', 'SN-0000000003-12050-0');
        $this->assertDatabaseHas('item_units', ['serial_number' => 'SN-0000000421']);
    }

    public function test_enabling_tracking_encodes_the_remaining_batch_costs_and_suppliers(): void
    {
        DB::select("SELECT setval('inventory_unit_serial_seq', 1, false)");
        $supplierA = Supplier::create(['name' => 'Supplier A']);
        $supplierB = Supplier::create(['name' => 'Supplier B']);
        $legacy = Item::create(['name' => 'Previously untracked LCD', 'category_id' => $this->product['category_id']]);
        $this->move(['item_id' => $legacy->id, 'quantity' => 2, 'unit_cost' => 12050, 'supplier_id' => $supplierA->id])->assertOk();
        $this->move(['item_id' => $legacy->id, 'quantity' => 1, 'unit_cost' => 13500, 'supplier_id' => $supplierB->id])->assertOk();
        $this->putJson('/api/v1/items/'.$legacy->id, array_replace($this->product, ['cost' => 99999]))->assertOk();
        $this->assertSame([
            "SN-0000000001-12050-{$supplierA->id}",
            "SN-0000000002-12050-{$supplierA->id}",
            "SN-0000000003-13500-{$supplierB->id}",
        ], ItemUnit::where('item_id', $legacy->id)->orderBy('id')->pluck('serial_number')->all());
        $this->artisan('inventory:reconcile')->assertExitCode(0);
    }

    public function test_own_serials_are_preserved_and_wrong_counts_duplicates_and_unknown_serials_roll_back(): void
    {
        $this->move(['serials' => "LCD-0001\n00AbC-2"])->assertOk();
        $this->move(['serials' => "LCD-0001\nLCD-0003"])->assertUnprocessable();
        $this->move(['serials' => 'ONE-ONLY'])->assertUnprocessable();
        $this->move(['serials' => "DUP\nDUP"])->assertUnprocessable();
        $this->move(['serials' => "BAD\tSERIAL\nGOOD"])->assertUnprocessable();
        $this->move(['kind' => 'manual_out', 'quantity' => 1])->assertUnprocessable();
        $this->move(['kind' => 'manual_out', 'quantity' => 1, 'serials' => 'UNKNOWN'])->assertUnprocessable();
        $this->assertSame(2, $this->item->fresh()->stock);
        $this->assertSame(1, Movement::count());
    }

    public function test_issue_and_reversal_update_the_exact_unit_and_allow_receipt_reversal_after_issue_is_reversed(): void
    {
        $receipt = $this->move(['serials' => "LCD-1\nLCD-2"])->assertOk()->json('movements.0.id');
        $issue = $this->move(['kind' => 'manual_out', 'quantity' => 1, 'serials' => 'LCD-1'])->assertOk()->json('movements.0.id');
        $this->assertDatabaseHas('item_units', ['serial_number' => 'LCD-1', 'in_stock' => false]);
        $this->assertDatabaseHas('item_units', ['serial_number' => 'LCD-2', 'in_stock' => true]);
        $this->move(['kind' => 'reversal', 'movement_id' => $receipt])->assertUnprocessable();
        $this->move(['kind' => 'reversal', 'movement_id' => $issue])->assertOk();
        $this->assertDatabaseHas('item_units', ['serial_number' => 'LCD-1', 'in_stock' => true]);
        $this->move(['kind' => 'reversal', 'movement_id' => $receipt])->assertOk();
        $this->assertSame(0, $this->item->fresh()->stock);
        $this->assertSame(0, ItemUnit::where('in_stock', true)->count());
    }

    public function test_serials_cannot_be_reused_on_another_product_or_issued_twice(): void
    {
        $this->move(['serials' => "LCD-1\nLCD-2"])->assertOk();
        $other = $this->postJson('/api/v1/items', $this->product)->assertCreated()->json('id');
        $this->move(['item_id' => $other, 'quantity' => 1, 'serials' => 'LCD-1'])->assertUnprocessable();
        $this->move(['quantity' => 1, 'serials' => $this->item->barcode])->assertUnprocessable();
        $this->postJson('/api/v1/items', array_replace($this->product, ['barcode' => 'LCD-1']))->assertUnprocessable();
        $this->move(['kind' => 'manual_out', 'quantity' => 1, 'serials' => 'LCD-1'])->assertOk();
        $this->move(['kind' => 'manual_out', 'quantity' => 1, 'serials' => 'LCD-1'])->assertUnprocessable();
    }

    public function test_enabling_tracking_assigns_existing_stock_without_changing_ledger_and_cannot_be_disabled(): void
    {
        $legacy = Item::create(['name' => 'Legacy LCD', 'category_id' => $this->product['category_id'], 'stock' => 3]);
        $this->putJson('/api/v1/items/'.$legacy->id, $this->product)->assertOk();
        $this->assertSame(3, ItemUnit::where('item_id', $legacy->id)->where('in_stock', true)->count());
        $this->assertSame(0, Movement::count());
        $this->putJson('/api/v1/items/'.$legacy->id, array_replace($this->product, ['serial_tracking' => false]))->assertUnprocessable();
        $this->putJson('/api/v1/items/'.$legacy->id, $this->product)->assertOk();
        $this->assertSame(3, ItemUnit::where('item_id', $legacy->id)->count());
    }

    public function test_serialized_adjustments_identify_missing_units_and_generate_new_units(): void
    {
        $this->move(['serials' => "LCD-1\nLCD-2"])->assertOk();
        $this->move(['kind' => 'adjustment', 'counted_quantity' => 1])->assertUnprocessable();
        $this->move(['kind' => 'adjustment', 'counted_quantity' => 1, 'serials' => 'LCD-2'])->assertOk();
        $this->move(['kind' => 'adjustment', 'counted_quantity' => 3])->assertOk();
        $this->assertSame(3, ItemUnit::where('in_stock', true)->count());
        $this->assertSame(3, $this->item->fresh()->stock);
    }

    public function test_sale_return_requires_the_original_serial_and_retry_preserves_unit_states(): void
    {
        $this->move(['serials' => "LCD-1\nLCD-2"])->assertOk();
        config(['sbm.sales_token' => str_repeat('s', 40)]);
        $sale = ['reference' => 'SALE-1', 'actor_reference' => 'Cashier', 'reason' => 'Paid sale', 'payment_status' => 'paid', 'finalized' => true, 'items' => [['inventory_item_id' => $this->item->id, 'quantity' => 1, 'line_id' => '1', 'serials' => 'LCD-1']]];
        $headers = ['Authorization' => 'Bearer '.str_repeat('s', 40), 'Idempotency-Key' => 'sale-1'];
        $response = $this->withHeaders($headers)->postJson('/api/v1/stock/out', $sale)->assertOk()->json();
        $this->withHeaders($headers)->postJson('/api/v1/stock/out', $sale)->assertExactJson($response);
        $return = ['reference' => 'RETURN-1', 'original_reference' => 'SALE-1', 'actor_reference' => 'Cashier', 'reason' => 'Accepted return', 'return_accepted' => true, 'items' => [['inventory_item_id' => $this->item->id, 'quantity' => 1, 'line_id' => '1', 'serials' => 'LCD-2']]];
        $headers['Idempotency-Key'] = 'return-1';
        $this->withHeaders($headers)->postJson('/api/v1/stock/in', $return)->assertUnprocessable();
        $return['items'][0]['serials'] = 'LCD-1';
        $this->withHeaders($headers)->postJson('/api/v1/stock/in', $return)->assertOk();
        $this->assertSame(2, ItemUnit::where('in_stock', true)->count());
    }

    public function test_technician_can_view_serials_but_cannot_enable_tracking_or_generate_barcodes(): void
    {
        $this->move()->assertOk();
        $this->actingAs(User::create(['name' => 'Tech', 'email' => 'unit-tech@example.test', 'password' => 'test-password-123', 'role' => 'technician']));
        $this->getJson('/api/v1/items/'.$this->item->id.'/units')->assertOk()->assertJsonCount(2, 'data');
        $this->postJson('/api/v1/items/generate-barcode')->assertForbidden();
        $this->putJson('/api/v1/items/'.$this->item->id, $this->product)->assertForbidden();
    }
}
