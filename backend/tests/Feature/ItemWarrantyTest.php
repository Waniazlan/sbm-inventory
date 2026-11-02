<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\Item;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class ItemWarrantyTest extends TestCase
{
    use RefreshDatabase;

    private array $payload;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actingAs(User::create(['name' => 'Admin', 'email' => 'warranty@example.test', 'password' => 'test-password-123', 'role' => 'admin']));
        $this->payload = ['name' => 'Warranty screen', 'category_id' => Category::create(['name' => 'Warranty parts'])->id,
            'unit' => 'piece', 'minimum_stock' => 0, 'active' => true, 'phone_model_ids' => []];
    }

    public function test_warranty_is_saved_returned_and_can_be_changed_or_cleared(): void
    {
        $id = $this->postJson('/api/v1/items', $this->payload + ['warranty_days' => 90])
            ->assertCreated()->assertJsonPath('warranty_days', 90)->json('id');
        $this->assertDatabaseHas('items', ['id' => $id, 'warranty_days' => 90]);
        $this->getJson('/api/v1/items/'.$id)->assertOk()->assertJsonPath('warranty_days', 90);
        $this->getJson('/api/v1/items')->assertOk()->assertJsonPath('data.0.warranty_days', 90);

        $this->putJson('/api/v1/items/'.$id, $this->payload + ['warranty_days' => 365])
            ->assertOk()->assertJsonPath('warranty_days', 365);
        $this->assertSame(365, Item::findOrFail($id)->warranty_days);
        $this->putJson('/api/v1/items/'.$id, $this->payload + ['warranty_days' => 0])
            ->assertOk()->assertJsonPath('warranty_days', 0);
        $this->assertDatabaseHas('items', ['id' => $id, 'warranty_days' => 0]);
        $this->putJson('/api/v1/items/'.$id, $this->payload + ['warranty_days' => null])
            ->assertOk()->assertJsonPath('warranty_days', null);
        $this->assertDatabaseHas('items', ['id' => $id, 'warranty_days' => null]);
    }

    public function test_omitting_warranty_keeps_existing_clients_compatible_and_preserves_saved_duration(): void
    {
        $id = $this->postJson('/api/v1/items', $this->payload)->assertCreated()->json('id');
        $this->getJson('/api/v1/items/'.$id)->assertOk()->assertJsonPath('warranty_days', null);
        Item::findOrFail($id)->update(['warranty_days' => 30]);
        $this->putJson('/api/v1/items/'.$id, $this->payload)->assertOk()->assertJsonPath('warranty_days', 30);
        $this->assertDatabaseHas('items', ['id' => $id, 'warranty_days' => 30]);
    }

    #[DataProvider('invalidDurations')]
    public function test_invalid_durations_are_rejected_on_create_and_update(mixed $duration): void
    {
        $this->postJson('/api/v1/items', $this->payload + ['warranty_days' => $duration])
            ->assertUnprocessable()->assertJsonValidationErrors('warranty_days');
        $this->assertDatabaseCount('items', 0);

        $item = Item::create(['name' => 'Existing item', 'category_id' => $this->payload['category_id'], 'warranty_days' => 90]);
        $this->putJson('/api/v1/items/'.$item->id, $this->payload + ['warranty_days' => $duration])
            ->assertUnprocessable()->assertJsonValidationErrors('warranty_days');
        $this->assertSame(90, $item->fresh()->warranty_days);
    }

    public static function invalidDurations(): array
    {
        return [[-1], [1.5], ['three months'], [36501]];
    }
}
