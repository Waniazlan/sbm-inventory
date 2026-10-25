<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CostAllocation extends Model
{
    public $timestamps = false;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['quantity' => 'integer', 'unit_cost' => 'integer'];
    }

    public function batch()
    {
        return $this->belongsTo(StockBatch::class, 'stock_batch_id');
    }

    public function movement()
    {
        return $this->belongsTo(Movement::class);
    }
}
