<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SupplierReturn extends Model
{
    protected $guarded = ['id'];

    protected $hidden = ['request_key', 'fingerprint'];

    protected function casts(): array
    {
        return ['quantity' => 'integer'];
    }

    public function item()
    {
        return $this->belongsTo(Item::class)->withTrashed();
    }

    public function supplier()
    {
        return $this->belongsTo(Supplier::class);
    }

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
