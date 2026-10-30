<?php

namespace App\Services;

use App\Models\Item;
use App\Models\ItemUnit;
use App\Models\Movement;
use App\Models\StockReservation;
use App\Models\SupplierReturn;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class SupplierReturns
{
    public function create(array $data, int $actor): SupplierReturn
    {
        $data += ['status' => 'process', 'reference' => null, 'serials' => null];
        $details = array_intersect_key($data, array_flip(['item_id', 'supplier_id', 'quantity', 'status', 'reference', 'reason', 'serials']));
        ksort($details);
        $fingerprint = hash('sha256', json_encode([$actor, $details]));

        return DB::transaction(function () use ($data, $details, $fingerprint, $actor) {
            DB::select('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', ['supplier-return:'.$data['request_key']]);
            $existing = SupplierReturn::where('request_key', $data['request_key'])->first();
            if ($existing) {
                abort_unless(hash_equals($existing->fingerprint, $fingerprint), 409, 'This request key was already used with different return details.');

                return $existing;
            }
            $item = Item::whereKey($data['item_id'])->lockForUpdate()->firstOrFail();
            abort_unless($item->active, 422, 'This item is inactive.');
            $return = SupplierReturn::create($details + ['request_key' => $data['request_key'], 'fingerprint' => $fingerprint, 'stock_movement_id' => null, 'created_by' => $actor, 'updated_by' => $actor]);
            $this->reserve($return, $item);
            if ($return->status !== 'process') {
                $this->deduct($return, $actor);
            }
            Audit::record('supplier_return.created', (string) $return->id, ['status' => $return->status, 'item_id' => $item->id, 'supplier_id' => $return->supplier_id, 'quantity' => $return->quantity]);

            return $return;
        }, 5);
    }

    public function update(SupplierReturn $return, array $data, int $actor): SupplierReturn
    {
        return DB::transaction(function () use ($return, $data, $actor) {
            $return = SupplierReturn::whereKey($return->id)->lockForUpdate()->firstOrFail();
            if ($return->status === $data['status']) {
                return $return;
            }
            abort_unless($return->status === $data['expected_status'], 409, 'This return has changed. Refresh the table before updating its status.');
            $before = $return->status;
            $item = Item::withTrashed()->whereKey($return->item_id)->lockForUpdate()->firstOrFail();
            if ($data['status'] === 'process') {
                $this->restore($return, $actor);
                $this->reserve($return, $item->refresh());
            } elseif ($before === 'process') {
                $this->deduct($return, $actor);
            }
            $return->status = $data['status'];
            $return->updated_by = $actor;
            $return->save();
            Audit::record('supplier_return.status_updated', (string) $return->id, ['before' => $before, 'status' => $return->status]);

            return $return;
        }, 5);
    }

    private function reserve(SupplierReturn $return, Item $item): void
    {
        abort_if($item->trashed(), 422, 'This item has been deleted and cannot be processed.');
        $costs = app(StockCosts::class);
        $costs->initialize($item);
        $frozen = StockAvailability::reservedByBatch($item->id);
        $batches = $item->batches()->where('supplier_id', $return->supplier_id)->where('remaining_quantity', '>', 0)->orderBy('id')->get();
        $available = $batches->sum(fn ($batch) => $batch->remaining_quantity - ($frozen[$batch->id] ?? 0));
        if ($return->quantity > $available) {
            throw ValidationException::withMessages(['quantity' => 'Insufficient available stock from this supplier. Available: '.$available.'. Frozen stock cannot be used.']);
        }
        $units = collect();
        if ($item->serial_tracking) {
            $serials = UnitSerials::parse($return->serials);
            $units = ItemUnit::available()->where('item_id', $item->id)->whereIn('serial_number', $serials)->whereIn('stock_batch_id', $batches->pluck('id'))->orderBy('id')->get();
            if ($return->quantity > 1000 || count($serials) !== $return->quantity || $units->count() !== $return->quantity) {
                throw ValidationException::withMessages(['serials' => 'Enter exactly one available, unfrozen serial from this supplier per returned unit, up to 1,000 units.']);
            }
        }
        $movement = new Movement(['item_id' => $item->id, 'type' => 'supplier_return', 'quantity' => $return->quantity, 'delta' => -$return->quantity, 'serials' => $return->serials]);
        $plan = $costs->plan($item, $movement, null, $batches->pluck('id')->all());
        foreach ($plan as $row) {
            $base = ['supplier_return_id' => $return->id, 'item_id' => $item->id, 'stock_batch_id' => $row['batch']->id, 'created_at' => now()];
            if ($item->serial_tracking) {
                foreach ($units->where('stock_batch_id', $row['batch']->id) as $unit) {
                    StockReservation::create($base + ['item_unit_id' => $unit->id, 'quantity' => 1]);
                }
            } else {
                StockReservation::create($base + ['quantity' => -$row['quantity']]);
            }
        }
    }

    private function deduct(SupplierReturn $return, int $actor): void
    {
        $reservations = StockReservation::active()->where('supplier_return_id', $return->id)->get();
        abort_unless($reservations->sum('quantity') === $return->quantity, 422, 'The return has no complete stock reservation.');
        $quantities = $reservations->groupBy('stock_batch_id')->map->sum('quantity')->all();
        StockReservation::active()->where('supplier_return_id', $return->id)->update(['released_at' => now()]);
        $result = app(Ledger::class)->post([
            'request_key' => (string) Str::uuid(), 'kind' => 'supplier_return',
            'reference' => 'SR-'.str_pad((string) $return->id, 6, '0', STR_PAD_LEFT),
            'reason' => $return->reason, 'supplier_id' => $return->supplier_id,
            'stock_batch_quantities' => $quantities, 'actor_reference' => 'user:'.$actor,
            'items' => [['item_id' => $return->item_id, 'quantity' => $return->quantity, 'serials' => $return->serials]],
        ], 'inventory', $actor);
        $return->stock_movement_id = $result['movements'][0]['id'];
        $return->save();
    }

    private function restore(SupplierReturn $return, int $actor): void
    {
        abort_unless($return->stock_movement_id, 422, 'The return has no stock deduction to reopen.');
        app(Ledger::class)->post([
            'request_key' => (string) Str::uuid(), 'kind' => 'reversal', 'movement_id' => $return->stock_movement_id,
            'reason' => 'Supplier return SR-'.str_pad((string) $return->id, 6, '0', STR_PAD_LEFT).' reopened as Process; stock frozen',
            'supplier_id' => $return->supplier_id, 'actor_reference' => 'user:'.$actor,
        ], 'inventory', $actor);
        $return->stock_movement_id = null;
        $return->save();
    }

    public function upgradeLegacy(): void
    {
        DB::transaction(function () {
            foreach (SupplierReturn::orderBy('id')->lockForUpdate()->get() as $return) {
                $item = Item::withTrashed()->whereKey($return->item_id)->lockForUpdate()->firstOrFail();
                if ($return->status === 'process') {
                    if ($return->stock_movement_id) {
                        $this->restore($return, $return->updated_by);
                        $item->refresh();
                    }
                    $this->reserve($return, $item);
                } elseif (! $return->stock_movement_id) {
                    $this->reserve($return, $item);
                    $this->deduct($return, $return->updated_by);
                }
                Audit::record('supplier_return.stock_rules_upgraded', (string) $return->id, ['status' => $return->status, 'quantity' => $return->quantity]);
            }
        }, 5);
    }
}
