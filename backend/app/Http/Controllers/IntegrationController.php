<?php

namespace App\Http\Controllers;

use App\Models\Item;
use App\Models\ItemUnit;
use App\Models\Operation;
use App\Models\StockBatch;
use App\Services\Ledger;
use App\Services\StockAvailability;
use App\Services\UnitSerials;
use Illuminate\Http\Request;

class IntegrationController
{
    private function product(Item $i)
    {
        return ['id' => (string) $i->id, 'name' => $i->name, 'sku' => $i->sku, 'brand' => $i->brand, 'model' => $i->phoneModels->map(fn ($m) => $m->brand.' '.$m->name)->implode(', '), 'category' => $i->category->name, 'price' => $i->price, 'cost' => $i->cost, 'stock' => StockAvailability::available($i), 'on_hand_stock' => $i->stock, 'frozen_stock' => StockAvailability::reserved($i), 'barcode' => $i->barcode, 'serial_tracking' => $i->serial_tracking, 'compatibility' => $i->phoneModels];
    }

    public function products(Request $r)
    {
        $q = CatalogueController::query($r)->where('active', true)->whereNotNull('price')->orderBy('id');
        $p = $q->paginate(100);

        return ['data' => $p->getCollection()->map(fn ($i) => $this->product($i)), 'next_page_url' => $p->nextPageUrl(), 'total' => $p->total()];
    }

    public function productShow(Item $item)
    {
        abort_unless($item->active && $item->price !== null, 404);

        return ['data' => $this->product($item->load(['category', 'phoneModels']))];
    }

    public function units(Request $r, Item $item)
    {
        abort_unless($item->active && $item->price !== null && $item->serial_tracking, 404);
        $r->validate(['search' => 'nullable|string|max:120', 'page' => 'nullable|integer|min:1|max:1000000']);
        $units = ItemUnit::available()
            ->leftJoinSub(StockBatch::withBrand(), 'label_batch', fn ($join) => $join->on('label_batch.id', '=', 'item_units.stock_batch_id'))
            ->where('item_units.item_id', $item->id)
            ->when($r->filled('search'), fn ($query) => $query->where('item_units.serial_number', 'ilike',
                '%'.str_replace(['%', '_'], ['\\%', '\\_'], $r->input('search')).'%'))
            ->orderBy('item_units.id')
            ->paginate(50, ['item_units.id', 'item_units.serial_number', 'label_batch.effective_brand as brand']);
        $units->through(fn ($unit) => ['id' => (string) $unit->id, 'serial_number' => $unit->serial_number, 'brand' => $unit->brand]);

        return response()->json($units)->header('Cache-Control', 'no-store');
    }

    public function validateStock(Request $r)
    {
        $d = $r->validate(['items' => 'required|array|min:1|max:100', 'items.*.inventory_item_id' => 'required|integer|exists:items,id', 'items.*.quantity' => 'required|integer|min:1|max:100000000', 'items.*.serials' => 'nullable|string|max:130000']);
        $totals = [];
        $seenSerials = [];
        foreach ($d['items'] as $i) {
            $totals[$i['inventory_item_id']] = ($totals[$i['inventory_item_id']] ?? 0) + $i['quantity'];
            if (! empty($i['serials'])) {
                $serials = UnitSerials::parse($i['serials']);
                $product = Item::findOrFail($i['inventory_item_id']);
                abort_unless($product->serial_tracking && count($serials) === $i['quantity'] && ! array_intersect($seenSerials, $serials)
                    && ItemUnit::available()->where('item_id', $product->id)->whereIn('serial_number', $serials)->count() === $i['quantity'],
                    422, 'A scanned unit serial is unavailable, duplicated or belongs to another item.');
                $seenSerials = [...$seenSerials, ...$serials];
            }
        }foreach ($totals as $id => $qty) {
            $i = Item::findOrFail($id);
            abort_unless($i->active && StockAvailability::available($i) >= $qty, 422, 'Insufficient, frozen or inactive stock: '.$i->sku);
        }

        return ['valid' => true];
    }

    public function post(Request $r, Ledger $ledger, string $direction)
    {
        $source = $r->attributes->get('source');
        $r->merge(['request_key' => $r->header('Idempotency-Key')]);
        $rules = ['request_key' => 'required|string|max:150', 'reference' => 'required|string|max:120', 'actor_reference' => 'required|string|max:150', 'items' => 'required|array|min:1|max:100', 'items.*.inventory_item_id' => 'required|integer|exists:items,id', 'items.*.quantity' => 'required|integer|min:1|max:100000000', 'items.*.serials' => 'nullable|string|max:130000', 'items.*.line_id' => 'required|string|max:120|distinct', 'reason' => 'required|string|min:3|max:500'];
        if ($source === 'sales' && $direction === 'out') {
            $rules['payment_status'] = 'required|in:paid';
            $rules['finalized'] = 'required|accepted';
        }if ($direction === 'in') {
            $rules['return_accepted'] = 'required|accepted';
            $rules['original_reference'] = 'required|string|max:120';
        }
        if ($source === 'repair') {
            $rules['repair_job_reference'] = 'required|string|max:120';
        }
        $d = $r->validate($rules);
        $d['kind'] = $source === 'repair' ? 'repair_usage' : ($direction === 'out' ? 'sale' : 'return');
        $d['items'] = array_map(fn ($i) => ['item_id' => (int) $i['inventory_item_id'], 'quantity' => (int) $i['quantity'], 'line_id' => $i['line_id']] + (array_key_exists('serials', $i) ? ['serials' => $i['serials']] : []), $d['items']);

        return $ledger->post($d, $source);
    }

    public function events(Request $r)
    {
        return Operation::where('source', '!=', 'inventory')->orderByDesc('id')->paginate(25);
    }
}
