<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Operation extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['response' => 'array'];
    }
}
