<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Schema;

class ItemUnit extends Model
{
    protected $guarded = ['id'];

    public function scopeAvailable(Builder $query): void
    {
        $query->where('item_units.in_stock', true);
        if (Schema::hasTable('stock_reservations')) {
            $query->whereNotIn('item_units.id', StockReservation::active()->whereNotNull('item_unit_id')->select('item_unit_id'));
        }
    }

    protected function casts(): array
    {
        return ['in_stock' => 'boolean'];
    }
}
