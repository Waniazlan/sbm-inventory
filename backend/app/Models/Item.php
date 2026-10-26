<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class Item extends Model
{
    use SoftDeletes;

    protected $guarded = ['id'];

    protected static function booted(): void
    {
        static::creating(function (Item $item) {
            if (filled($item->sku)) {
                return;
            }

            do {
                // PostgreSQL sequences allocate distinct numbers across requests
                // and do not reuse numbers after a failed save or rollback.
                $number = $item->getConnection()->selectOne("SELECT nextval('inventory_item_sku_seq') AS number")->number;
                $sku = sprintf('%s-%06d', app(LabelSetting::class)->sku_prefix, $number);
            } while ($item->newQuery()->withTrashed()->where('sku', $sku)->exists());

            $item->sku = $sku;
        });
    }

    protected function casts(): array
    {
        return ['barcode' => 'string', 'serial_tracking' => 'boolean', 'active' => 'boolean', 'cost' => 'integer', 'stock_value' => 'integer', 'price' => 'integer', 'stock' => 'integer'];
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

    public function batches()
    {
        return $this->hasMany(StockBatch::class);
    }

    public function movements()
    {
        return $this->hasMany(Movement::class);
    }
}
