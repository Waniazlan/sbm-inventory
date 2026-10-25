<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

class StockBatch extends Model
{
    public $timestamps = false;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['unit_cost' => 'integer', 'quantity' => 'integer', 'remaining_quantity' => 'integer', 'brand_corrected' => 'boolean', 'received_at' => 'datetime'];
    }

    public function scopeWithBrand(Builder $query): void
    {
        $query->leftJoin('movements as receipt', 'receipt.id', '=', 'stock_batches.receipt_movement_id')
            ->select('stock_batches.*')->selectRaw('CASE WHEN stock_batches.brand_corrected THEN stock_batches.brand_override ELSE receipt.brand END AS effective_brand');
    }

    public function supplier()
    {
        return $this->belongsTo(Supplier::class);
    }

    public function receipt()
    {
        return $this->belongsTo(Movement::class, 'receipt_movement_id');
    }
}
