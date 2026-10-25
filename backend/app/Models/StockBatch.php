<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class StockBatch extends Model
{
    public $timestamps = false;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['unit_cost' => 'integer', 'quantity' => 'integer', 'remaining_quantity' => 'integer', 'received_at' => 'datetime'];
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
