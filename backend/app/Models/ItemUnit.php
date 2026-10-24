<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ItemUnit extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['in_stock' => 'boolean'];
    }
}
