<?php

namespace App\Services;

use App\Models\Item;
use App\Models\StockReservation;
use Illuminate\Support\Facades\Schema;

class StockAvailability
{
    // Batch-history migrations run before reservation storage exists.
    public static function reservedByBatch(int $itemId): array
    {
        return Schema::hasTable('stock_reservations')
            ? StockReservation::active()->where('item_id', $itemId)->selectRaw('stock_batch_id, SUM(quantity) AS quantity')->groupBy('stock_batch_id')->pluck('quantity', 'stock_batch_id')->map(fn ($quantity) => (int) $quantity)->all()
            : [];
    }

    public static function reserved(Item $item): int
    {
        return array_sum(self::reservedByBatch($item->id));
    }

    public static function available(Item $item): int
    {
        return $item->stock - self::reserved($item);
    }
}
