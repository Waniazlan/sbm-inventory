<?php

namespace App\Http\Controllers;

use App\Models\Item;
use App\Models\ItemUnit;
use App\Models\Movement;
use App\Models\StockBatch;
use App\Models\StockReservation;
use App\Services\StockAvailability;
use Illuminate\Http\Request;

class ItemLookupController
{
    public function __invoke(Request $request)
    {
        $data = $request->validate(['barcode' => ['required', 'string', 'regex:/\A[^\x00-\x1F\x7F-\x9F]{1,500}\z/u']]);
        $unit = ItemUnit::where('serial_number', $data['barcode'])->first();
        $item = Item::withTrashed()->with(['category', 'phoneModels'])
            ->when($unit, fn ($query) => $query->whereKey($unit->item_id), fn ($query) => $query->where('barcode', $data['barcode']))
            ->first();
        abort_unless($item, 404, 'No item matches this barcode or serial number.');

        $available = StockAvailability::available($item);
        $movement = $unit ? Movement::find($unit->last_movement_id) : null;
        $batch = $unit ? StockBatch::withBrand()->find($unit->stock_batch_id) : null;
        if ($unit) {
            $reserved = StockReservation::active()->where('item_unit_id', $unit->id)->exists();
            $status = match (true) {
                $reserved => 'Pending supplier return',
                $unit->in_stock && $movement?->type === 'return' => 'Returned to stock',
                $unit->in_stock => 'In stock',
                $movement?->type === 'sale' && $movement?->source === 'sales' => 'Sold',
                $movement?->type === 'repair_usage' => 'Used for repair',
                $movement?->type === 'supplier_return' => 'Returned to supplier',
                default => 'Issued',
            };
        } else {
            $status = $available > 0 ? 'In stock' : ($item->stock > 0 ? 'Stock unavailable' : 'Out of stock');
        }

        return response()->json([
            'match' => $unit ? 'unit' : 'product',
            'status' => $status,
            'item' => [
                'id' => $item->id, 'name' => $item->name, 'sku' => $item->sku, 'barcode' => $item->barcode,
                'brand' => $batch ? $batch->effective_brand : $item->brand, 'price' => $item->price,
                'category' => $item->category->name, 'stock' => $item->stock, 'available_stock' => $available,
                'active' => $item->active, 'archived' => $item->trashed(),
                'compatibility' => $item->phoneModels->map(fn ($model) => $model->brand.' '.$model->name)->values(),
                'colour' => $item->colour, 'capacity' => $item->capacity, 'grade' => $item->grade,
            ],
            'unit' => $unit ? ['serial_number' => $unit->serial_number, 'received_at' => $batch?->received_at?->toIso8601String()] : null,
            'movement' => $movement ? [
                'type' => $movement->type, 'reference' => $movement->repair_job_reference ?? $movement->reference,
                'occurred_at' => $movement->occurred_at->toIso8601String(),
            ] : null,
        ])->header('Cache-Control', 'no-store');
    }
}
