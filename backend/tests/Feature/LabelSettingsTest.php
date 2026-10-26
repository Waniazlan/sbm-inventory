<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\Item;
use App\Models\ItemUnit;
use App\Models\LabelSetting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class LabelSettingsTest extends TestCase
{
    use RefreshDatabase;

    private const DEFAULTS = ['sku_prefix' => 'PRN', 'barcode_prefix' => 'SBM-P', 'serial_prefix' => 'SN'];

    private function admin(): void
    {
        $this->actingAs(User::create(['name' => 'Admin', 'email' => 'labels@example.test', 'password' => 'test-password-123', 'role' => 'admin']));
    }

    public function test_settings_require_an_active_administrator(): void
    {
        $this->getJson('/api/v1/settings/labels')->assertUnauthorized();
        $this->putJson('/api/v1/settings/labels', self::DEFAULTS)->assertUnauthorized();
        $user = User::create(['name' => 'Tech', 'email' => 'tech-labels@example.test', 'password' => 'test-password-123', 'role' => 'technician']);
        $this->actingAs($user);
        $this->getJson('/api/v1/settings/labels')->assertForbidden();
        $this->putJson('/api/v1/settings/labels', self::DEFAULTS)->assertForbidden();
        $user->update(['role' => 'admin', 'active' => false]);
        $this->getJson('/api/v1/settings/labels')->assertForbidden();
        $this->putJson('/api/v1/settings/labels', self::DEFAULTS)->assertForbidden();
    }

    public function test_prefixes_persist_are_audited_and_preserve_existing_identifiers_and_retries(): void
    {
        $this->admin();
        $this->getJson('/api/v1/settings/labels')->assertExactJson(self::DEFAULTS);
        foreach (['inventory_item_sku_seq', 'inventory_barcode_seq', 'inventory_unit_serial_seq'] as $sequence) {
            DB::select("SELECT setval('{$sequence}', 1, false)");
        }
        $product = ['name' => 'Screen', 'category_id' => Category::create(['name' => 'LCD'])->id, 'unit' => 'piece', 'minimum_stock' => 0, 'active' => true, 'phone_model_ids' => [], 'serial_tracking' => true];
        $old = $this->postJson('/api/v1/items', $product)->assertCreated()->assertJsonPath('sku', 'PRN-000001')->assertJsonPath('barcode', 'SBM-P-00000001')->json();
        $receipt = ['request_key' => (string) Str::uuid(), 'kind' => 'receipt', 'item_id' => $old['id'], 'quantity' => 1, 'unit_cost' => 12050, 'reference' => 'PREFIX-TEST', 'reason' => 'Prefix test receipt'];
        $original = $this->postJson('/api/v1/movements', $receipt)->assertOk()->assertJsonPath('movements.0.serials', 'SN-0000000001-12050-0')->json();

        $prefixes = ['sku_prefix' => 'VG', 'barcode_prefix' => 'VG-P', 'serial_prefix' => 'VG_SN'];
        $this->putJson('/api/v1/settings/labels', $prefixes)->assertExactJson($prefixes);
        $this->getJson('/api/v1/settings/labels')->assertExactJson($prefixes);
        $this->assertDatabaseHas('label_settings', ['id' => 1] + $prefixes);
        $this->assertDatabaseHas('audit_logs', ['action' => 'settings.label_prefixes_updated']);
        $new = $this->postJson('/api/v1/items', $product)->assertCreated()->assertJsonPath('sku', 'VG-000002')->assertJsonPath('barcode', 'VG-P-00000002')->json();
        $this->postJson('/api/v1/movements', array_replace($receipt, ['request_key' => (string) Str::uuid(), 'item_id' => $new['id']]))->assertOk()->assertJsonPath('movements.0.serials', 'VG_SN-0000000002-12050-0');
        $this->postJson('/api/v1/movements', $receipt)->assertExactJson($original);
        $this->assertDatabaseHas('items', ['id' => $old['id'], 'sku' => 'PRN-000001', 'barcode' => 'SBM-P-00000001']);
        $this->assertDatabaseHas('item_units', ['item_id' => $old['id'], 'serial_number' => 'SN-0000000001-12050-0']);
        $this->postJson('/api/v1/movements', array_replace($receipt, ['request_key' => (string) Str::uuid(), 'serials' => 'CUSTOM-SERIAL']))->assertOk()->assertJsonPath('movements.0.serials', 'CUSTOM-SERIAL');
        $this->putJson('/api/v1/settings/labels', self::DEFAULTS)->assertOk();
        $this->postJson('/api/v1/items', $product)->assertCreated()->assertJsonPath('sku', 'PRN-000003')->assertJsonPath('barcode', 'SBM-P-00000003');
        $this->getJson('/api/v1/items?barcode=VG_SN-0000000002-12050-0')->assertOk()->assertJsonPath('data.0.id', $new['id']);
    }

    public function test_invalid_prefixes_cannot_change_settings(): void
    {
        $this->admin();
        foreach (LabelSetting::FIELDS as $field) {
            foreach (['', null, 'bad prefix', 'TRAILING-', '-LEADING', 'A/B', "A\nB", '<script>', str_repeat('A', 21)] as $invalid) {
                $this->putJson('/api/v1/settings/labels', array_replace(self::DEFAULTS, [$field => $invalid]))->assertUnprocessable()->assertJsonValidationErrors($field);
            }
        }
        $this->getJson('/api/v1/settings/labels')->assertExactJson(self::DEFAULTS);
    }

    public function test_generated_codes_skip_imported_collisions_with_the_configured_prefixes(): void
    {
        $this->admin();
        $this->putJson('/api/v1/settings/labels', ['sku_prefix' => 'VG', 'barcode_prefix' => 'VG-P', 'serial_prefix' => 'VG_SN'])->assertOk();
        $category = Category::create(['name' => 'LCD']);
        $legacy = Item::create(['name' => 'Imported', 'sku' => 'VG-000001', 'barcode' => 'VG-P-00000001', 'category_id' => $category->id]);
        ItemUnit::create(['item_id' => $legacy->id, 'serial_number' => 'VG_SN-0000000001-1000-0']);
        foreach (['inventory_item_sku_seq', 'inventory_barcode_seq', 'inventory_unit_serial_seq'] as $sequence) {
            DB::select("SELECT setval('{$sequence}', 1, false)");
        }
        $product = ['name' => 'Screen', 'category_id' => $category->id, 'unit' => 'piece', 'minimum_stock' => 0, 'active' => true, 'phone_model_ids' => [], 'serial_tracking' => true];
        $id = $this->postJson('/api/v1/items', $product)->assertCreated()->assertJsonPath('sku', 'VG-000002')->assertJsonPath('barcode', 'VG-P-00000002')->json('id');
        $this->postJson('/api/v1/movements', ['request_key' => (string) Str::uuid(), 'kind' => 'receipt', 'item_id' => $id, 'quantity' => 1, 'unit_cost' => 1000, 'reference' => 'COLLISION-TEST', 'reason' => 'Prefix test receipt'])->assertOk()->assertJsonPath('movements.0.serials', 'VG_SN-0000000002-1000-0');
    }
}
