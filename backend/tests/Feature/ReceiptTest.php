<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\Item;
use App\Models\Movement;
use App\Models\Operation;
use App\Models\Supplier;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class ReceiptTest extends TestCase
{
    use RefreshDatabase;

    private Item $lcd;

    private Item $battery;

    private array $payload;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actingAs(User::create(['name' => 'Admin', 'email' => 'receipt@example.test', 'password' => 'test-password-123', 'role' => 'admin']));
        $category = Category::create(['name' => 'Parts']);
        $this->lcd = Item::create(['name' => 'LCD', 'category_id' => $category->id, 'cost' => 6000]);
        $this->battery = Item::create(['name' => 'Battery', 'category_id' => $category->id, 'cost' => 2500]);
        $supplier = Supplier::create(['name' => 'Parts supplier']);
        $this->payload = ['request_key' => (string) Str::uuid(), 'kind' => 'receipt', 'supplier_id' => $supplier->id, 'reference' => 'INV-123', 'items' => [
            ['item_id' => $this->lcd->id, 'quantity' => 2, 'unit_cost' => 5500, 'batch' => 'LCD-LOT', 'serials' => "LCD-001\nLCD-002"],
            ['item_id' => $this->battery->id, 'quantity' => 5, 'unit_cost' => 0, 'batch' => 'BAT-LOT', 'serials' => 'BAT-001'],
        ]];
    }

    public function test_one_receipt_posts_all_items_with_separate_line_details_and_one_operation(): void
    {
        $this->postJson('/api/v1/movements', $this->payload)->assertOk()->assertJsonCount(2, 'movements');
        $this->assertSame(2, $this->lcd->fresh()->stock);
        $this->assertSame(5, $this->battery->fresh()->stock);
        $this->assertSame(1, Operation::count());
        $this->assertSame(1, Movement::distinct()->count('operation_id'));
        foreach ($this->payload['items'] as $row) {
            $this->assertDatabaseHas('movements', $row + ['reference' => 'INV-123', 'supplier_id' => $this->payload['supplier_id'], 'reason' => 'Stock received from supplier']);
        }
    }

    public function test_receipts_keep_each_line_brand_without_overwriting_catalogue_or_earlier_receipts(): void
    {
        $this->lcd->update(['brand' => 'Legacy catalogue brand']);
        $this->payload['items'][0]['brand'] = 'Brand A';
        $this->payload['items'][1]['brand'] = 'Brand B';
        $response = $this->postJson('/api/v1/movements', $this->payload)->assertOk()->json();
        $this->postJson('/api/v1/movements', $this->payload)->assertExactJson($response);
        $this->payload['items'][0]['brand'] = 'Replacement brand';
        $this->postJson('/api/v1/movements', $this->payload)->assertConflict();
        $this->payload['request_key'] = (string) Str::uuid();
        $this->postJson('/api/v1/movements', $this->payload)->assertOk();
        $this->assertSame('Legacy catalogue brand', $this->lcd->fresh()->brand);
        $this->assertDatabaseHas('movements', ['id' => $response['movements'][0]['id'], 'brand' => 'Brand A']);
        $this->assertDatabaseHas('movements', ['id' => $response['movements'][1]['id'], 'brand' => 'Brand B']);
        $this->getJson('/api/v1/movements?item_id='.$this->lcd->id)->assertOk()->assertJsonPath('data.0.brand', 'Replacement brand');
        $csv = $this->get('/api/v1/reports?kind=movements&format=csv')->assertOk();
        $this->assertStringContainsString('Brand A', $csv->streamedContent());
    }

    public function test_receipt_brand_length_is_validated_and_legacy_single_receipt_supports_brand(): void
    {
        $this->payload['items'][1]['brand'] = str_repeat('X', 101);
        $this->postJson('/api/v1/movements', $this->payload)->assertUnprocessable()->assertJsonValidationErrors('items.1.brand');
        $this->assertSame(0, Movement::count());
        $this->postJson('/api/v1/movements', [
            'request_key' => (string) Str::uuid(), 'kind' => 'receipt', 'item_id' => $this->lcd->id,
            'quantity' => 1, 'reference' => 'BRAND-LEGACY', 'brand' => 'Single receipt brand',
        ])->assertOk();
        $this->assertDatabaseHas('movements', ['reference' => 'BRAND-LEGACY', 'brand' => 'Single receipt brand']);
    }

    public function test_blank_receipt_reason_uses_same_default_and_can_retry_without_reason(): void
    {
        $response = $this->postJson('/api/v1/movements', $this->payload + ['reason' => '   '])->assertOk()->json();
        $this->postJson('/api/v1/movements', $this->payload)->assertExactJson($response);
        $this->assertSame(['Stock received from supplier'], Movement::distinct()->pluck('reason')->all());
        $this->assertSame(2, Movement::count());
    }

    public function test_legacy_single_item_receipt_defaults_reason_and_keeps_explicit_reasons(): void
    {
        $payload = $this->payload;
        unset($payload['items']);
        $payload += ['item_id' => $this->lcd->id, 'quantity' => 1];
        $this->postJson('/api/v1/movements', $payload)->assertOk();
        $this->assertDatabaseHas('movements', ['item_id' => $this->lcd->id, 'reason' => 'Stock received from supplier']);
        $payload['request_key'] = (string) Str::uuid();
        $payload['reason'] = 'Received replacement delivery';
        $this->postJson('/api/v1/movements', $payload)->assertOk();
        $this->assertDatabaseHas('movements', ['item_id' => $this->lcd->id, 'reason' => 'Received replacement delivery']);
    }

    public function test_other_stock_movements_still_require_a_reason(): void
    {
        $this->postJson('/api/v1/movements', $this->payload)->assertOk();
        foreach ([
            ['kind' => 'manual_out', 'item_id' => $this->lcd->id, 'quantity' => 1],
            ['kind' => 'adjustment', 'item_id' => $this->lcd->id, 'counted_quantity' => 1, 'reference' => 'COUNT-123'],
            ['kind' => 'reversal', 'movement_id' => Movement::firstOrFail()->id],
        ] as $payload) {
            $this->postJson('/api/v1/movements', $payload + ['request_key' => (string) Str::uuid()])->assertUnprocessable()->assertJsonValidationErrors('reason');
        }
        $this->assertSame(2, Movement::count());
    }

    public function test_retries_do_not_duplicate_stock_and_changed_retry_is_rejected(): void
    {
        $response = $this->postJson('/api/v1/movements', $this->payload)->assertOk()->json();
        $this->postJson('/api/v1/movements', $this->payload)->assertExactJson($response);
        $this->payload['items'][1]['quantity'] = 6;
        $this->postJson('/api/v1/movements', $this->payload)->assertStatus(409);
        $this->assertSame(2, Movement::count());
        $this->assertSame(5, $this->battery->fresh()->stock);
    }

    public function test_late_item_failure_rolls_back_every_line_and_operation(): void
    {
        $this->battery->update(['active' => false]);
        $this->postJson('/api/v1/movements', $this->payload)->assertUnprocessable();
        $this->assertSame(0, $this->lcd->fresh()->stock);
        $this->assertSame(0, Movement::count());
        $this->assertSame(0, Operation::count());
    }

    public function test_repeated_product_lines_keep_their_own_batches_and_running_balances(): void
    {
        $this->payload['items'][1]['item_id'] = $this->lcd->id;
        $this->postJson('/api/v1/movements', $this->payload)->assertOk()->assertJsonPath('movements.1.balance', 7);
        $this->assertSame(7, $this->lcd->fresh()->stock);
        $this->assertDatabaseHas('movements', ['item_id' => $this->lcd->id, 'batch' => 'BAT-LOT', 'balance_before' => 2, 'balance_after' => 7]);
    }

    public function test_invalid_rows_are_rejected_before_any_stock_changes(): void
    {
        foreach ([[], [['item_id' => $this->lcd->id, 'quantity' => 0]], [['item_id' => $this->lcd->id, 'quantity' => 1.5]], [['item_id' => 9999999, 'quantity' => 1]], [['item_id' => $this->lcd->id, 'quantity' => 1, 'serials' => str_repeat('X', 130001)]], array_fill(0, 101, $this->payload['items'][0])] as $rows) {
            $this->postJson('/api/v1/movements', array_replace($this->payload, ['items' => $rows]))->assertUnprocessable();
        }
        $this->assertSame(0, Movement::count());
        $this->assertSame(0, $this->lcd->fresh()->stock);
    }

    public function test_receipt_requires_supplier_or_reference_and_rejects_ambiguous_payloads(): void
    {
        $this->postJson('/api/v1/movements', array_replace($this->payload, ['supplier_id' => null, 'reference' => null]))->assertUnprocessable();
        $this->postJson('/api/v1/movements', $this->payload + ['item_id' => $this->lcd->id, 'quantity' => 2])->assertUnprocessable();
        $this->postJson('/api/v1/movements', array_replace($this->payload, ['kind' => 'manual_out']))->assertUnprocessable();
        $this->assertSame(0, Movement::count());
    }

    public function test_blank_line_cost_uses_catalogue_cost_and_receipt_is_admin_only(): void
    {
        $this->payload['items'][0]['unit_cost'] = null;
        $this->postJson('/api/v1/movements', $this->payload)->assertOk();
        $this->assertDatabaseHas('movements', ['item_id' => $this->lcd->id, 'unit_cost' => 6000]);
        $this->actingAs(User::create(['name' => 'Tech', 'email' => 'receipt-tech@example.test', 'password' => 'test-password-123', 'role' => 'technician']));
        $this->payload['request_key'] = (string) Str::uuid();
        $this->postJson('/api/v1/movements', $this->payload)->assertForbidden();
        $this->assertSame(2, Movement::count());
    }

    public function test_item_dropdown_lists_active_catalogue_without_exposing_costs(): void
    {
        $this->battery->update(['active' => false]);
        $this->getJson('/api/v1/items/options')->assertOk()->assertJsonCount(1)->assertJsonPath('0.id', $this->lcd->id)->assertJsonMissingPath('0.cost');
    }

    public function test_item_dropdown_includes_items_beyond_the_first_catalogue_page(): void
    {
        for ($index = 0; $index < 26; $index++) {
            Item::create(['name' => 'Additional part '.$index, 'category_id' => $this->lcd->category_id]);
        }
        $this->getJson('/api/v1/items/options')->assertOk()->assertJsonCount(28);
    }
}
