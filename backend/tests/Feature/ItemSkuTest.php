<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\Item;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class ItemSkuTest extends TestCase
{
    use RefreshDatabase;

    private array $payload;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actingAs(User::create(['name' => 'Admin', 'email' => 'sku@example.test', 'password' => 'test-password-123', 'role' => 'admin']));
        $category = Category::create(['name' => 'SKU test']);
        $this->payload = ['barcode' => 'PART-001', 'name' => 'Screen', 'category_id' => $category->id, 'part_number' => 'CHGUI-IP14PRO', 'unit' => 'piece', 'cost' => 1000, 'minimum_stock' => 0, 'active' => true, 'phone_model_ids' => []];
        DB::select("SELECT setval('inventory_item_sku_seq', 1, false)");
    }

    public function test_new_items_get_unique_skus_without_manual_input_and_can_be_found(): void
    {
        $this->postJson('/api/v1/items', $this->payload)->assertCreated()->assertJsonPath('sku', 'PRN-000001')->assertJsonPath('part_number', 'CHGUI-IP14PRO');
        $this->postJson('/api/v1/items', array_replace($this->payload, ['barcode' => 'PART-002']))->assertCreated()->assertJsonPath('sku', 'PRN-000002');
        $this->getJson('/api/v1/items?search=PRN-000001')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.sku', 'PRN-000001');
        $this->assertDatabaseHas('audit_logs', ['action' => 'item.created']);
        $this->assertSame('PRN-000001', json_decode(DB::table('audit_logs')->orderBy('id')->first()->details, true)['after']['sku']);
    }

    public function test_client_cannot_choose_or_change_a_sku(): void
    {
        $id = $this->postJson('/api/v1/items', array_replace($this->payload, ['sku' => 'CUSTOM-SKU']))->assertCreated()->assertJsonPath('sku', 'PRN-000001')->json('id');
        $this->putJson('/api/v1/items/'.$id, array_replace($this->payload, ['sku' => 'REPLACEMENT', 'name' => 'Updated screen']))->assertOk()->assertJsonPath('sku', 'PRN-000001')->assertJsonPath('name', 'Updated screen');
        $this->putJson('/api/v1/items/'.$id, $this->payload)->assertOk()->assertJsonPath('sku', 'PRN-000001');
    }

    public function test_legacy_skus_are_preserved_and_matching_generated_values_are_skipped(): void
    {
        $legacy = Item::create(['sku' => 'PRT-000042', 'name' => 'Legacy item', 'category_id' => $this->payload['category_id']]);
        Item::create(['sku' => 'PRN-000001', 'name' => 'Imported item', 'category_id' => $this->payload['category_id']]);
        $this->postJson('/api/v1/items', $this->payload)->assertCreated()->assertJsonPath('sku', 'PRN-000002');
        $this->putJson('/api/v1/items/'.$legacy->id, array_replace($this->payload, ['barcode' => 'LEGACY-PART']))->assertOk()->assertJsonPath('sku', 'PRT-000042');
    }

    public function test_migration_continues_after_matching_existing_skus_without_renumbering(): void
    {
        $legacy = Item::create(['sku' => 'PRN-001234', 'name' => 'Imported item', 'category_id' => $this->payload['category_id']]);
        $migration = require database_path('migrations/2026_10_24_000002_create_item_sku_sequence.php');
        $migration->down();
        $migration->up();
        $this->postJson('/api/v1/items', $this->payload)->assertCreated()->assertJsonPath('sku', 'PRN-001235');
        $this->assertSame('PRN-001234', $legacy->fresh()->sku);
    }

    public function test_sku_sequence_grows_beyond_six_digits_without_truncation(): void
    {
        DB::select("SELECT setval('inventory_item_sku_seq', 1000000, false)");
        $this->postJson('/api/v1/items', $this->payload)->assertCreated()->assertJsonPath('sku', 'PRN-1000000');
    }
}
