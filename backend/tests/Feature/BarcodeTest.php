<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\Item;
use App\Models\User;
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
        $this->getJson('/api/v1/items?barcode=1234')->assertUnprocessable();
        $this->putJson('/api/v1/items/'.$id, array_replace($this->payload, ['barcode' => null]))->assertUnprocessable()->assertJsonValidationErrors('barcode');
    }

    public function test_new_items_require_exactly_sixteen_ascii_digits_as_a_string(): void
    {
        foreach ([null, '', '123456789012345', '12345678901234567', '123456789012345a', '１２３４５６７８９０１２３４５６', 1234567890123456] as $barcode) {
            $this->postJson('/api/v1/items', array_replace($this->payload, ['barcode' => $barcode]))->assertUnprocessable()->assertJsonValidationErrors('barcode');
        }
        unset($this->payload['barcode']);
        $this->postJson('/api/v1/items', $this->payload)->assertUnprocessable()->assertJsonValidationErrors('barcode');
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
