<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\Item;
use App\Models\Movement;
use App\Services\Ledger;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Symfony\Component\Process\Process;
use Tests\TestCase;

class ConcurrencyTest extends TestCase
{
    use DatabaseMigrations;

    public function test_concurrent_sales_cannot_overissue_and_duplicate_event_posts_once(): void
    {
        $category = Category::create(['name' => 'Concurrency']);
        $item = Item::create(['sku' => 'LOCK-1', 'name' => 'Lock test', 'category_id' => $category->id]);
        app(Ledger::class)->post(['request_key' => 'opening', 'kind' => 'receipt', 'reference' => 'OPEN', 'reason' => 'Test opening', 'items' => [['item_id' => $item->id, 'quantity' => 5]]], 'inventory');
        $run = function (array $payloads) {
            $processes = [];
            $db = config('database.connections.pgsql');
            foreach ($payloads as $data) {
                $p = new Process([PHP_BINARY, base_path('../scripts/concurrency-worker.php'), json_encode($data)], base_path(), ['APP_ENV' => 'testing', 'DB_DATABASE' => 'sbm_inventory_test', 'DB_HOST' => $db['host'], 'DB_PORT' => (string) $db['port'], 'DB_USERNAME' => $db['username'], 'DB_PASSWORD' => $db['password'] ?? '', 'APP_KEY' => config('app.key')]);
                $p->start();
                $processes[] = $p;
            }foreach ($processes as $p) {
                $p->wait();
            }

            return $processes;
        };
        $payload = fn ($ref) => ['request_key' => $ref, 'kind' => 'sale', 'reference' => $ref, 'actor_reference' => 'test-cashier', 'reason' => 'Concurrency test', 'items' => [['item_id' => $item->id, 'quantity' => 4, 'line_id' => '1']]];
        $p = $run([$payload('SALE-A'), $payload('SALE-B')]);
        $codes = array_map(fn ($p) => $p->getExitCode(), $p);
        sort($codes);
        $this->assertSame([0, 2], $codes, implode('\n', array_map(fn ($p) => $p->getErrorOutput(), $p)));
        $this->assertSame(1, $item->fresh()->stock);
        $retry = $payload('SALE-C');
        $retry['items'][0]['quantity'] = 1;
        $p = $run([$retry, $retry]);
        foreach ($p as $process) {
            $this->assertSame(0, $process->getExitCode(), $process->getErrorOutput());
        }$this->assertJsonStringEqualsJsonString($p[0]->getOutput(), $p[1]->getOutput());
        $this->assertSame(0, $item->fresh()->stock);
        $this->assertSame(3, Movement::count());
    }
}
