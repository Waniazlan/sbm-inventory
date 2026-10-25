<?php

namespace App\Services;

use App\Models\Item;
use App\Models\ItemUnit;
use App\Models\Movement;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class UnitSerials
{
    public static function barcode(): string
    {
        do {
            $number = DB::selectOne("SELECT nextval('inventory_barcode_seq') AS number")->number;
            $barcode = sprintf('SBM-P-%08d', $number);
        } while (Item::where('barcode', $barcode)->exists() || ItemUnit::where('serial_number', $barcode)->exists());

        return $barcode;
    }

    public static function create(Item $item, int $unitCost, ?int $supplierId, ?string $serial = null): ItemUnit
    {
        return ItemUnit::create(['item_id' => $item->id, 'serial_number' => $serial ?? self::generate($unitCost, $supplierId)]);
    }

    public static function generate(int $unitCost, ?int $supplierId): string
    {
        do {
            $number = DB::selectOne("SELECT nextval('inventory_unit_serial_seq') AS number")->number;
            $serial = sprintf('SN-%010d-%d-%d', $number, $unitCost, $supplierId ?? 0);
        } while (ItemUnit::where('serial_number', $serial)->exists() || Item::where('barcode', $serial)->exists());

        return $serial;
    }

    public static function parse(?string $text): array
    {
        $serials = array_values(array_filter(array_map('trim', preg_split('/\r\n|\r|\n/', $text ?? '')), fn ($s) => $s !== ''));
        if (count(array_unique($serials)) !== count($serials)) {
            throw ValidationException::withMessages(['serials' => 'Each unit must have a different serial number.']);
        }
        foreach ($serials as $serial) {
            if (! preg_match('/\A[^\x00-\x1F\x7F-\x9F]{1,120}\z/u', $serial)) {
                throw ValidationException::withMessages(['serials' => 'Use one serial per line, up to 120 printable characters each.']);
            }
        }

        return $serials;
    }

    // The caller holds the product lock; stock and unit changes commit together.
    public function apply(Item $item, Movement $movement, ?string $text, ?Movement $reversal): ?string
    {
        if (! $item->serial_tracking) {
            return $text;
        }
        $quantity = $movement->quantity;
        if ($quantity > 1000) {
            throw ValidationException::withMessages(['quantity' => 'Record at most 1,000 serialized units per line.']);
        }
        if ($reversal) {
            $units = ItemUnit::whereIn('id', DB::table('movement_units')->where('movement_id', $reversal->id)->pluck('item_unit_id'))->orderBy('id')->lockForUpdate()->get();
            if ($units->count() !== $quantity || $units->contains(fn ($u) => $u->last_movement_id !== $reversal->id)) {
                throw ValidationException::withMessages(['serials' => 'These units have later movements or predate serial tracking. Reverse their later movements first.']);
            }
        } else {
            $serials = self::parse($text);
            if ($movement->delta > 0 && $movement->type !== 'return') {
                if ($serials && count($serials) !== $quantity) {
                    throw ValidationException::withMessages(['serials' => 'Enter one serial per unit, or leave all serials blank to generate them.']);
                }
                $orderedSerials = $serials;
                sort($orderedSerials, SORT_STRING);
                foreach ($orderedSerials as $serial) {
                    DB::select('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', ['inventory:identifier:'.$serial]);
                }
                if (ItemUnit::whereIn('serial_number', $serials)->exists() || Item::whereIn('barcode', $serials)->exists()) {
                    throw ValidationException::withMessages(['serials' => 'A serial number is already registered. Serial numbers must be unique in this store.']);
                }
                $units = collect();
                for ($n = 0; $n < $quantity; $n++) {
                    $units->push(self::create($item, (int) $movement->unit_cost, $movement->supplier_id, $serials[$n] ?? null));
                }
            } else {
                $units = ItemUnit::where('item_id', $item->id)->whereIn('serial_number', $serials)->orderBy('id')->lockForUpdate()->get();
                $expectedState = $movement->delta < 0;
                if (count($serials) !== $quantity || $units->count() !== $quantity || $units->contains(fn ($u) => $u->in_stock !== $expectedState)) {
                    throw ValidationException::withMessages(['serials' => 'Enter exactly one available serial per issued unit (or one previously issued serial per returned unit).']);
                }
                if ($movement->type === 'return') {
                    $soldIds = Movement::where('source', 'sales')->where('type', 'sale')->where('reference', $movement->original_reference)->pluck('id');
                    if ($units->contains(fn ($u) => ! $soldIds->contains($u->last_movement_id))) {
                        throw ValidationException::withMessages(['serials' => 'Returned serials must belong to the original sale.']);
                    }
                }
            }
        }
        foreach ($units as $unit) {
            $previous = $unit->last_movement_id;
            $last = $reversal
                ? DB::table('movement_units')->where('movement_id', $reversal->id)->where('item_unit_id', $unit->id)->value('previous_movement_id')
                : $movement->id;
            $unit->update(['in_stock' => $movement->delta > 0, 'last_movement_id' => $last]);
            DB::table('movement_units')->insert(['movement_id' => $movement->id, 'item_unit_id' => $unit->id, 'previous_movement_id' => $previous]);
        }

        return $units->pluck('serial_number')->implode("\n");
    }
}
