<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\Item;
use App\Models\Movement;
use App\Models\Supplier;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class RepairUsageReversalTest extends TestCase
{
    use RefreshDatabase;

    private Item $item;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actingAs(User::create(['name' => 'Admin', 'email' => 'reversal@example.test', 'password' => 'test-password-123', 'role' => 'admin']));
        config(['sbm.sales_token' => str_repeat('s', 40), 'sbm.repair_token' => str_repeat('r', 40)]);
        $this->item = Item::create(['name' => 'Repair screen', 'category_id' => Category::create(['name' => 'Displays'])->id, 'cost' => 1200, 'price' => 2000]);
    }

    private function usage(bool $tracked = false): int
    {
        $this->item->update(['serial_tracking' => $tracked]);
        $this->postJson('/api/v1/movements', ['request_key' => (string) Str::uuid(), 'kind' => 'receipt', 'item_id' => $this->item->id,
            'quantity' => 2, 'supplier_id' => Supplier::create(['name' => 'Original supplier'])->id, 'reference' => 'DELIVERY-1', 'unit_cost' => 1500, 'reason' => 'Supplier delivery', ...($tracked ? ['serials' => "SCREEN-1\nSCREEN-2"] : [])])->assertOk();

        return $this->withHeaders(['Authorization' => 'Bearer '.str_repeat('r', 40), 'Idempotency-Key' => 'usage-1'])
            ->postJson('/api/v1/repair/usage', ['reference' => 'RP-1-part-1', 'repair_job_reference' => 'RP-1', 'actor_reference' => 'tech-1', 'reason' => 'Screen installed',
                'items' => [['inventory_item_id' => (string) $this->item->id, 'quantity' => 1, 'line_id' => '1', ...($tracked ? ['serials' => 'SCREEN-1'] : [])]]])
            ->assertOk()->json('movements.0.id');
    }

    private function remove(array $values = [], string $key = 'remove-1')
    {
        return $this->withHeaders(['Authorization' => 'Bearer '.str_repeat('r', 40), 'Idempotency-Key' => $key])
            ->postJson('/api/v1/repair/usage/reverse', [...['reference' => 'RP-1-part-1-remove', 'original_reference' => 'RP-1-part-1',
                'repair_job_reference' => 'RP-1', 'actor_reference' => 'tech-1', 'reason' => 'Wrong item scanned'], ...$values]);
    }

    private function assertReversal(bool $tracked): void
    {
        $movement = $this->usage($tracked);
        $this->assertSame(1, $this->item->fresh()->stock);
        $this->item->update(['cost' => 99999]);
        $result = $this->remove()->assertOk()->assertJsonPath('acknowledged', true)->assertJsonPath('movements.0.delta', 1)->json();
        $this->remove()->assertExactJson($result);
        $this->remove([], 'second-key')->assertExactJson($result);
        $this->assertSame(2, $this->item->fresh()->stock);
        $this->assertSame(3000, (int) $this->item->batches()->sum(DB::raw('remaining_quantity * unit_cost')));
        $this->assertDatabaseHas('stock_batches', ['item_id' => $this->item->id, 'unit_cost' => 1500, 'remaining_quantity' => 2, 'supplier_id' => Supplier::where('name', 'Original supplier')->value('id')]);
        $this->assertDatabaseHas('movements', ['reverses_id' => $movement, 'source' => 'repair', 'repair_job_reference' => 'RP-1']);
        $this->assertSame(3, Movement::count());
        if ($tracked) {
            $this->assertDatabaseHas('item_units', ['serial_number' => 'SCREEN-1', 'in_stock' => true]);
        }
        $this->remove(['reason' => 'Different reason'])->assertConflict();
        $this->artisan('inventory:reconcile')->assertExitCode(0);
    }

    public function test_untracked_usage_removal_restores_original_supplier_cost_and_is_idempotent(): void
    {
        $this->assertReversal(false);
    }

    public function test_serialized_usage_removal_restores_the_exact_unit_and_cost(): void
    {
        $this->assertReversal(true);
    }

    public function test_removal_rejects_wrong_tokens_unknown_usage_and_wrong_repair(): void
    {
        $this->usage();
        $this->withHeaders(['Authorization' => 'Bearer '.str_repeat('s', 40)])
            ->postJson('/api/v1/repair/usage/reverse', [])->assertUnauthorized();
        $this->remove(['original_reference' => 'missing'])->assertNotFound();
        $this->remove(['repair_job_reference' => 'OTHER'])->assertConflict();
        $this->remove(['reason' => ''])->assertUnprocessable();
        $this->assertSame(1, $this->item->fresh()->stock);
        $this->assertSame(2, Movement::count());
    }
}
