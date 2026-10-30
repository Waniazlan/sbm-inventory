<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

class StockReservation extends Model
{
    public $timestamps = false;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['quantity' => 'integer', 'released_at' => 'datetime'];
    }

    public function scopeActive(Builder $query): void
    {
        $query->whereNull('released_at');
    }
}
