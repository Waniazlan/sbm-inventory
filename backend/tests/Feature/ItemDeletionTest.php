<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\Item;
use App\Models\ItemUnit;
use App\Models\Movement;
use App\Models\PhoneModel;
use App\Models\User;
use App\Services\UnitSerials;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class ItemDeletionTest extends TestCase
{
    use RefreshDatabase;

    private Item $item;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->admin = User::create(['name' => 'Admin', 'email' => 'delete-admin@example.test', 'password' => 'test-password-123', 'role' => 'admin']);
        $this->item = Item::create(['sku' => 'PRN-000001', 'barcode' => 'SBM-P-00000001', 'name' => 'Deletion test LCD', 'category_id' => Category::create(['name' => 'LCD'])->id, 'serial_tracking' => true, 'price' => 2000]);
    }

    private function deleteItem()
    {
        return $this->deleteJson('/api/v1/items/'.$this->item->id);
    }

    private function move(array $data = [])
    {
        return $this->postJson('/api/v1/movements', array_replace(['request_key' => (string) Str::uuid(), 'kind' => 'receipt', 'item_id' => $this->item->id, 'quantity' => 1, 'unit_cost' => 1000, 'reference' => 'DELETE-TEST', 'reason' => 'Deletion test movement'], $data));
    }

    public function test_only_active_administrators_can_delete_items(): void
    {
        $this->deleteItem()->assertUnauthorized();
        $tech = User::create(['name' => 'Tech', 'email' => 'delete-tech@example.test', 'password' => 'test-password-123', 'role' => 'technician']);
        $this->actingAs($tech);
        $this->deleteItem()->assertForbidden();
        $this->admin->update(['active' => false]);
        $this->actingAs($this->admin);
        $this->deleteItem()->assertForbidden();
        $this->assertNotSoftDeleted($this->item);
    }

    public function test_admin_deletion_hides_an_item_and_retries_do_not_duplicate_the_audit(): void
    {
        $this->actingAs($this->admin);
        $phone = PhoneModel::create(['name' => 'iPhone 13', 'brand' => 'Apple']);
        $this->item->phoneModels()->attach($phone);
        $this->deleteItem()->assertNoContent();
        $this->deleteItem()->assertNoContent();
        $this->assertSoftDeleted($this->item);
        $this->assertDatabaseHas('items', ['id' => $this->item->id, 'active' => false]);
        $this->assertDatabaseHas('item_phone_model', ['item_id' => $this->item->id, 'phone_model_id' => $phone->id]);
        $this->assertSame(1, DB::table('audit_logs')->where('action', 'item.deleted')->count());
        foreach (['', '?status=inactive', '?search=Deletion', '?barcode=SBM-P-00000001'] as $query) {
            $this->getJson('/api/v1/items'.$query)->assertOk()->assertJsonCount(0, 'data');
        }
        $this->getJson('/api/v1/items/options')->assertOk()->assertExactJson([]);
        foreach (['', '/units', '/batches'] as $path) {
            $this->getJson('/api/v1/items/'.$this->item->id.$path)->assertNotFound();
        }
        $this->putJson('/api/v1/items/'.$this->item->id, [])->assertNotFound();
        $this->deleteJson('/api/v1/items/999999')->assertNotFound();
        $this->deleteJson('/api/v1/items/not-an-id')->assertNotFound();
    }

    public function test_deleting_an_exhausted_item_preserves_serials_batches_costs_and_searchable_history(): void
    {
        $this->actingAs($this->admin);
        $key = (string) Str::uuid();
        $receipt = $this->move(['request_key' => $key, 'serials' => 'DELETE-SERIAL'])->assertOk()->json();
        $this->move(['kind' => 'manual_out', 'serials' => 'DELETE-SERIAL'])->assertOk();
        $snapshot = fn () => [
            DB::table('movements')->orderBy('id')->get()->toJson(),
            DB::table('stock_batches')->orderBy('id')->get()->toJson(),
            DB::table('cost_allocations')->orderBy('id')->get()->toJson(),
            DB::table('item_units')->orderBy('id')->get()->toJson(),
        ];
        $before = $snapshot();
        $this->deleteItem()->assertNoContent();
        $this->assertSame($before, $snapshot());
        $this->getJson('/api/v1/movements?search=Deletion')->assertOk()->assertJsonCount(2, 'data')->assertJsonPath('data.0.item.sku', $this->item->sku);
        $this->getJson('/api/v1/reports?kind=movements')->assertOk()->assertJsonPath('data.0.SKU', $this->item->sku);
        $csv = $this->get('/api/v1/reports?kind=movements&format=csv')->assertOk()->streamedContent();
        $this->assertStringContainsString($this->item->sku, $csv);
        $this->getJson('/api/v1/dashboard')->assertOk()->assertJsonPath('items', 0)->assertJsonPath('units', 0)->assertJsonPath('valuation', 0);
        $this->move(['request_key' => $key, 'serials' => 'DELETE-SERIAL'])->assertExactJson($receipt);
        $this->move()->assertUnprocessable();
        $movement = Movement::where('type', 'manual_out')->firstOrFail();
        $this->move(['kind' => 'reversal', 'movement_id' => $movement->id])->assertUnprocessable();
        $this->assertSame($before, $snapshot());
        $this->artisan('inventory:reconcile')->assertExitCode(0);
    }

    public function test_deletion_rejects_stock_and_inconsistent_batch_or_serial_balances(): void
    {
        $this->actingAs($this->admin);
        $this->move(['serials' => 'STILL-IN-STOCK'])->assertOk();
        $this->deleteItem()->assertUnprocessable()->assertJsonPath('message', 'This item still has stock. Issue, return or adjust the remaining stock before deleting it.');
        // A stale cached balance must not allow deleting actual batch stock.
        $this->item->update(['stock' => 0]);
        $this->deleteItem()->assertUnprocessable();
        $this->assertNotSoftDeleted($this->item);
        $this->assertDatabaseMissing('audit_logs', ['action' => 'item.deleted']);
        $empty = Item::create(['name' => 'Mismatched serial', 'category_id' => $this->item->category_id, 'serial_tracking' => true]);
        ItemUnit::create(['item_id' => $empty->id, 'serial_number' => 'UNASSIGNED-AVAILABLE']);
        $this->deleteJson('/api/v1/items/'.$empty->id)->assertUnprocessable();
        $this->assertNotSoftDeleted($empty);
    }

    public function test_deleted_identifiers_remain_reserved_and_generation_skips_them(): void
    {
        $this->actingAs($this->admin);
        $this->deleteItem()->assertNoContent();
        DB::select("SELECT setval('inventory_item_sku_seq', 1, false)");
        DB::select("SELECT setval('inventory_barcode_seq', 1, false)");
        $new = Item::create(['name' => 'New screen', 'category_id' => $this->item->category_id, 'serial_tracking' => true]);
        $this->assertSame('PRN-000002', $new->sku);
        $this->assertSame('SBM-P-00000002', UnitSerials::barcode());
        $this->postJson('/api/v1/items', ['barcode' => $this->item->barcode])->assertUnprocessable()->assertJsonValidationErrors('barcode');
        $this->move(['item_id' => $new->id, 'serials' => $this->item->barcode])->assertUnprocessable()->assertJsonValidationErrors('serials');
        $reserved = Item::create(['name' => 'Reserved serial namespace', 'barcode' => 'SN-0000000001-1000-0', 'category_id' => $this->item->category_id]);
        $this->deleteJson('/api/v1/items/'.$reserved->id)->assertNoContent();
        DB::select("SELECT setval('inventory_unit_serial_seq', 1, false)");
        $this->assertSame('SN-0000000002-1000-0', UnitSerials::generate(1000, null));
    }
}
