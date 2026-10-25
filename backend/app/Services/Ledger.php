<?php

namespace App\Services;

use App\Models\Item;
use App\Models\ItemUnit;
use App\Models\Movement;
use App\Models\Operation;
use App\Models\RepairJob;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class Ledger
{
    private function canonical($v)
    {
        if (! is_array($v)) {
            return $v;
        }if (! array_is_list($v)) {
            ksort($v);
        }

        return array_map(fn ($x) => $this->canonical($x), $v);
    }

    public function post(array $data, string $source, ?int $actor = null): array
    {
        $fingerprint = hash('sha256', json_encode($this->canonical(array_diff_key($data, ['request_key' => true]))));

        try {
            return DB::transaction(function () use ($data, $source, $actor, $fingerprint) {
                // Serialize request keys and external references before checking replay; lock items in ID order.
                DB::select('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [$source.':'.$data['request_key']]);
                $external = $source !== 'inventory';
                if ($external) {
                    DB::select('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [$source.':'.$data['kind'].':'.$data['reference']]);
                }
                $existing = Operation::where('source', $source)->where(function ($q) use ($data, $external) {
                    $q->where('key', $data['request_key']);
                    if ($external) {
                        $q->orWhere(fn ($q) => $q->where('kind', $data['kind'])->where('reference', $data['reference']));
                    }
                })->first();
                if ($existing) {
                    abort_unless(hash_equals($existing->fingerprint, $fingerprint), 409, 'This request key or external reference was already used with different details.');

                    return $existing->response;
                }
                if ($data['kind'] === 'repair_usage' && $source === 'inventory') {
                    $job = RepairJob::where('reference', $data['reference'])->lockForUpdate()->first();
                    abort_unless($job && $job->active && (auth()->user()->role === 'admin' || $job->technician_id === $actor), 403, 'Use an active repair assigned to you.');
                }
                $reversal = null;
                if ($data['kind'] === 'reversal') {
                    $reversal = Movement::findOrFail($data['movement_id']);
                    $data['items'] = [['item_id' => $reversal->item_id, 'quantity' => $reversal->quantity]];
                }
                $ids = array_column($data['items'], 'item_id');
                $items = Item::whereIn('id', $ids)->orderBy('id')->lockForUpdate()->get()->keyBy('id');
                if ($reversal) {
                    abort_if($reversal->reverses_id || Movement::where('reverses_id', $reversal->id)->exists(), 422, 'This movement cannot be reversed again.');
                }
                if ($reversal && $reversal->type === 'sale') {
                    $returned = Movement::where('original_reference', $reversal->reference)->where('item_id', $reversal->item_id)->sum('delta');
                    abort_if($returned > 0, 422, 'This sale has accepted returns. Reverse the return first or record an audited adjustment.');
                }
                $op = Operation::create(['source' => $source, 'key' => $data['request_key'], 'fingerprint' => $fingerprint, 'kind' => $data['kind'], 'reference' => $external ? $data['reference'] : null]);
                $result = [];
                foreach ($data['items'] as $row) {
                    $item = $items->get($row['item_id']);
                    abort_unless($item, 422, 'Unknown inventory item.');
                    $costs = app(StockCosts::class);
                    $costs->initialize($item);
                    abort_if(! $item->active && ! in_array($data['kind'], ['reversal', 'return']), 422, 'This item is inactive.');
                    if ($data['kind'] === 'return') {
                        $sold = Movement::where('source', 'sales')->where('type', 'sale')->where('reference', $data['original_reference'])->where('item_id', $item->id)->get();
                        $issued = $sold->sum('quantity') - Movement::whereIn('reverses_id', $sold->pluck('id'))->sum('quantity');
                        $returned = Movement::where('original_reference', $data['original_reference'])->where('item_id', $item->id)->sum('delta');
                        abort_if($returned + $row['quantity'] > $issued, 422, 'Returned quantity exceeds the original sale quantity still eligible for return.');
                    }
                    $delta = match ($data['kind']) {
                        'receipt','return' => (int) $row['quantity'],'adjustment' => (int) $data['counted_quantity'] - $item->stock,'reversal' => -$reversal->delta,default => -(int) $row['quantity']
                    };
                    if ($delta === 0) {
                        throw ValidationException::withMessages(['counted_quantity' => 'The counted quantity matches the current balance.']);
                    }
                    if ($item->stock + $delta < 0) {
                        throw ValidationException::withMessages(['stock' => 'Insufficient stock for '.$item->sku.'. Available: '.$item->stock.'.']);
                    }
                    if ($item->stock + $delta > 100000000) {
                        throw ValidationException::withMessages(['stock' => 'Stock quantity exceeds the supported limit.']);
                    }
                    $unitCost = (int) ($row['unit_cost'] ?? $data['unit_cost'] ?? $item->cost);
                    $serialText = $row['serials'] ?? $data['serials'] ?? null;
                    if ($item->serial_tracking) {
                        if (abs($delta) > 1000) {
                            throw ValidationException::withMessages(['quantity' => 'Record at most 1,000 serialized units per line.']);
                        }
                        if ($reversal) {
                            $serialText = ItemUnit::whereIn('id', DB::table('movement_units')->where('movement_id', $reversal->id)->pluck('item_unit_id'))->orderBy('id')->pluck('serial_number')->implode("\n");
                        } elseif ($delta > 0 && $data['kind'] !== 'return' && ! UnitSerials::parse($serialText)) {
                            $serialText = implode("\n", array_map(fn () => UnitSerials::generate($unitCost, $data['supplier_id'] ?? null), range(1, $delta)));
                        }
                    }
                    $m = new Movement(['item_id' => $item->id, 'operation_id' => $op->id, 'type' => $data['kind'], 'quantity' => abs($delta), 'delta' => $delta, 'balance_before' => $item->stock, 'balance_after' => $item->stock + $delta, 'reason' => $data['reason'], 'source' => $source, 'reference' => $reversal?->reference ?? $data['reference'] ?? null, 'repair_job_reference' => $data['repair_job_reference'] ?? ($data['kind'] === 'repair_usage' ? ($data['reference'] ?? null) : null), 'original_reference' => $reversal?->original_reference ?? $data['original_reference'] ?? null, 'line_id' => $row['line_id'] ?? null, 'actor_id' => $actor, 'actor_reference' => $data['actor_reference'] ?? null, 'supplier_id' => $data['supplier_id'] ?? null, 'brand' => $reversal?->brand ?? ($data['kind'] === 'receipt' ? ($row['brand'] ?? $data['brand'] ?? null) : null), 'unit_cost' => $unitCost, 'batch' => $row['batch'] ?? $data['batch'] ?? null, 'serials' => $serialText, 'approval_note' => $data['approval_note'] ?? null, 'reverses_id' => $reversal?->id, 'occurred_at' => $data['occurred_at'] ?? now(), 'created_at' => now()]);
                    $plan = $costs->plan($item, $m, $reversal);
                    $unitCosts = array_unique(array_map(fn ($a) => $a['batch']->unit_cost, $plan));
                    $m->unit_cost = count($unitCosts) === 1 ? reset($unitCosts) : null;
                    $m->save();
                    app(UnitSerials::class)->apply($item, $m, $serialText, $reversal);
                    $costs->apply($item, $m, $plan);
                    $item->stock += $delta;
                    $item->save();
                    $result[] = ['id' => $m->id, 'item_id' => $item->id, 'line_id' => $m->line_id, 'delta' => $delta, 'balance' => $item->stock, 'serials' => $m->serials];
                }
                $response = ['acknowledged' => true, 'reference' => 'INV-'.str_pad((string) $op->id, 8, '0', STR_PAD_LEFT), 'movements' => $result];
                $op->update(['response' => $response]);
                Audit::record('stock.'.$data['kind'], (string) $op->id, ['reference' => $data['reference'] ?? null, 'movements' => $result], $source);

                return $response;
            }, 5);
        } catch (UniqueConstraintViolationException $e) {
            if (str_contains($e->getMessage(), 'item_units_serial_number_unique')) {
                throw ValidationException::withMessages(['serials' => 'A serial number is already registered. Serial numbers must be unique in this store.']);
            }
            throw $e;
        }
    }
}
