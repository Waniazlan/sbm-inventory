<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class LabelSetting extends Model
{
    public const FIELDS = ['sku_prefix', 'barcode_prefix', 'serial_prefix'];

    protected $fillable = self::FIELDS;
}
