<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\Item;
use App\Models\Movement;
use App\Models\Operation;
use App\Models\PhoneModel;
use App\Models\RepairJob;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class InventoryTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private Item $item;

    protected function setUp(): void
    {
        parent::setUp();
        $this->admin = User::create(['name' => 'Admin', 'email' => 'admin@example.test', 'password' => 'test-password-123', 'role' => 'admin']);
        $c = Category::create(['name' => 'Battery']);
        $this->item = Item::create(['sku' => 'BAT-01', 'name' => 'Phone battery', 'category_id' => $c->id, 'cost' => 1200, 'price' => 2500, 'minimum_stock' => 2]);
        $this->actingAs($this->admin);
        config(['sbm.sales_token' => str_repeat('s', 40), 'sbm.repair_token' => str_repeat('r', 40)]);
    }

    private function movement(array $extra = [])
    {
        return $this->postJson('/api/v1/movements', array_replace(['request_key' => (string) Str::uuid(), 'kind' => 'receipt', 'item_id' => $this->item->id, 'quantity' => 10, 'reason' => 'Received delivery', 'reference' => 'GRN-1'], $extra));
    }

    private function sale(array $extra = [])
    {
        return array_replace(['reference' => 'SALE-1', 'actor_reference' => 'cashier-1', 'reason' => 'Paid retail sale', 'payment_status' => 'paid', 'finalized' => true, 'items' => [['inventory_item_id' => (string) $this->item->id, 'quantity' => 2, 'line_id' => 'line-1']]], $extra);
    }

    private function integration(string $path, array $d, string $key = 'event-1')
    {
        return $this->withHeaders(['Authorization' => 'Bearer '.str_repeat('s', 40), 'Idempotency-Key' => $key])->postJson('/api/v1/'.$path, $d);
    }

    public function test_receipt_adjustment_and_ledger_reconcile()
    {
        $this->movement()->assertOk()->assertJsonPath('movements.0.balance', 10);
        $this->movement(['kind' => 'adjustment', 'counted_quantity' => 7, 'reference' => 'COUNT-1'])->assertOk()->assertJsonPath('movements.0.delta', -3);
        $this->assertSame(7, $this->item->fresh()->stock);
        $this->assertEquals(7, Movement::sum('delta'));
        $this->artisan('inventory:reconcile')->assertExitCode(0);
    }

    public function test_retry_and_conflicting_payload()
    {
        $key = (string) Str::uuid();
        $a = $this->movement(['request_key' => $key])->assertOk()->json();
        $this->movement(['request_key' => $key])->assertExactJson($a);
        $this->movement(['request_key' => $key, 'quantity' => 11])->assertStatus(409);
        $this->assertSame(1, Movement::count());
    }

    public function test_negative_and_fractional_quantities_rejected()
    {
        $this->movement(['kind' => 'manual_out'])->assertUnprocessable();
        $this->movement(['quantity' => 0])->assertUnprocessable();
        $this->movement(['quantity' => 1.5])->assertUnprocessable();
        $this->assertSame(0, Movement::count());
    }

    public function test_reversal_is_linked_and_cannot_repeat()
    {
        $id = $this->movement()->json('movements.0.id');
        $this->movement(['kind' => 'reversal', 'movement_id' => $id])->assertOk()->assertJsonPath('movements.0.delta', -10);
        $this->movement(['kind' => 'reversal', 'movement_id' => $id])->assertUnprocessable();
        $this->assertSame(0, $this->item->fresh()->stock);
        $this->assertDatabaseHas('movements', ['reverses_id' => $id]);
    }

    public function test_posted_history_is_database_immutable()
    {
        $id = $this->movement()->json('movements.0.id');
        $this->expectException(QueryException::class);
        DB::transaction(fn () => DB::table('movements')->where('id', $id)->update(['reason' => 'Changed']));
    }

    public function test_technician_assignment_permissions_and_cost_redaction()
    {
        $this->movement();
        $tech = User::create(['name' => 'Tech', 'email' => 'tech@example.test', 'password' => 'test-password-123', 'role' => 'technician']);
        RepairJob::create(['reference' => 'REP-1', 'technician_id' => $tech->id]);
        $this->actingAs($tech);
        $this->movement()->assertForbidden();
        $this->movement(['kind' => 'repair_usage', 'reference' => 'OTHER'])->assertForbidden();
        $this->movement(['kind' => 'repair_usage', 'reference' => 'REP-1', 'quantity' => 1])->assertOk();
        $this->getJson('/api/v1/items')->assertOk()->assertJsonMissingPath('data.0.cost');
        $this->getJson('/api/v1/movements')->assertJsonCount(1, 'data')->assertJsonMissingPath('data.0.unit_cost');
        $this->getJson('/api/v1/reports?kind=valuation')->assertForbidden();
    }

    public function test_paid_sale_retry_and_reference_deduplication()
    {
        $this->movement();
        $d = $this->sale();
        $a = $this->integration('stock/out', $d)->assertOk()->json();
        $this->integration('stock/out', $d)->assertExactJson($a);
        $this->integration('stock/out', $d, 'new-key')->assertExactJson($a);
        $this->assertSame(8, $this->item->fresh()->stock);
        $this->integration('stock/out', $this->sale(['actor_reference' => 'other']), 'new-key')->assertStatus(409);
    }

    public function test_unpaid_and_legacy_sales_rejected()
    {
        $this->movement();
        $this->integration('stock/out', $this->sale(['payment_status' => 'pending']))->assertUnprocessable();
        $d = $this->sale();
        unset($d['items'][0]['line_id']);
        $this->integration('stock/out', $d)->assertUnprocessable();
        $this->assertSame(10, $this->item->fresh()->stock);
    }

    public function test_multi_line_failure_rolls_back_everything()
    {
        $this->movement();
        $d = $this->sale();
        $d['items'][] = ['inventory_item_id' => $this->item->id, 'quantity' => 20, 'line_id' => 'line-2'];
        $this->integration('stock/out', $d)->assertUnprocessable();
        $this->assertSame(10, $this->item->fresh()->stock);
        $this->assertSame(1, Movement::count());
        $this->assertSame(1, Operation::count());
    }

    public function test_return_requires_acceptance_and_cannot_exceed_sale()
    {
        $this->movement();
        $this->integration('stock/out', $this->sale())->assertOk();
        $d = $this->sale(['reference' => 'RETURN-1', 'original_reference' => 'SALE-1', 'return_accepted' => true]);
        unset($d['payment_status'],$d['finalized']);
        $this->integration('stock/in', array_replace($d, ['return_accepted' => false]), 'return-1')->assertUnprocessable();
        $this->integration('stock/in', $d, 'return-1')->assertOk();
        $this->integration('stock/in', array_replace($d, ['reference' => 'RETURN-2']), 'return-2')->assertUnprocessable();
        $this->assertSame(10, $this->item->fresh()->stock);
    }

    public function test_integration_tokens_are_separate()
    {
        $this->withHeaders(['Authorization' => 'Bearer bad'])->getJson('/api/v1/products')->assertUnauthorized();
        $this->withHeaders(['Authorization' => 'Bearer '.str_repeat('r', 40)])->getJson('/api/v1/products')->assertUnauthorized();
    }

    public function test_catalogue_compatibility_search_and_cannot_overwrite_stock()
    {
        $phone = PhoneModel::create(['brand' => 'Apple', 'name' => 'iPhone 13']);
        $d = ['sku' => 'LCD-13', 'name' => 'Display', 'category_id' => $this->item->category_id, 'unit' => 'piece', 'cost' => 1000, 'price' => 2000, 'minimum_stock' => 3, 'active' => true, 'phone_model_ids' => [$phone->id], 'stock' => 999];
        $id = $this->postJson('/api/v1/items', $d)->assertCreated()->json('id');
        $this->assertDatabaseHas('items', ['id' => $id, 'stock' => 0]);
        $this->getJson('/api/v1/items?search=iPhone')->assertJsonCount(1, 'data');
        $this->postJson('/api/v1/items', $d)->assertUnprocessable();
    }

    public function test_reports_and_low_stock()
    {
        $this->getJson('/api/v1/items?status=low')->assertJsonCount(1, 'data');
        $this->movement();
        $this->getJson('/api/v1/items?status=low')->assertJsonCount(0, 'data');
        foreach (['current', 'low', 'movements', 'reasons', 'repairs', 'sales', 'valuation'] as $kind) {
            $this->getJson('/api/v1/reports?kind='.$kind)->assertOk();
        }$this->get('/api/v1/reports?kind=current&format=csv')->assertOk()->assertDownload('inventory-current.csv');
    }

    public function test_disabled_user_and_self_demotion()
    {
        $this->putJson('/api/v1/users/'.$this->admin->id, ['name' => 'Admin', 'email' => $this->admin->email, 'role' => 'technician', 'active' => true])->assertUnprocessable();
        $this->admin->update(['active' => false]);
        $this->getJson('/api/v1/items')->assertForbidden();
    }

    public function test_repair_event_keeps_job_reference_and_replays()
    {
        $this->movement();
        $data = ['reference' => 'USAGE-1', 'repair_job_reference' => 'REP-1', 'actor_reference' => 'tech-remote', 'reason' => 'Battery installed', 'items' => [['inventory_item_id' => $this->item->id, 'line_id' => 'usage-1', 'quantity' => 1]]];
        $this->withHeaders(['Authorization' => 'Bearer '.str_repeat('r', 40), 'Idempotency-Key' => 'usage-1']);
        $first = $this->postJson('/api/v1/repair/usage', $data)->assertOk()->json();
        $this->postJson('/api/v1/repair/usage', $data)->assertExactJson($first);
        $this->assertDatabaseHas('movements', ['repair_job_reference' => 'REP-1', 'source' => 'repair', 'reference' => 'USAGE-1']);
        $this->getJson('/api/v1/reports?kind=repairs&search=REP-1')->assertJsonCount(1, 'data');
    }

    public function test_date_filters_use_shop_midnight_and_utc_storage()
    {
        $this->movement(['occurred_at' => '2026-01-01T15:59:00Z']);
        $this->movement(['occurred_at' => '2026-01-01T16:01:00Z']);
        $this->getJson('/api/v1/movements?from=2026-01-02&to=2026-01-02')->assertJsonCount(1, 'data');
        $this->assertSame('UTC', DB::selectOne('SHOW timezone')->TimeZone);
    }

    public function test_reversing_sale_after_return_is_rejected()
    {
        $this->movement();
        $id = $this->integration('stock/out', $this->sale())->assertOk()->json('movements.0.id');
        $this->integration('stock/in', $this->sale(['reference' => 'RETURN-1', 'original_reference' => 'SALE-1', 'return_accepted' => true]), 'return-1')->assertOk();
        $this->movement(['kind' => 'reversal', 'movement_id' => $id])->assertUnprocessable();
    }

    public function test_login_logout_and_authentication()
    {
        auth()->forgetGuards();
        $this->getJson('/api/v1/items')->assertUnauthorized();
        $this->postJson('/api/v1/auth/login', ['email' => $this->admin->email, 'password' => 'wrong'])->assertUnprocessable();
        $this->postJson('/api/v1/auth/login', ['email' => $this->admin->email, 'password' => 'test-password-123'])->assertOk();
        $this->getJson('/api/v1/auth/me')->assertOk()->assertJsonMissingPath('password');
        $this->postJson('/api/v1/auth/logout')->assertNoContent();
    }
}
