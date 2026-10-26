<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\Item;
use App\Models\Movement;
use App\Models\StockBatch;
use App\Services\Ledger;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class StockController
{
    public function post(Request $r, Ledger $ledger)
    {
        abort_unless($r->user()->role === 'admin', 403, 'Administrator access required to record stock movements.');
        $multiReceipt = $r->input('kind') === 'receipt' && $r->exists('items');
        $rules = ['request_key' => 'required|uuid', 'kind' => 'required|in:receipt,manual_out,adjustment,reversal', 'item_id' => 'required_unless:kind,reversal|integer|exists:items,id', 'quantity' => 'required_unless:kind,adjustment,reversal|integer|min:1|max:100000000', 'reason' => 'required|string|min:3|max:500', 'reference' => 'required_if:kind,adjustment|nullable|string|max:120', 'counted_quantity' => 'required_if:kind,adjustment|integer|min:0|max:100000000', 'movement_id' => 'required_if:kind,reversal|integer|exists:movements,id', 'supplier_id' => 'nullable|exists:suppliers,id', 'unit_cost' => 'nullable|integer|min:0|max:100000000', 'batch' => 'nullable|string|max:150', 'serials' => 'nullable|string|max:130000', 'approval_note' => 'nullable|string|max:1000', 'occurred_at' => 'nullable|date|before_or_equal:now'];
        if ($r->input('kind') === 'receipt') {
            $rules['reason'] = 'nullable|string|min:3|max:500';
            $rules['brand'] = 'nullable|string|max:100';
        }
        if ($multiReceipt) {
            foreach (['item_id', 'quantity', 'unit_cost', 'batch', 'serials', 'brand'] as $field) {
                $rules[$field] = 'prohibited';
            }
            $rules += [
                'items' => 'required|array|min:1|max:100',
                'items.*' => 'required|array:item_id,quantity,unit_cost,batch,serials,brand',
                'items.*.item_id' => 'required|integer|exists:items,id',
                'items.*.quantity' => 'required|integer|min:1|max:100000000',
                'items.*.unit_cost' => 'nullable|integer|min:0|max:100000000',
                'items.*.brand' => 'nullable|string|max:100',
                'items.*.batch' => 'nullable|string|max:150',
                'items.*.serials' => 'nullable|string|max:130000',
            ];
        } else {
            $rules['items'] = 'prohibited';
        }
        $d = $r->validate($rules);
        if ($d['kind'] === 'receipt') {
            abort_unless(! empty($d['supplier_id']) || ! empty($d['reference']), 422, 'A receipt requires a supplier or reference.');
            $d['reason'] ??= 'Stock received from supplier';
        }
        if ($d['kind'] !== 'reversal' && ! $multiReceipt) {
            $d['items'] = [['item_id' => $d['item_id'], 'quantity' => $d['quantity'] ?? 1]];
        }
        // Bind manual idempotency to actor; retries cannot expose another user's operation.
        $d['actor_reference'] = 'user:'.$r->user()->id;

        return $ledger->post($d, 'inventory', $r->user()->id);
    }

    public static function query(Request $r)
    {
        $r->validate(['actor_id' => 'nullable|integer', 'item_id' => 'nullable|integer', 'search' => 'nullable|string|max:200', 'type' => 'nullable|string|max:40', 'source' => 'nullable|string|max:40']);
        $q = Movement::with(['item:id,sku,name', 'actor:id,name', 'supplier:id,name', 'reversal:id,reverses_id']);
        if ($r->user()->role === 'admin') {
            $q->withSum('costAllocations as total_cost', DB::raw('ABS(quantity::bigint) * unit_cost'))
                ->selectSub(DB::table('cost_allocations')->selectRaw('CASE WHEN MIN(unit_cost) = MAX(unit_cost) THEN MIN(unit_cost) END')->whereColumn('movement_id', 'movements.id'), 'allocated_unit_cost');
        }
        if ($r->user()->role !== 'admin') {
            $q->where('actor_id', $r->user()->id);
        }if ($r->filled('item_id')) {
            $q->where('item_id', $r->integer('item_id'));
        }foreach (['type', 'source', 'actor_id'] as $f) {
            if ($r->filled($f)) {
                $q->where($f, $r->input($f));
            }
        }if ($s = $r->input('search')) {
            $q->where(fn ($q) => $q->where('reference', 'ilike', '%'.$s.'%')->orWhere('repair_job_reference', 'ilike', '%'.$s.'%')->orWhereHas('item', fn ($q) => $q->where('sku', 'ilike', '%'.$s.'%')->orWhere('name', 'ilike', '%'.$s.'%')));
        }foreach (['from', 'to'] as $f) {
            if ($r->filled($f)) {
                $r->validate([$f => 'date_format:Y-m-d']);
                $date = CarbonImmutable::parse($r->input($f), config('sbm.timezone'));
                $q->where('occurred_at', $f === 'from' ? '>=' : '<', ($f === 'from' ? $date : $date->addDay())->utc());
            }
        }

        return $q;
    }

    public function index(Request $r)
    {
        $p = self::query($r)->orderByDesc('id')->paginate(25);
        $p->through(function ($m) use ($r) {
            $d = $m->toArray();
            if ($r->user()->role === 'admin') {
                $d['unit_cost'] = $m->allocated_unit_cost === null ? null : (int) $m->allocated_unit_cost;
            } else {
                unset($d['unit_cost'], $d['approval_note']);
            }
            unset($d['allocated_unit_cost']);

            return $d;
        });

        return $p;
    }

    public function dashboard(Request $r)
    {
        $admin = $r->user()->role === 'admin';

        return ['items' => Item::where('active', true)->count(), 'units' => (int) Item::sum('stock'), 'low_stock' => Item::where('active', true)->whereColumn('stock', '<=', 'minimum_stock')->count(), 'out_of_stock' => Item::where('active', true)->where('stock', 0)->count(), 'valuation' => $admin ? (int) StockBatch::selectRaw('COALESCE(SUM(remaining_quantity::bigint * unit_cost),0) as total')->value('total') : null, 'recent' => $this->index($r)->items(), 'low_items' => Item::with(['category', 'phoneModels'])->withSum('batches as stock_value', DB::raw('remaining_quantity::bigint * unit_cost'))->where('active', true)->whereColumn('stock', '<=', 'minimum_stock')->orderBy('stock')->limit(8)->get()->map(fn ($i) => CatalogueController::present($i, $admin))];
    }

    public function audit()
    {
        return AuditLog::orderByDesc('id')->paginate(30);
    }

    public function report(Request $r)
    {
        $r->validate(['kind' => 'required|in:current,low,movements,reasons,repairs,sales,valuation', 'format' => 'nullable|in:csv', 'per_page' => 'nullable|integer|min:5|max:100']);
        $kind = $r->input('kind');
        if (in_array($kind, ['current', 'low', 'valuation'])) {
            if ($kind === 'low') {
                $r->merge(['status' => 'low']);
            }$q = CatalogueController::query($r)->orderBy('sku');
            $map = fn ($i) => ['SKU' => $i->sku, 'Name' => $i->name, 'Category' => $i->category->name, 'Compatibility' => $i->phoneModels->map(fn ($p) => $p->brand.' '.$p->name)->implode('; '), 'Stock' => $i->stock, 'Minimum' => $i->minimum_stock, 'Value (sen)' => (int) ($i->stock_value ?? 0)];
        } else {
            if ($kind === 'repairs') {
                $r->merge(['type' => 'repair_usage']);
            }if ($kind === 'sales') {
                $r->merge(['source' => 'sales']);
            }$q = self::query($r);
            if ($kind === 'reasons') {
                $q->where('delta', '<', 0)->select([])->selectRaw('type, reason, SUM(quantity) as quantity')->groupBy('type', 'reason')->setEagerLoads([])->orderBy('type');
                $map = fn ($m) => ['Type' => $m->type, 'Reason' => $m->reason, 'Quantity' => (int) $m->quantity];
            } else {
                $q->orderByDesc('id');
                $map = fn ($m) => ['ID' => $m->id, 'SKU' => $m->item->sku, 'Type' => $m->type, 'Change' => $m->delta, 'Before' => $m->balance_before, 'After' => $m->balance_after, 'Reason' => $m->reason, 'Source' => $m->source, 'Reference' => $m->reference, 'Repair job' => $m->repair_job_reference, 'External line' => $m->line_id, 'Supplier' => $m->supplier?->name, 'Part brand' => $m->brand, 'Unit cost (sen)' => $m->allocated_unit_cost === null ? null : (int) $m->allocated_unit_cost, 'Total cost (sen)' => (int) $m->total_cost, 'Actor' => $m->actor?->name ?? $m->actor_reference ?? $m->source, 'Occurred at' => $m->occurred_at->setTimezone(config('sbm.timezone'))->format('Y-m-d H:i:sP')];
            }
        }
        if ($r->input('format') === 'csv') {
            return response()->streamDownload(function () use ($q, $map) {
                $out = fopen('php://output', 'w');
                $header = false;
                foreach ($q->cursor() as $row) {
                    $data = $map($row);
                    if (! $header) {
                        fputcsv($out, array_keys($data), ',', '"', '');
                        $header = true;
                    }$safe = array_map(fn ($v) => is_string($v) && preg_match('/^[=+@\-\t\r]/', $v) ? "'".$v : $v, $data);
                    fputcsv($out, $safe, ',', '"', '');
                }fclose($out);
            }, 'inventory-'.$kind.'.csv', ['Content-Type' => 'text/csv']);
        }

        return $q->paginate($r->integer('per_page', 25) ?: 25)->through($map);
    }
}
