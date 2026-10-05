<?php

namespace App\Services;

use App\Models\AuditLog;

class Audit
{
    public static function record(string $action, string $target, array $details = [], string $source = 'inventory'): void
    {
        AuditLog::create(['actor_id' => auth()->id(), 'source' => $source, 'action' => $action, 'target' => $target, 'details' => $details, 'created_at' => now()]);
    }
}
