<?php

use App\Models\User;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;

Artisan::command('sbm:create-admin {email}', function () {
    $email = $this->argument('email');
    if (! filter_var($email, FILTER_VALIDATE_EMAIL) || User::where('email', $email)->exists()) {
        $this->error('Use a valid, unused email address.');

        return 1;
    }$name = $this->ask('Name');
    $password = $this->secret('Password (at least 12 characters)');
    if (! $name || strlen($password ?? '') < 12) {
        $this->error('Name and a strong password are required.');

        return 1;
    }User::create(['name' => $name, 'email' => $email, 'password' => $password, 'role' => 'admin']);
    $this->info('Administrator created.');
})->purpose('Create an Inventory administrator');
Artisan::command('inventory:reconcile', function () {
    $bad = DB::select('SELECT i.id, i.sku, i.stock, COALESCE(SUM(m.delta),0) AS ledger_balance FROM items i LEFT JOIN movements m ON m.item_id=i.id GROUP BY i.id HAVING i.stock <> COALESCE(SUM(m.delta),0)');
    if ($bad) {
        $this->error(json_encode($bad));

        return 1;
    }
    $batches = DB::select('SELECT i.id, i.sku, i.stock, COALESCE(SUM(b.remaining_quantity),0) AS batch_balance FROM items i LEFT JOIN stock_batches b ON b.item_id=i.id GROUP BY i.id HAVING i.stock <> COALESCE(SUM(b.remaining_quantity),0)');
    $allocations = DB::select('SELECT m.id, m.delta, COALESCE(SUM(a.quantity),0) AS allocated FROM movements m LEFT JOIN cost_allocations a ON a.movement_id=m.id GROUP BY m.id HAVING m.delta <> COALESCE(SUM(a.quantity),0)');
    $serials = DB::select('SELECT b.id, b.remaining_quantity, COUNT(u.id) AS available_serials FROM stock_batches b JOIN items i ON i.id=b.item_id LEFT JOIN item_units u ON u.stock_batch_id=b.id AND u.in_stock WHERE i.serial_tracking GROUP BY b.id HAVING b.remaining_quantity <> COUNT(u.id)');
    $unassigned = DB::table('item_units')->where('in_stock', true)->whereNull('stock_batch_id')->count();
    $frozenBatches = DB::select('SELECT b.id, b.remaining_quantity, SUM(r.quantity) AS frozen FROM stock_reservations r JOIN stock_batches b ON b.id=r.stock_batch_id WHERE r.released_at IS NULL GROUP BY b.id HAVING SUM(r.quantity) > b.remaining_quantity');
    $frozenUnits = DB::select('SELECT r.id FROM stock_reservations r LEFT JOIN item_units u ON u.id=r.item_unit_id WHERE r.released_at IS NULL AND r.item_unit_id IS NOT NULL AND (u.id IS NULL OR NOT u.in_stock OR u.item_id <> r.item_id OR u.stock_batch_id <> r.stock_batch_id)');
    $returns = DB::select("SELECT s.id FROM supplier_returns s LEFT JOIN stock_reservations r ON r.supplier_return_id=s.id AND r.released_at IS NULL GROUP BY s.id HAVING (s.status='process' AND (COALESCE(SUM(r.quantity),0) <> s.quantity OR s.stock_movement_id IS NOT NULL)) OR (s.status<>'process' AND (COALESCE(SUM(r.quantity),0) <> 0 OR s.stock_movement_id IS NULL))");
    if ($batches || $allocations || $serials || $unassigned || $frozenBatches || $frozenUnits || $returns) {
        $this->error(json_encode(['batches' => $batches, 'allocations' => $allocations, 'serials' => $serials, 'unassigned_units' => $unassigned, 'frozen_batches' => $frozenBatches, 'frozen_units' => $frozenUnits, 'supplier_returns' => $returns]));

        return 1;
    }
    $this->info('All cached balances, batches, cost allocations, serials and frozen reservations match the movement ledger.');
});
