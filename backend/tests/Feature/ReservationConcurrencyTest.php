<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\Item;
use App\Models\ItemUnit;
use App\Models\Supplier;
use App\Models\SupplierReturn;
use App\Models\User;
use App\Services\Ledger;
use App\Services\StockAvailability;
use App\Services\SupplierReturns;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Str;
use Symfony\Component\Process\Process;
use Tests\TestCase;

class ReservationConcurrencyTest extends TestCase
{
    use DatabaseMigrations;

    public function test_sale_and_supplier_reservation_cannot_take_the_same_unit_concurrently(): void
    {
        $actor = User::create(['name' => 'Race admin', 'email' => 'reserve-race@example.test', 'password' => 'test-password', 'role' => 'admin']);
        $supplier = Supplier::create(['name' => 'Race supplier']);
        $item = Item::create(['name' => 'Race unit', 'category_id' => Category::create(['name' => 'Race category'])->id, 'serial_tracking' => true]);
        app(Ledger::class)->post(['request_key' => 'race-receipt', 'kind' => 'receipt', 'supplier_id' => $supplier->id, 'reason' => 'Race receipt', 'serials' => 'RACE-UNIT', 'items' => [['item_id' => $item->id, 'quantity' => 1]]], 'inventory');
        $payloads = [
            ['action' => 'reserve', 'actor' => $actor->id, 'payload' => ['request_key' => (string) Str::uuid(), 'item_id' => $item->id, 'supplier_id' => $supplier->id, 'quantity' => 1, 'serials' => 'RACE-UNIT', 'reason' => 'Reserve race unit']],
            ['action' => 'sale', 'payload' => ['request_key' => 'race-sale', 'kind' => 'sale', 'reference' => 'race-sale', 'reason' => 'Sell race unit', 'serials' => 'RACE-UNIT', 'items' => [['item_id' => $item->id, 'quantity' => 1]]]],
        ];
        $db = config('database.connections.pgsql');
        $processes = [];
        foreach ($payloads as $payload) {
            $process = new Process([PHP_BINARY, base_path('tests/fixtures/reservation-worker.php'), json_encode($payload)], base_path(), ['APP_ENV' => 'testing', 'DB_DATABASE' => 'sbm_inventory_test', 'DB_URL' => '', 'DB_HOST' => $db['host'], 'DB_PORT' => (string) $db['port'], 'DB_USERNAME' => $db['username'], 'DB_PASSWORD' => $db['password'] ?? '', 'APP_KEY' => config('app.key')]);
            $process->start();
            $processes[] = $process;
        }
        foreach ($processes as $process) {
            $process->wait();
        }
        $codes = array_map(fn ($process) => $process->getExitCode(), $processes);
        sort($codes);
        $this->assertSame([0, 2], $codes, implode("\n", array_map(fn ($process) => $process->getErrorOutput(), $processes)));
        $this->assertSame($item->fresh()->stock, StockAvailability::reserved($item->fresh()));
        $this->assertSame(0, StockAvailability::available($item->fresh()));
        $return = SupplierReturn::first();
        if ($return) {
            $this->assertTrue(ItemUnit::firstOrFail()->in_stock);
            app(SupplierReturns::class)->update($return, ['expected_status' => 'process', 'status' => 'delivered'], $actor->id);
        }
        $this->assertSame(0, $item->fresh()->stock);
        $this->artisan('inventory:reconcile')->assertExitCode(0);
    }
}
