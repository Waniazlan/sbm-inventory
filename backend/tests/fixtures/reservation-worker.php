<?php

use App\Services\Ledger;
use App\Services\SupplierReturns;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

require __DIR__.'/../../vendor/autoload.php';
$app = require __DIR__.'/../../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
if (! app()->environment('testing') || config('database.connections.pgsql.database') !== 'sbm_inventory_test') {
    exit(9);
}
$data = json_decode($argv[1], true, 512, JSON_THROW_ON_ERROR);
try {
    $result = $data['action'] === 'reserve'
        ? app(SupplierReturns::class)->create($data['payload'], $data['actor'])
        : app(Ledger::class)->post($data['payload'], 'sales');
    echo json_encode($result);
    exit(0);
} catch (ValidationException $exception) {
    exit(2);
} catch (HttpExceptionInterface $exception) {
    if ($exception->getStatusCode() === 422) {
        exit(2);
    }
    throw $exception;
}
