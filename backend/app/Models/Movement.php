<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Movement extends Model
{
    protected $guarded = ['id'];

    public $timestamps = false;

    protected function casts(): array
    {
        return ['occurred_at' => 'datetime'];
    }

    public function item()
    {
        return $this->belongsTo(Item::class);
    }

    public function actor()
    {
        return $this->belongsTo(User::class, 'actor_id');
    }

    public function supplier()
    {
        return $this->belongsTo(Supplier::class);
    }

    public function reversal()
    {
        return $this->hasOne(self::class, 'reverses_id');
    }
}
