<?php

namespace App\Services;

use App\Models\SupplierReturn;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

class SupplierReturnReport
{
    // Only the current deduction belongs to a return's current status. Reopening
    // clears this link, so older deductions and reversals cannot inflate losses.
    public function query(): Builder
    {
        $costs = DB::table('cost_allocations')->select('movement_id')
            ->selectRaw('SUM(ABS(quantity::bigint) * unit_cost) AS value')->groupBy('movement_id');

        return SupplierReturn::query()
            ->leftJoinSub($costs, 'return_costs', 'return_costs.movement_id', '=', 'supplier_returns.stock_movement_id')
            ->select('supplier_returns.*')
            ->selectRaw("CASE WHEN supplier_returns.status = 'rejected' THEN COALESCE(return_costs.value, 0) ELSE 0 END AS loss_value");
    }

    public function summary(): array
    {
        $totals = $this->query()->select('supplier_returns.status')
            ->selectRaw('COUNT(*) AS returns, SUM(supplier_returns.quantity::bigint) AS quantity, COALESCE(SUM(return_costs.value), 0) AS value')
            ->groupBy('supplier_returns.status')->get()->keyBy('status');
        $summary = [];
        foreach (['process', 'delivered', 'rejected'] as $status) {
            $total = $totals->get($status);
            $summary[$status] = ['returns' => (int) ($total?->returns ?? 0), 'quantity' => (int) ($total?->quantity ?? 0)];
        }
        $summary['loss'] = ['quantity' => $summary['rejected']['quantity'], 'value' => (int) ($totals->get('rejected')?->value ?? 0)];

        return $summary;
    }

    public function row(SupplierReturn $return): array
    {
        return [
            'Return' => 'SR-'.str_pad((string) $return->id, 6, '0', STR_PAD_LEFT),
            'SKU' => $return->item->sku,
            'Name' => $return->item->name,
            'Supplier' => $return->supplier->name,
            'Status' => $return->status,
            'Quantity' => $return->quantity,
            'Classification' => match ($return->status) {
                'rejected' => 'Loss',
                'process' => 'Frozen',
                default => 'Supplier return',
            },
            'Loss value (sen)' => (int) $return->loss_value,
            'Created at' => $return->created_at->setTimezone(config('sbm.timezone'))->format('Y-m-d H:i:sP'),
        ];
    }
}
