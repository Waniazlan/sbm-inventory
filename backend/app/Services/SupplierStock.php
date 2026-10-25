<?php

namespace App\Services;

use App\Models\Item;
use App\Models\ItemUnit;
use App\Models\Operation;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class SupplierStock
{
    private function batches(Item $item): Collection
    {
        return $item->batches()->withBrand()->with('supplier:id,name')
            ->where('remaining_quantity', '>', 0)->orderBy('stock_batches.id')->get();
    }

    private function version(Collection $batches): string
    {
        return hash('sha256', json_encode($batches->map(fn ($batch) => [
            $batch->id, $batch->supplier_id, $batch->effective_brand, $batch->remaining_quantity, $batch->unit_cost,
        ])->values()->all()));
    }

    public function summary(Item $item, bool $admin): Collection
    {
        return $this->batches($item)->groupBy(fn ($batch) => $batch->supplier_id ?? 'unknown')
            ->sortBy(fn ($batches) => $batches->first()->supplier_id ?? PHP_INT_MAX)
            ->map(fn ($batches) => [
                'supplier_id' => $batches->first()->supplier_id,
                'supplier_name' => $batches->first()->supplier?->name,
                'quantity' => (int) $batches->sum('remaining_quantity'),
                'brands' => $batches->groupBy(fn ($batch) => json_encode($batch->effective_brand))
                    ->sortBy(fn ($group) => $group->first()->effective_brand ?? "\xff")
                    ->map(fn ($group) => [
                        'brand' => $group->first()->effective_brand,
                        'quantity' => (int) $group->sum('remaining_quantity'),
                    ] + ($admin ? ['edit_token' => $this->version($group), 'latest_unit_cost' => $group->last()->unit_cost] : []))->values(),
            ])->values();
    }

    public function edit(Item $item, array $data, int $actor): array
    {
        $fingerprint = hash('sha256', json_encode([
            $item->id, $actor, $data['supplier_id'], $data['original_brand'], $data['brand'],
            $data['edit_token'], $data['counted_quantity'], $data['reason'], $data['serials'] ?? null,
        ]));

        return DB::transaction(function () use ($item, $data, $actor, $fingerprint) {
            DB::select('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', ['inventory:'.$data['request_key']]);
            $existing = Operation::where('source', 'inventory')->where('key', $data['request_key'])->first();
            if ($existing) {
                abort_unless(hash_equals($existing->fingerprint, $fingerprint), 409, 'This request key was already used with different details.');

                return $existing->response;
            }
            $item = Item::whereKey($item->id)->lockForUpdate()->firstOrFail();
            abort_unless($item->active, 422, 'This item is inactive.');
            $batches = $this->batches($item)->filter(fn ($batch) => $batch->supplier_id === $data['supplier_id'] && $batch->effective_brand === $data['original_brand']);
            abort_unless($batches->isNotEmpty() && hash_equals($this->version($batches), $data['edit_token']), 409, 'This stock has changed. Reload the product details before editing again.');
            $before = (int) $batches->sum('remaining_quantity');
            $delta = $data['counted_quantity'] - $before;
            abort_if($delta === 0 && $data['brand'] === $data['original_brand'], 422, 'Change the brand or on-hand quantity before saving.');
            if ($item->serial_tracking && $delta < 0) {
                $serials = UnitSerials::parse($data['serials'] ?? null);
                $matching = ItemUnit::where('item_id', $item->id)->whereIn('stock_batch_id', $batches->pluck('id'))
                    ->where('in_stock', true)->whereIn('serial_number', $serials)->count();
                abort_unless(count($serials) === -$delta && $matching === -$delta, 422, 'Identify one missing serial per removed unit from this supplier and brand.');
            } else {
                abort_if(! empty($data['serials']), 422, 'Serials are only needed when reducing serialized stock.');
            }
            $op = Operation::create(['source' => 'inventory', 'key' => $data['request_key'], 'fingerprint' => $fingerprint, 'kind' => 'supplier_stock_edit']);
            if ($data['brand'] !== $data['original_brand']) {
                foreach ($batches as $batch) {
                    $batch->update(['brand_corrected' => true, 'brand_override' => $data['brand']]);
                }
            }
            $adjustment = null;
            if ($delta !== 0) {
                $adjustment = app(Ledger::class)->post([
                    'request_key' => $data['request_key'].':quantity', 'kind' => 'adjustment',
                    'items' => [['item_id' => $item->id, 'quantity' => 1]],
                    'counted_quantity' => $item->stock + $delta,
                    'supplier_id' => $data['supplier_id'], 'brand' => $data['brand'],
                    'unit_cost' => $batches->last()->unit_cost, 'stock_batch_ids' => $batches->pluck('id')->all(),
                    'serials' => $data['serials'] ?? null,
                    'reference' => 'CATALOGUE-EDIT-'.$op->id, 'reason' => $data['reason'], 'actor_reference' => 'user:'.$actor,
                ], 'inventory', $actor);
            }
            Audit::record('supplier_stock.updated', (string) $item->id, [
                'supplier_id' => $data['supplier_id'], 'batch_ids' => $batches->pluck('id')->all(),
                'before' => ['brand' => $data['original_brand'], 'quantity' => $before],
                'after' => ['brand' => $data['brand'], 'quantity' => $data['counted_quantity']],
                'reason' => $data['reason'], 'adjustment' => $adjustment,
            ]);
            $response = ['acknowledged' => true, 'adjustment' => $adjustment];
            $op->update(['response' => $response]);

            return $response;
        }, 5);
    }
}
