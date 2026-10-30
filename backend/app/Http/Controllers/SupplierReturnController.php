<?php

namespace App\Http\Controllers;

use App\Models\Item;
use App\Models\ItemUnit;
use App\Models\StockBatch;
use App\Models\SupplierReturn;
use App\Services\StockAvailability;
use App\Services\SupplierReturns;
use Illuminate\Http\Request;

class SupplierReturnController
{
    public function lookup(Request $request)
    {
        $data = $request->validate(['barcode' => ['required', 'string', 'regex:/\A[^\x00-\x1F\x7F-\x9F]{1,500}\z/u']]);
        $unit = ItemUnit::where('serial_number', $data['barcode'])->first();
        if ($unit) {
            $item = Item::whereKey($unit->item_id)->where('active', true)->first();
            abort_unless($item && $item->serial_tracking && $unit->in_stock, 422, 'This serial is not available for a supplier return.');
            abort_unless(ItemUnit::available()->whereKey($unit->id)->exists(), 422, 'This serial is frozen for another Process supplier return.');
            $batch = StockBatch::whereKey($unit->stock_batch_id)->where('item_id', $item->id)->first();
            abort_unless($batch?->supplier_id && $batch->remaining_quantity > 0, 422, 'This unit has no available supplier stock. Check its receipt details.');

            return ['item' => $item->only(['id', 'sku', 'name', 'stock', 'unit', 'serial_tracking']) + ['available_stock' => StockAvailability::available($item)], 'serial_number' => $unit->serial_number, 'supplier_id' => $batch->supplier_id];
        }

        $item = Item::where('barcode', $data['barcode'])->where('active', true)->first();
        abort_unless($item, 404, 'No available item matches this barcode or serial number.');
        abort_if($item->serial_tracking, 422, 'Scan the individual unit serial label for this item.');
        $frozen = StockAvailability::reservedByBatch($item->id);
        $suppliers = $item->batches()->where('remaining_quantity', '>', 0)->whereNotNull('supplier_id')->get()
            ->filter(fn ($batch) => $batch->remaining_quantity > ($frozen[$batch->id] ?? 0))->pluck('supplier_id')->unique()->values();
        abort_if($suppliers->isEmpty(), 422, 'This item has no available supplier stock.');

        return ['item' => $item->only(['id', 'sku', 'name', 'stock', 'unit', 'serial_tracking']) + ['available_stock' => StockAvailability::available($item)], 'serial_number' => null, 'supplier_id' => $suppliers->count() === 1 ? $suppliers->first() : null];
    }

    public function index(Request $request)
    {
        $data = $request->validate(['search' => 'nullable|string|max:200', 'status' => 'nullable|in:process,delivered,rejected', 'supplier_id' => 'nullable|integer|exists:suppliers,id']);

        return SupplierReturn::with(['item:id,sku,name,unit', 'supplier:id,name', 'creator:id,name'])
            ->when($data['status'] ?? null, fn ($query, $status) => $query->where('status', $status))
            ->when($data['supplier_id'] ?? null, fn ($query, $supplier) => $query->where('supplier_id', $supplier))
            ->when($data['search'] ?? null, function ($query, $search) {
                $like = '%'.str_replace(['%', '_'], ['\\%', '\\_'], $search).'%';
                $query->where(fn ($query) => $query->where('reference', 'ilike', $like)->orWhere('reason', 'ilike', $like)
                    ->orWhereRaw("('SR-' || LPAD(id::text, 6, '0')) ILIKE ?", [$like])
                    ->orWhereHas('item', fn ($query) => $query->where('name', 'ilike', $like)->orWhere('sku', 'ilike', $like))
                    ->orWhereHas('supplier', fn ($query) => $query->where('name', 'ilike', $like)));
            })->orderByDesc('id')->paginate(25);
    }

    public function store(Request $request, SupplierReturns $returns)
    {
        $data = $request->validate([
            'request_key' => 'required|uuid', 'item_id' => 'required|integer|exists:items,id',
            'supplier_id' => 'required|integer|exists:suppliers,id', 'quantity' => 'required|integer|min:1|max:100000000',
            'status' => 'sometimes|required|in:process,delivered,rejected', 'reference' => 'nullable|string|max:120',
            'reason' => 'required|string|min:3|max:255', 'serials' => 'nullable|string|max:130000',
        ]);

        return $returns->create($data, $request->user()->id)->load(['item:id,sku,name,unit', 'supplier:id,name', 'creator:id,name']);
    }

    public function update(Request $request, SupplierReturn $supplierReturn, SupplierReturns $returns)
    {
        $data = $request->validate([
            'status' => 'required|in:process,delivered,rejected', 'expected_status' => 'required|in:process,delivered,rejected',
            'item_id' => 'prohibited', 'supplier_id' => 'prohibited', 'quantity' => 'prohibited',
            'reason' => 'prohibited', 'reference' => 'prohibited', 'serials' => 'prohibited',
        ]);

        return $returns->update($supplierReturn, $data, $request->user()->id)->load(['item:id,sku,name,unit', 'supplier:id,name', 'creator:id,name']);
    }
}
