<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class LoginBackground extends Model
{
    public $incrementing = false;

    protected function casts(): array
    {
        return ['size' => 'integer'];
    }
}
