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
    }$this->info('All cached balances match the movement ledger.');
});
