<?php

namespace App\Http\Controllers;

use App\Models\Item;
use App\Models\Movement;
use App\Models\StockBatch;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;

class ReportOverviewController
{
    public function __invoke(Request $request): array
    {
        $request->validate(['from' => 'nullable|date_format:Y-m-d', 'to' => 'nullable|date_format:Y-m-d']);
        $timezone = config('sbm.timezone');
        $to = $request->filled('to') ? CarbonImmutable::parse($request->input('to'), $timezone) : CarbonImmutable::today($timezone);
        $from = $request->filled('from') ? CarbonImmutable::parse($request->input('from'), $timezone) : $to->subDays(29);
        abort_if($from->greaterThan($to), 422, 'The start date must be on or before the end date.');
        $days = $from->diffInDays($to);
        $interval = $days > 366 ? 'month' : ($days > 90 ? 'week' : 'day');
        $activity = fn () => Movement::where('occurred_at', '>=', $from->utc())->where('occurred_at', '<', $to->addDay()->utc());
        $totals = $activity()->selectRaw('COUNT(*) AS movements, COALESCE(SUM(CASE WHEN delta > 0 THEN delta::bigint ELSE 0 END),0) AS stock_in, COALESCE(SUM(CASE WHEN delta < 0 THEN -delta::bigint ELSE 0 END),0) AS stock_out')->first();
        $buckets = $activity()->selectRaw('date_trunc(?, occurred_at AT TIME ZONE ?)::date AS bucket, SUM(CASE WHEN delta > 0 THEN delta::bigint ELSE 0 END) AS stock_in, SUM(CASE WHEN delta < 0 THEN -delta::bigint ELSE 0 END) AS stock_out', [$interval, $timezone])
            ->groupByRaw('1')->orderBy('bucket')->get()->keyBy('bucket');
        $cursor = match ($interval) {
            'week' => $from->startOfWeek(CarbonImmutable::MONDAY),
            'month' => $from->startOfMonth(),
            default => $from,
        };
        $series = [];
        while ($cursor->lessThanOrEqualTo($to)) {
            $key = $cursor->toDateString();
            $bucket = $buckets->get($key);
            $series[] = ['date' => $key, 'stock_in' => (int) ($bucket?->stock_in ?? 0), 'stock_out' => (int) ($bucket?->stock_out ?? 0)];
            $cursor = match ($interval) {
                'week' => $cursor->addWeek(),
                'month' => $cursor->addMonth(),
                default => $cursor->addDay(),
            };
        }

        $batchValues = StockBatch::select('item_id')->selectRaw('SUM(remaining_quantity::bigint * unit_cost) AS value')->groupBy('item_id');
        $categories = Item::query()->join('categories', 'categories.id', '=', 'items.category_id')
            ->leftJoinSub($batchValues, 'batch_values', 'batch_values.item_id', '=', 'items.id')
            ->select('categories.id', 'categories.name')->selectRaw('SUM(items.stock::bigint) AS units, COALESCE(SUM(batch_values.value),0) AS value')
            ->groupBy('categories.id', 'categories.name')->orderByDesc('value')->orderBy('categories.name')->get()
            ->map(fn ($category) => ['name' => $category->name, 'units' => (int) $category->units, 'value' => (int) $category->value])->values();
        $stock = Item::selectRaw('COUNT(*) AS items, COALESCE(SUM(stock::bigint),0) AS units, COUNT(*) FILTER (WHERE active AND stock <= minimum_stock) AS low_stock')->first();
        $reasons = $activity()->where('delta', '<', 0)->select('type', 'reason')->selectRaw('SUM(-delta::bigint) AS quantity')
            ->groupBy('type', 'reason')->orderByDesc('quantity')->orderBy('reason')->limit(6)->get()
            ->map(fn ($reason) => ['type' => $reason->type, 'reason' => $reason->reason, 'quantity' => (int) $reason->quantity]);

        return [
            'from' => $from->toDateString(), 'to' => $to->toDateString(), 'timezone' => $timezone, 'interval' => $interval,
            'stock' => ['items' => (int) $stock->items, 'units' => (int) $stock->units, 'low_stock' => (int) $stock->low_stock, 'value' => (int) $categories->sum('value')],
            'activity' => ['movements' => (int) $totals->movements, 'stock_in' => (int) $totals->stock_in, 'stock_out' => (int) $totals->stock_out],
            'series' => $series, 'categories' => $categories, 'reasons' => $reasons,
        ];
    }
}
