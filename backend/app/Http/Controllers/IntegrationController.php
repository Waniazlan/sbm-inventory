<?php

namespace App\Http\Controllers;

use App\Models\Item;
use App\Models\Operation;
use App\Services\Ledger;
use Illuminate\Http\Request;

class IntegrationController
{
    private function product(Item $i)
    {
        return ['id' => (string) $i->id, 'name' => $i->name, 'sku' => $i->sku, 'brand' => $i->brand, 'model' => $i->phoneModels->map(fn ($m) => $m->brand.' '.$m->name)->implode(', '), 'category' => $i->category->name, 'price' => $i->price, 'cost' => $i->cost, 'stock' => $i->stock, 'compatibility' => $i->phoneModels];
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

    public function validateStock(Request $r)
    {
        $d = $r->validate(['items' => 'required|array|min:1|max:100', 'items.*.inventory_item_id' => 'required|integer|exists:items,id', 'items.*.quantity' => 'required|integer|min:1|max:100000000']);
        $totals = [];
        foreach ($d['items'] as $i) {
            $totals[$i['inventory_item_id']] = ($totals[$i['inventory_item_id']] ?? 0) + $i['quantity'];
        }foreach ($totals as $id => $qty) {
            $i = Item::findOrFail($id);
            abort_unless($i->active && $i->stock >= $qty, 422, 'Insufficient or inactive stock: '.$i->sku);
        }

        return ['valid' => true];
    }

    public function post(Request $r, Ledger $ledger, string $direction)
    {
        $source = $r->attributes->get('source');
        $r->merge(['request_key' => $r->header('Idempotency-Key')]);
        $rules = ['request_key' => 'required|string|max:150', 'reference' => 'required|string|max:120', 'actor_reference' => 'required|string|max:150', 'items' => 'required|array|min:1|max:100', 'items.*.inventory_item_id' => 'required|integer|exists:items,id', 'items.*.quantity' => 'required|integer|min:1|max:100000000', 'items.*.line_id' => 'required|string|max:120|distinct', 'reason' => 'required|string|min:3|max:500'];
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
        $d['items'] = array_map(fn ($i) => ['item_id' => (int) $i['inventory_item_id'], 'quantity' => (int) $i['quantity'], 'line_id' => $i['line_id']], $d['items']);

        return $ledger->post($d, $source);
    }

    public function events(Request $r)
    {
        return Operation::where('source', '!=', 'inventory')->orderByDesc('id')->paginate(25);
    }
}
