<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\Item;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class BarcodeTest extends TestCase
{
    use RefreshDatabase;

    private array $payload;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actingAs(User::create(['name' => 'Admin', 'email' => 'barcode@example.test', 'password' => 'test-password-123', 'role' => 'admin']));
        $category = Category::create(['name' => 'Barcode test']);
        $this->payload = ['sku' => 'SCAN-1', 'barcode' => '0012345678901234', 'name' => 'Scanned part', 'category_id' => $category->id, 'unit' => 'piece', 'cost' => 1000, 'minimum_stock' => 0, 'active' => true, 'phone_model_ids' => []];
    }

    public function test_barcode_preserves_zeroes_is_unique_and_can_be_found(): void
    {
        $id = $this->postJson('/api/v1/items', $this->payload)->assertCreated()->assertJsonPath('barcode', '0012345678901234')->json('id');
        $this->putJson('/api/v1/items/'.$id, $this->payload)->assertOk();
        $this->postJson('/api/v1/items', array_replace($this->payload, ['sku' => 'SCAN-2']))->assertUnprocessable()->assertJsonValidationErrors('barcode');
        $this->getJson('/api/v1/items?barcode=0012345678901234')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $id);
        $this->getJson('/api/v1/items?barcode=0012345678901235')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/v1/items?search=0012345678901234')->assertOk()->assertJsonCount(1, 'data');
        $this->getJson('/api/v1/items?barcode=1234')->assertOk()->assertJsonCount(0, 'data');
        $this->putJson('/api/v1/items/'.$id, array_replace($this->payload, ['barcode' => null]))->assertUnprocessable()->assertJsonValidationErrors('barcode');
    }

    public function test_new_items_require_a_printable_barcode_string(): void
    {
        foreach ([null, '', '   ', str_repeat('A', 501), "ABC\n123", "ABC\t123", "ABC\x00123", "ABC\x7F123", "ABC\u{0085}123", 1234567890123456] as $barcode) {
            $this->postJson('/api/v1/items', array_replace($this->payload, ['barcode' => $barcode]))->assertUnprocessable()->assertJsonValidationErrors('barcode');
        }
        unset($this->payload['barcode']);
        $this->postJson('/api/v1/items', $this->payload)->assertUnprocessable()->assertJsonValidationErrors('barcode');
    }

    public function test_alphanumeric_and_variable_length_barcodes_can_be_saved_updated_and_found(): void
    {
        foreach (['00AbC123xyZ', '00123456789012', 'A', str_repeat('Z', 100)] as $index => $barcode) {
            $payload = array_replace($this->payload, ['sku' => 'ALPHA-'.$index, 'barcode' => $barcode]);
            $id = $this->postJson('/api/v1/items', $payload)->assertCreated()->assertJsonPath('barcode', $barcode)->json('id');
            $this->putJson('/api/v1/items/'.$id, $payload)->assertOk()->assertJsonPath('barcode', $barcode);
            $this->getJson('/api/v1/items?barcode='.$barcode)->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $id);
            $this->postJson('/api/v1/items', array_replace($payload, ['sku' => 'DUP-'.$index]))->assertUnprocessable()->assertJsonValidationErrors('barcode');
        }
        $this->getJson('/api/v1/items?barcode=00ABC123XYZ')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/v1/items?barcode=ABC-123')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/v1/items?barcode='.str_repeat('Z', 501))->assertUnprocessable();
    }

    public function test_product_qr_values_preserve_symbols_spaces_and_unicode_for_save_and_exact_lookup(): void
    {
        foreach (['BMIP13(IC)INCB', 'CHGUI-IP14PRO', 'LCD FULL SET (O) OP A15/A15S/A16K/C11/C12', 'https://parts.example/item?id=001&batch=A+B#screen', '配件-屏幕 (原装)', ' 00AbC-123 ', str_repeat('Z', 500)] as $index => $barcode) {
            $payload = array_replace($this->payload, ['sku' => 'QR-'.$index, 'barcode' => $barcode]);
            $id = $this->postJson('/api/v1/items', $payload)->assertCreated()->assertJsonPath('barcode', $barcode)->json('id');
            $this->putJson('/api/v1/items/'.$id, $payload)->assertOk()->assertJsonPath('barcode', $barcode);
            $this->getJson('/api/v1/items?'.http_build_query(['barcode' => $barcode]))->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $id);
            $this->postJson('/api/v1/items', array_replace($payload, ['sku' => 'QR-DUP-'.$index]))->assertUnprocessable()->assertJsonValidationErrors('barcode');
        }
        $this->getJson('/api/v1/items?'.http_build_query(['barcode' => "ABC\n123"]))->assertUnprocessable();
    }

    public function test_database_constraint_rejects_control_characters_even_when_validation_is_bypassed(): void
    {
        $payload = array_replace($this->payload, ['barcode' => "ABC\t123"]);
        unset($payload['phone_model_ids']);
        $this->expectException(QueryException::class);
        $this->expectExceptionMessage('items_barcode_format');
        Item::create($payload);
    }

    public function test_existing_items_can_be_edited_and_assigned_barcodes_later(): void
    {
        $legacy = Item::create(['sku' => 'OLD', 'name' => 'Existing item', 'category_id' => $this->payload['category_id']]);
        $this->putJson('/api/v1/items/'.$legacy->id, array_replace($this->payload, ['barcode' => null]))->assertOk();
        $this->putJson('/api/v1/items/'.$legacy->id, $this->payload)->assertOk()->assertJsonPath('barcode', '0012345678901234');
    }

    public function test_technician_can_lookup_barcodes_without_cost_or_edit_access(): void
    {
        $id = $this->postJson('/api/v1/items', $this->payload)->assertCreated()->json('id');
        $this->actingAs(User::create(['name' => 'Technician', 'email' => 'barcode-tech@example.test', 'password' => 'test-password-123', 'role' => 'technician']));
        $this->getJson('/api/v1/items?barcode=0012345678901234')->assertOk()->assertJsonPath('data.0.id', $id)->assertJsonMissingPath('data.0.cost');
        $this->putJson('/api/v1/items/'.$id, $this->payload)->assertForbidden();
    }
}
