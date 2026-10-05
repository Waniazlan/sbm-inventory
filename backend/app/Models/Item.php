<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Item extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['active' => 'boolean', 'cost' => 'integer', 'price' => 'integer', 'stock' => 'integer'];
    }

    public function category()
    {
        return $this->belongsTo(Category::class);
    }

    public function supplier()
    {
        return $this->belongsTo(Supplier::class);
    }

    public function phoneModels()
    {
        return $this->belongsToMany(PhoneModel::class);
    }
}
