<?php

namespace App\Http\Controllers;

use App\Models\Movement;
use App\Models\Operation;
use App\Services\Ledger;
use Illuminate\Http\Request;

class RepairUsageReversalController
{
    public function __invoke(Request $request, Ledger $ledger)
    {
        $values = $request->validate([
            'reference' => 'required|string|max:120', 'original_reference' => 'required|string|max:120',
            'repair_job_reference' => 'required|string|max:120', 'actor_reference' => 'required|string|max:150',
            'reason' => 'required|string|min:3|max:500',
        ]);
        $key = $request->header('Idempotency-Key');
        abort_unless(is_string($key) && $key !== '' && strlen($key) <= 150, 422, 'An Idempotency-Key is required.');
        $original = Operation::where('source', 'repair')->where('kind', 'repair_usage')->where('reference', $values['original_reference'])->firstOrFail();
        $movements = Movement::where('operation_id', $original->id)->get();
        abort_unless($movements->count() === 1, 422, 'Remove one repair item usage at a time.');
        $movement = $movements->first();
        abort_unless($movement->type === 'repair_usage' && $movement->repair_job_reference === $values['repair_job_reference'], 409, 'The original usage belongs to a different repair.');

        // Reverse the original ledger movement: quantities, units and supplier costs come from Inventory.
        return $ledger->post([
            ...$values, 'request_key' => $key, 'kind' => 'reversal', 'movement_id' => $movement->id,
        ], 'repair');
    }
}
