<?php

namespace App\Services;

use App\Models\CostAllocation;
use App\Models\Item;
use App\Models\ItemUnit;
use App\Models\Movement;
use App\Models\StockBatch;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class StockCosts
{
    // Every caller holds the item lock and uses the same transaction as the ledger.
    public function initialize(Item $item): void
    {
        if ($item->stock > 0 && ! $item->batches()->exists() && ! $item->movements()->exists()) {
            $this->opening($item, $item->stock);
        }
    }

    private function opening(Item $item, int $quantity): void
    {
        StockBatch::create(['item_id' => $item->id, 'supplier_id' => $item->supplier_id, 'reference' => 'Opening stock without receipt history', 'cost_source' => 'opening_standard_cost', 'unit_cost' => $item->cost, 'quantity' => $quantity, 'remaining_quantity' => $quantity, 'received_at' => $item->created_at ?? now()]);
    }

    public function plan(Item $item, Movement $movement, ?Movement $reversal = null, ?array $batchIds = null, ?array $batchQuantities = null): array
    {
        if ($reversal) {
            $plan = $reversal->costAllocations()->with('batch')->orderBy('id')->get()->map(fn ($a) => ['batch' => $a->batch, 'quantity' => -$a->quantity, 'return_of_id' => $a->return_of_id])->all();
            if (array_sum(array_column($plan, 'quantity')) !== $movement->delta) {
                $this->fail('The original movement has no complete batch allocation.');
            }

            return $plan;
        }

        if ($movement->delta > 0 && $movement->type !== 'return') {
            $batch = StockBatch::create(['item_id' => $item->id, 'receipt_movement_id' => $movement->exists ? $movement->id : null, 'supplier_id' => $movement->supplier_id, 'reference' => $movement->reference, 'batch' => $movement->batch, 'cost_source' => $movement->type === 'receipt' ? 'receipt' : 'adjustment', 'unit_cost' => $movement->unit_cost ?? $item->cost, 'quantity' => $movement->quantity, 'remaining_quantity' => 0, 'received_at' => $movement->occurred_at]);

            return [['batch' => $batch, 'quantity' => $movement->quantity, 'return_of_id' => null]];
        }

        $units = $this->units($item, $movement);
        if ($movement->type === 'return') {
            return $this->returned($item, $movement, $units);
        }

        $frozen = StockAvailability::reservedByBatch($item->id);
        if ($batchQuantities !== null) {
            $plan = [];
            foreach ($batchQuantities as $id => $quantity) {
                $batch = StockBatch::where('item_id', $item->id)->findOrFail($id);
                if ($quantity < 1 || $quantity > $batch->remaining_quantity - ($frozen[$id] ?? 0)) {
                    $this->fail('The frozen batch quantities are no longer available.');
                }
                $plan[] = ['batch' => $batch, 'quantity' => -(int) $quantity, 'return_of_id' => null];
            }
            if (array_sum(array_column($plan, 'quantity')) !== $movement->delta) {
                $this->fail('Frozen quantities do not match this return.');
            }

            return $plan;
        }

        $plan = [];
        $remaining = $movement->quantity;
        // A scanned physical unit always takes its own batch, even if it is newer.
        foreach ($units->whereNotNull('stock_batch_id')->groupBy('stock_batch_id') as $id => $group) {
            if ($batchIds !== null && ! in_array($id, $batchIds)) {
                $this->fail('The selected serial belongs to a different supplier or brand.');
            }
            $batch = StockBatch::where('item_id', $item->id)->findOrFail($id);
            $plan[$id] = ['batch' => $batch, 'quantity' => -$group->count(), 'return_of_id' => null];
            $remaining -= $group->count();
        }
        // FIFO follows posting order; backdated paperwork must not rewrite previous costs.
        foreach ($item->batches()->where('remaining_quantity', '>', 0)->when($batchIds !== null, fn ($q) => $q->whereIn('id', $batchIds))->orderBy('id')->get() as $batch) {
            $reserved = isset($plan[$batch->id]) ? -$plan[$batch->id]['quantity'] : 0;
            $take = min($remaining, $batch->remaining_quantity - ($frozen[$batch->id] ?? 0) - $reserved);
            if ($take > 0) {
                $plan[$batch->id] = ['batch' => $batch, 'quantity' => -($reserved + $take), 'return_of_id' => null];
                $remaining -= $take;
            }
            if ($remaining === 0) {
                break;
            }
        }
        if ($remaining !== 0) {
            $this->fail('Available batch quantities do not cover this stock movement. Frozen stock cannot be used.');
        }

        return array_values($plan);
    }

    private function returned(Item $item, Movement $movement, Collection $units): array
    {
        $sold = CostAllocation::with('batch')->whereHas('movement', fn ($q) => $q->where('item_id', $item->id)->where('source', 'sales')->where('type', 'sale')->where('reference', $movement->original_reference)->whereDoesntHave('reversal'))->orderBy('id')->get();
        $required = $units->whereNotNull('stock_batch_id')->groupBy('stock_batch_id')->map->count()->all();
        $unassigned = $movement->quantity - array_sum($required);
        $plan = [];
        foreach ($sold as $allocation) {
            $available = -$allocation->quantity - (int) CostAllocation::where('return_of_id', $allocation->id)->sum('quantity');
            $id = $allocation->stock_batch_id;
            $specific = min($available, $required[$id] ?? 0);
            $take = $specific + min($available - $specific, $unassigned);
            if ($take > 0) {
                $required[$id] = ($required[$id] ?? 0) - $specific;
                $unassigned -= $take - $specific;
                $plan[] = ['batch' => $allocation->batch, 'quantity' => $take, 'return_of_id' => $allocation->id];
            }
        }
        if ($unassigned !== 0 || array_sum($required) !== 0) {
            $this->fail('The original sale has insufficient batch quantities available for return.');
        }

        return $plan;
    }

    public function apply(Item $item, Movement $movement, array $plan): void
    {
        $frozen = StockAvailability::reservedByBatch($item->id);
        foreach ($plan as $row) {
            $batch = StockBatch::findOrFail($row['batch']->id);
            $remaining = $batch->remaining_quantity + $row['quantity'];
            if (($frozen[$batch->id] ?? 0) > 0 && $remaining < $frozen[$batch->id]) {
                $this->fail('This movement would use stock frozen for a Process supplier return.');
            }
            if ($remaining < 0 || $remaining > $batch->quantity) {
                $this->fail('This batch has later stock movements. Reverse those movements first.');
            }
            $batch->remaining_quantity = $remaining;
            if ($movement->delta > 0 && ! $movement->reverses_id && $movement->type !== 'return') {
                $batch->receipt_movement_id = $movement->id;
            }
            $batch->save();
            $movement->costAllocations()->create(['stock_batch_id' => $batch->id, 'quantity' => $row['quantity'], 'unit_cost' => $batch->unit_cost, 'return_of_id' => $row['return_of_id']]);
        }
        $this->bindUnits($this->units($item, $movement), $plan);
    }

    private function units(Item $item, Movement $movement): Collection
    {
        if ($movement->exists) {
            return ItemUnit::whereIn('id', DB::table('movement_units')->where('movement_id', $movement->id)->select('item_unit_id'))->orderBy('id')->get();
        }

        return $item->serial_tracking ? ItemUnit::where('item_id', $item->id)->whereIn('serial_number', UnitSerials::parse($movement->serials))->orderBy('id')->get() : collect();
    }

    private function bindUnits(Collection $units, array $plan): void
    {
        $available = [];
        foreach ($plan as $row) {
            $id = $row['batch']->id;
            $available[$id] = ($available[$id] ?? 0) + abs($row['quantity']);
        }
        foreach ($units->whereNotNull('stock_batch_id') as $unit) {
            $available[$unit->stock_batch_id] = ($available[$unit->stock_batch_id] ?? 0) - 1;
        }
        foreach ($units->whereNull('stock_batch_id') as $unit) {
            foreach ($available as $id => $count) {
                if ($count > 0) {
                    $unit->update(['stock_batch_id' => $id]);
                    $available[$id]--;

                    continue 2;
                }
            }
            $this->fail('A unit could not be linked to its stock batch.');
        }
    }

    public function assignExistingUnits(Item $item): void
    {
        $plan = [];
        foreach ($item->batches()->where('remaining_quantity', '>', 0)->orderBy('id')->get() as $batch) {
            $plan[] = ['batch' => $batch, 'quantity' => $batch->remaining_quantity];
        }
        $this->bindUnits(ItemUnit::where('item_id', $item->id)->where('in_stock', true)->orderBy('id')->get(), $plan);
    }

    public function backfill(): void
    {
        foreach (Item::withTrashed()->orderBy('id')->cursor() as $item) {
            $first = $item->movements()->orderBy('id')->first();
            $opening = $first ? $first->balance_before : $item->stock;
            if ($opening > 0) {
                $this->opening($item, $opening);
            }
            foreach ($item->movements()->orderBy('id')->cursor() as $movement) {
                $plan = $this->plan($item, $movement, $movement->reverses_id ? Movement::findOrFail($movement->reverses_id) : null);
                $this->apply($item, $movement, $plan);
            }
            if ((int) $item->batches()->sum('remaining_quantity') !== $item->stock) {
                $this->fail('Historical batch quantities do not match stock for '.$item->sku.'.');
            }
            $this->assignExistingUnits($item);
        }
    }

    private function fail(string $message): never
    {
        throw ValidationException::withMessages(['stock' => $message]);
    }
}
