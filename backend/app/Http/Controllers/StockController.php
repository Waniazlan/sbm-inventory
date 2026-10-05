<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\Item;
use App\Models\Movement;
use App\Services\Ledger;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;

class StockController
{
    public function post(Request $r, Ledger $ledger)
    {
        $d = $r->validate(['request_key' => 'required|uuid', 'kind' => 'required|in:receipt,manual_out,adjustment,repair_usage,reversal', 'item_id' => 'required_unless:kind,reversal|integer|exists:items,id', 'quantity' => 'required_unless:kind,adjustment,reversal|integer|min:1|max:100000000', 'reason' => 'required|string|min:3|max:500', 'reference' => 'required_if:kind,repair_usage,adjustment|nullable|string|max:120', 'counted_quantity' => 'required_if:kind,adjustment|integer|min:0|max:100000000', 'movement_id' => 'required_if:kind,reversal|integer|exists:movements,id', 'supplier_id' => 'nullable|exists:suppliers,id', 'unit_cost' => 'nullable|integer|min:0|max:100000000', 'batch' => 'nullable|string|max:150', 'serials' => 'nullable|string|max:2000', 'approval_note' => 'nullable|string|max:1000', 'occurred_at' => 'nullable|date|before_or_equal:now']);
        abort_unless($r->user()->role === 'admin' || $d['kind'] === 'repair_usage', 403, 'Technicians can only record assigned repair usage.');
        if ($d['kind'] === 'receipt') {
            abort_unless(! empty($d['supplier_id']) || ! empty($d['reference']), 422, 'A receipt requires a supplier or reference.');
        }
        if ($d['kind'] !== 'reversal') {
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
        if ($r->user()->role !== 'admin') {
            $p->through(function ($m) {
                $d = $m->toArray();
                unset($d['unit_cost'],$d['approval_note']);

                return $d;
            });
        }

        return $p;
    }

    public function dashboard(Request $r)
    {
        $admin = $r->user()->role === 'admin';

        return ['items' => Item::where('active', true)->count(), 'units' => (int) Item::sum('stock'), 'low_stock' => Item::where('active', true)->whereColumn('stock', '<=', 'minimum_stock')->count(), 'out_of_stock' => Item::where('active', true)->where('stock', 0)->count(), 'valuation' => $admin ? (int) Item::selectRaw('COALESCE(SUM(stock::bigint*cost),0) as total')->value('total') : null, 'recent' => $this->index($r)->items(), 'low_items' => Item::with(['category', 'phoneModels'])->where('active', true)->whereColumn('stock', '<=', 'minimum_stock')->orderBy('stock')->limit(8)->get()->map(fn ($i) => CatalogueController::present($i, $admin))];
    }

    public function audit()
    {
        return AuditLog::orderByDesc('id')->paginate(30);
    }

    public function report(Request $r)
    {
        $r->validate(['kind' => 'required|in:current,low,movements,reasons,repairs,sales,valuation', 'format' => 'nullable|in:csv']);
        $kind = $r->input('kind');
        if (in_array($kind, ['current', 'low', 'valuation'])) {
            if ($kind === 'low') {
                $r->merge(['status' => 'low']);
            }$q = CatalogueController::query($r)->orderBy('sku');
            $map = fn ($i) => ['SKU' => $i->sku, 'Name' => $i->name, 'Category' => $i->category->name, 'Compatibility' => $i->phoneModels->map(fn ($p) => $p->brand.' '.$p->name)->implode('; '), 'Stock' => $i->stock, 'Minimum' => $i->minimum_stock, 'Unit cost (sen)' => $i->cost, 'Value (sen)' => $i->stock * $i->cost];
        } else {
            if ($kind === 'repairs') {
                $r->merge(['type' => 'repair_usage']);
            }if ($kind === 'sales') {
                $r->merge(['source' => 'sales']);
            }$q = self::query($r);
            if ($kind === 'reasons') {
                $q->where('delta', '<', 0)->selectRaw('type, reason, SUM(quantity) as quantity')->groupBy('type', 'reason')->setEagerLoads([])->orderBy('type');
                $map = fn ($m) => ['Type' => $m->type, 'Reason' => $m->reason, 'Quantity' => (int) $m->quantity];
            } else {
                $q->orderByDesc('id');
                $map = fn ($m) => ['ID' => $m->id, 'SKU' => $m->item->sku, 'Type' => $m->type, 'Change' => $m->delta, 'Before' => $m->balance_before, 'After' => $m->balance_after, 'Reason' => $m->reason, 'Source' => $m->source, 'Reference' => $m->reference, 'Repair job' => $m->repair_job_reference, 'External line' => $m->line_id, 'Actor' => $m->actor?->name ?? $m->actor_reference ?? $m->source, 'Occurred at' => $m->occurred_at->setTimezone(config('sbm.timezone'))->format('Y-m-d H:i:sP')];
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

        return $q->paginate(25)->through($map);
    }
}
